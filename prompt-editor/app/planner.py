"""Der KI-Schritt: Auftrag + Teileliste (+ optional Bild) → Werkzeug-Aufrufe.

Anbieter per Umgebungsvariable:
  LLM_MODE=openai   echte OpenAI Responses API (Standard, wenn OPENAI_API_KEY gesetzt ist)
  LLM_MODE=mock     einfache Regeln, zum Testen ohne Schlüssel
  OPENAI_MODEL      Planer-Modell: gpt-6.2-sol (Standard), gpt-6.1-sol, gpt-6.2-astra (stärkstes) oder gpt-6.1-terra (günstigstes)
  OPENAI_CAD_MODEL  optional eigenes Modell nur für den CAD-Code neuer Teile (z. B. gpt-6.2-astra)
  OPENAI_EFFORT     Denkaufwand beim Ändern: low (Standard), medium, high
  OPENAI_VIEW_DETAIL  Bilddetail der Modellansichten: low (Standard) oder high
  OPENAI_BASE_URL   optional, für OpenAI-kompatible Anbieter
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache

from .tools import SYSTEM_PROMPT, TOOL_SCHEMAS

CAD_SYSTEM_PROMPT = """Du bist CAD-Konstrukteur. Schreibe Python-Code mit CadQuery für EIN Bauteil.
Regeln: nur 'import cadquery as cq' und 'import math'; Einheiten mm; Drehachse bzw. Hauptachse ist Z;
Mittelpunkt im Ursprung; Schauseite zeigt nach +Z; alle wichtigen Maße als Variablen oben;
Ergebnis in der Variable 'result'. Antworte NUR mit Code, ohne Markdown."""


def mode() -> str:
    m = os.environ.get("LLM_MODE")
    if m:
        return m
    return "openai" if os.environ.get("OPENAI_API_KEY") else "mock"


def model_name() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-6.2-sol")


def cad_model_name() -> str:
    return os.environ.get("OPENAI_CAD_MODEL") or model_name()


def _m(v: float) -> str:
    """Meter lesbar: 0.1 → '0,1 m' bleibt kurz, aber exakt genug."""
    return f"{v:.4g} m"


def context_text(kontext: dict | None) -> str:
    """Zusatzkontext aus der Hauptapp: Maße, andere Modelle, Pins, bisherige Klärung."""
    k = kontext or {}
    lines = []
    if k.get("masse"):
        d = k["masse"]
        lines.append(f"Modellmaße: Länge {_m(d['laenge'])}, Breite {_m(d['breite'])}, Höhe {_m(d['hoehe'])}")
    andere = [m for m in k.get("modelle") or [] if not m.get("selbst")]
    if andere:
        lines.append("Andere Modelle auf dem Canvas (Name: Länge × Breite × Höhe):")
        lines += [f'"{m["name"]}": {_m(m["laenge"])} × {_m(m["breite"])} × {_m(m["hoehe"])}' for m in andere]
    for pin in k.get("pins") or []:
        ort = [f"Teil {pin['teil']}"] if pin.get("teil") else []
        if pin.get("bild") is not None:
            ort.append("Bildposition %.3f/%.3f" % tuple(pin["bild"]))
        if pin.get("farbe"):
            ort.append("Texturfarbe dort " + bytes(pin["farbe"]).hex())
        if pin.get("umgebung"):
            ort.append("im Umkreis " + ", ".join(f"{bytes(c).hex()} {round(f * 100)}%" for c, f in pin["umgebung"]))
        lines.append(f"Pin {pin.get('n', '?')} ({', '.join(ort) or 'ohne Teil'}): {pin.get('text', '')}")
    verlauf = k.get("verlauf") or []
    if verlauf:
        lines.append("Bisherige Klärung:")
        for e in verlauf:
            wer = "Agent" if e.get("rolle") == "agent" else "Nutzer"
            extra = f" (Teile: {e['teile']})" if e.get("teile") else ""
            lines.append(f"{wer}: {e.get('text', '')}{extra}")
    return "\n".join(lines)


def parts_table(parts, marken=None) -> str:
    marken = marken or {}
    rows = []
    for p in sorted(parts, key=lambda part: (marken.get(part["name"], 10**6), part["name"])):
        nums = (*p.get("mitte", ()), *p.get("groesse", ()))
        bounds = " ".join(f"{n:g}" for n in nums)
        color = bytes(p["farbe_rgb"]).hex() if p.get("farbe_rgb") else "-"
        row = f'{marken.get(p["name"], "-")} {p["name"]} {bounds} {color}'
        if p.get("textur"):
            row += " Textur: " + ", ".join(f"{bytes(c).hex()} {round(a * 100)}%" for c, a in p["textur"])
        rows.append(row)
    return "\n".join(rows)


def build_request(parts, prompt, selected=None, image_data_url=None, model=None, kontext=None):
    """Baut die Anfrage für die Responses API (separat, damit sie ohne Netz testbar ist)."""
    k = kontext or {}
    text = parts_table(parts, k.get("marken"))
    extra = context_text(k)
    if extra:
        text += "\n" + extra
    if selected:
        text += f"\nAuswahl (vom Nutzer im Modell angeklickt, Teilmuster, mehrere kommagetrennt): {selected}"
    text += f"\nAuftrag: {prompt}"
    content = [{"type": "input_text", "text": text}]
    view_detail = os.environ.get("OPENAI_VIEW_DETAIL", "low")
    for url in k.get("ansichten") or []:
        content.append({"type": "input_image", "image_url": url, "detail": view_detail})
    if image_data_url:
        content.append({"type": "input_image", "image_url": image_data_url,
                        "detail": os.environ.get("OPENAI_IMAGE_DETAIL", "low")})
    req = {"model": model or model_name(), "instructions": SYSTEM_PROMPT,
           "input": [{"role": "user", "content": content}],
           "tools": TOOL_SCHEMAS, "parallel_tool_calls": True, "store": False}
    effort = os.environ.get("OPENAI_EFFORT", "low")
    if effort:
        req["reasoning"] = {"effort": effort}
    return req


@lru_cache(maxsize=1)
def _client(base_url, api_key):
    from openai import OpenAI
    return OpenAI(base_url=base_url, api_key=api_key)


def _responses():
    return _client(os.environ.get("OPENAI_BASE_URL"), os.environ.get("OPENAI_API_KEY")).responses


def plan(parts, prompt, selected=None, image_data_url=None, model=None, kontext=None) -> dict:
    """Gibt {'calls': [...], 'text': str, 'usage': {...}} zurück."""
    k = kontext or {}
    simple = not image_data_url and not k.get("verlauf") and not k.get("pins")
    fast = simple_color_call(parts, prompt, selected) if simple else None
    if fast is not None:
        return {"calls": [fast], "text": "", "usage": {
            "modus": "lokal", "input_tokens": 0, "output_tokens": 0, "api_aufrufe": 0}}
    if mode() == "mock":
        return {"calls": mock_plan(parts, prompt, selected, k), "text": "", "usage": {"modus": "mock"}}
    resp = _responses().create(**build_request(parts, prompt, selected, image_data_url, model, k))
    return _result(resp)


def _result(resp) -> dict:
    calls = [{"name": it.name, "arguments": json.loads(it.arguments)} for it in resp.output if it.type == "function_call"]
    return {"calls": calls, "text": getattr(resp, "output_text", "") or "", "usage": response_usage(resp)}


def response_usage(resp):
    usage = {"api_aufrufe": 1}
    if getattr(resp, "usage", None):
        details = getattr(resp.usage, "input_tokens_details", None)
        usage.update(input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens,
                     cached_input_tokens=getattr(details, "cached_tokens", 0) or 0)
    return usage


def generate_cad_code(beschreibung: str, groesse_m, model=None) -> tuple[str, dict]:
    """Zweiter KI-Aufruf: CadQuery-Code für ein neues technisches Teil."""
    dims = ", ".join(f"{v * 1000:.0f} mm" for v in groesse_m)
    prompt = f"Bauteil: {beschreibung}\nZielmaße (Bounding Box x, y, z): {dims}. Die App passt die Größe danach an."
    if mode() == "mock":
        return MOCK_CAD, {}
    resp = _responses().create(model=os.environ.get("OPENAI_CAD_MODEL") or model or model_name(),
                                      instructions=CAD_SYSTEM_PROMPT, input=prompt, store=False)
    code = resp.output_text.strip()
    return re.sub(r"^```(?:python)?\s*|\s*```$", "", code), response_usage(resp)


# Gemeinsame Farbpalette für lokale Aufträge und Mock-Modus.
FARBEN = {"weiß": [255, 255, 255], "weiss": [255, 255, 255], "schwarz": [10, 10, 10], "rot": [210, 30, 30],
          "blau": [30, 70, 220], "grün": [30, 140, 60], "gruen": [30, 140, 60], "gelb": [250, 210, 20],
          "lila": [150, 60, 200], "orange": [250, 140, 20], "grau": [130, 130, 130]}


def simple_color_call(parts, prompt, selected):
    """Nur explizite Einziel-Aufträge ohne weitere Anweisung lokal ausführen."""
    colors = "|".join(FARBEN)
    hit = re.fullmatch(
        rf"(?:(?:mach(?:e)?|färb(?:e)?|lackier(?:e)?) (?:bitte )?)?"
        rf"(?:die |den |das )?([\w]+) ({colors}|#[a-f0-9]{{6}})[.!]?",
        prompt.strip().lower(),
    )
    if not hit:
        # "Mach das blau" kann sich eindeutig auf die Viewer-Auswahl beziehen.
        hit = re.fullmatch(rf"(?:mach(?:e)?|färb(?:e)?|lackier(?:e)?) (das|es) ({colors})[.!]?",
                           prompt.strip().lower())
    if not hit:
        return None
    target, color = hit.groups()
    names = {p["name"].lower(): p["name"] for p in parts}
    if selected and target in ("das", "es", "teil"):
        teil = names.get(selected.lower()) or (selected if "," in selected else None)
    else:
        teil = names.get(target)
        if teil is None:
            group = {"felgen": "felge_", "reifen": "reifen_", "scheinwerfer": "scheinwerfer_"}.get(target)
            if group and any(name.startswith(group) for name in names):
                teil = group + "*"
    if teil is None:
        return None
    rgb = list(bytes.fromhex(color[1:])) if color.startswith("#") else FARBEN[color]
    return {"name": "faerbe", "arguments": {"teil": teil, "rgb": rgb, "modus": "auto", "logos_entfernen": False}}


# ---------------------------------------------------------------- Mock (ohne Schlüssel)
TEILWOERTER = {"felge": "felge_*", "reifen": "reifen_*", "rad": "reifen_*", "räder": "reifen_*", "licht": "scheinwerfer_*",
               "lichter": "scheinwerfer_*", "scheinwerfer": "scheinwerfer_*", "spoiler": "spoiler", "dach": "kabine",
               "kabine": "kabine", "karosserie": "karosserie", "auto": "karosserie", "horn": "horn*"}
ALLES = re.compile(r"\b(alles|ganze[sn]?|komplett|whole|everything|all)\b")


def frage(text, typ="auswahl", optionen=(), standard=None, einheit=None, mehrfach=False):
    return {"name": "frage_nach", "arguments": {
        "frage": text, "typ": typ, "standard": standard, "einheit": einheit, "mehrfach": mehrfach,
        "optionen": [{"id": o[0], "label": o[1], "beschreibung": None, "teile": o[2] if len(o) > 2 else None}
                     for o in optionen]}}


def _mock_size(p):
    """„10 cm lang“, „2 m hoch“ → setze_groesse; „angleichen/match“ → gleiche_an."""
    hit = re.search(r"(\d+(?:[.,]\d+)?)\s*(mm|cm|m|zentimeter|centimeters?|millimeters?|meters?|meter)\b", p)
    if not hit:
        return None
    wert = float(hit.group(1).replace(",", "."))
    unit = hit.group(2)
    einheit = "mm" if unit == "mm" or unit.startswith("milli") else \
        "cm" if unit == "cm" or unit.startswith(("zenti", "centi")) else "m"
    achse = "hoehe" if re.search(r"hoch|high|tall|höhe", p) else "breite" if re.search(r"breit|wide", p) else \
        "laenge" if re.search(r"lang|long|länge|length", p) else "alle"
    return {"name": "setze_groesse", "arguments": {"teil": "*", "achse": achse, "wert": wert, "einheit": einheit,
                                                     "proportional": True, "anker": "boden"}}


def mock_plan(parts, prompt, selected=None, kontext=None):
    k = kontext or {}
    p = prompt.lower()
    antworten = [e for e in k.get("verlauf") or [] if e.get("rolle") != "agent"]
    antwort = antworten[-1] if antworten else None
    if antwort:
        p += " " + str(antwort.get("text", "")).lower()
    if re.fullmatch(r"(?:füge einen (?:heckflügel|spoiler) hinzu|setz einen (?:heckflügel|spoiler) drauf)[.!]?", prompt.lower().strip()):
        return [{"name": "baue", "arguments": {"bezug": None, "teile": [
            {"name": "heckfluegel", "form": "keil", "quelle": None, "profil": None,
             "positionen": [[-0.43, 0.38, 0]], "groesse": [0.16, 0.07, 0.8],
             "drehung": [0, 0, 0], "rgb": [30, 30, 30]}
        ]}}]
    logo = re.search(r"(?:vom|von|das|den|dem|ein(?:en)?|the|an?)\s+([\w\s.-]+?)[\s-]*(?:logo|sticker|aufkleber)",
                     " ".join(str(x.get("text", "")).lower() for x in k.get("pins") or []))
    if logo:
        pin = k["pins"][-1]
        return [{"name": "klebe_logo", "arguments": {
            "teil": pin.get("teil") or selected or "*", "quelle": "web", "marke": re.split(r"\b(?:sticker|vom|von|das|den|dem|einen?|the|an?)\s+", logo.group(1))[-1].strip(), "domain": None,
            "text": None, "rgb": None, "pin": pin.get("n"), "bild_position": None, "seite": None if pin.get("bild") else "links",
            "position": None, "breite_m": 0.5, "drehung": 0, "nur_symbol": bool(re.search(r"nur .*(logo|symbol|zeichen)|ohne (text|schrift)|only .*logo|without text", " ".join(str(x.get("text", "")).lower() for x in k.get("pins") or [])))}}]
    if re.search(r"oldtimer|daraus ein|turn (it )?into|make (it|this) (a|an) ", p) and not antwort:
        return [frage("Das geht nur als Änderung am vorhandenen Modell. Was soll sich konkret ändern?",
                      optionen=[("farbe", "Farbe ändern"), ("groesse", "Größe ändern"), ("nichts", "Abbrechen")])]
    calls = []
    size = _mock_size(p)
    if size:
        calls.append(size)
        if re.search(r"gleich|angleich|match|other sizes|andere", p):
            andere = [m for m in k.get("modelle") or [] if not m.get("selbst")]
            ref = antwort.get("modell") if antwort and antwort.get("modell") else None
            if ref is None and len(andere) == 1:
                ref = andere[0]["name"]
            if ref is None and len(andere) > 1:
                return [frage("An welches Modell soll ich die Größe angleichen?", typ="modell")]
            if ref is not None:
                calls = [{"name": "gleiche_an", "arguments": {"teil": "*", "referenz": ref, "achse": "alle",
                                                               "proportional": True, "anker": "boden"}}] + calls
        return calls
    teil = antwort.get("teile") if antwort and antwort.get("teile") else selected
    if not (antwort and antwort.get("teile")):
        for wort, muster in TEILWOERTER.items():
            if wort in p:
                teil = muster
                break
    if ("vorne" in p or "vorder" in p) and teil and teil.endswith("_*"):
        teil = teil[:-1] + "v*"
    if ("hinten" in p or "hinter" in p) and teil and teil.endswith("_*"):
        teil = teil[:-1] + "h*"
    farbe = next((rgb for wort, rgb in FARBEN.items() if wort in p), None)
    if farbe and ALLES.search(prompt.lower()) and not antwort and len(parts) > 1:
        return [frage("Auch Räder und Scheiben?", optionen=[
            ("alles", "Alles", "*"), ("karosserie", "Nur Karosserie", "karosserie*"),
            ("ohne", "Ohne Räder und Glas", "karosserie*")], standard="ohne")]
    if not teil and farbe and ALLES.search(p):
        teil = "*"
    if not teil:
        return [frage("Welches Teil meinst du? Klick es im Modell an.", typ="teil", mehrfach=True)]
    if farbe:
        return [{"name": "faerbe", "arguments": {"teil": teil, "rgb": farbe, "modus": "auto",
                                                   "logos_entfernen": bool(re.search(r"logo|aufdruck|einfarbig", p))}}]
    if "weg" in p or "lösch" in p or "ohne" in p:
        return [{"name": "loesche", "arguments": {"teil": teil}}]
    if "größer" in p or "groesser" in p:
        return [{"name": "skaliere", "arguments": {"teil": teil, "x": 1.3, "y": 1.3, "z": 1.3, "anker": "boden"}}]
    if "kleiner" in p:
        return [{"name": "skaliere", "arguments": {"teil": teil, "x": 0.75, "y": 0.75, "z": 0.75, "anker": "boden"}}]
    if "höher" in p or "hoeher" in p:
        return [{"name": "verschiebe", "arguments": {"teil": teil, "x": 0, "y": 0.2, "z": 0}}]
    if "stern" in p or "andere form" in p or "neue" in p:
        return [{"name": "ersetze", "arguments": {"teil": teil, "beschreibung": prompt, "art": "technisch"}}]
    return [frage("Was soll sich ändern?", optionen=[
        ("farbe", "Farbe"), ("groesse", "Größe"), ("position", "Position"), ("form", "Form")])]


MOCK_CAD = """import cadquery as cq
import math
durchmesser = 500.0
breite = 300.0
anzahl_speichen = 5
ring = cq.Workplane("XY").circle(durchmesser / 2).circle(durchmesser / 2 - 40).extrude(breite).translate((0, 0, -breite / 2))
nabe = cq.Workplane("XY").circle(60).extrude(breite * 0.6).translate((0, 0, -breite * 0.1))
result = ring.union(nabe)
for i in range(anzahl_speichen):
    sp = (cq.Workplane("XY").center(0, (durchmesser / 2 - 20) / 2).rect(45, durchmesser / 2 - 20)
          .extrude(40).translate((0, 0, breite / 2 - 60)).rotate((0, 0, 0), (0, 0, 1), 360 / anzahl_speichen * i))
    result = result.union(sp)
"""
