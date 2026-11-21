"""Der KI-Schritt: Auftrag + Teileliste (+ optional Bild) → Werkzeug-Aufrufe.

Anbieter per Umgebungsvariable:
  LLM_MODE=openai   echte OpenAI Responses API (Standard, wenn OPENAI_API_KEY gesetzt ist)
  LLM_MODE=mock     einfache Regeln, zum Testen ohne Schlüssel
  OPENAI_MODEL      Planer-Modell: gpt-6.1-sol (Standard), gpt-6.2-sol, gpt-6.2-astra (stärkstes) oder gpt-6.1-terra (günstigstes)
  OPENAI_CAD_MODEL  optional eigenes Modell nur für den CAD-Code neuer Teile (z. B. gpt-6.2-astra)
  OPENAI_EFFORT     Denkaufwand: low (Standard), medium, high
  OPENAI_BASE_URL   optional, für OpenAI-kompatible Anbieter
"""
from __future__ import annotations

import json
import os
import re

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
    return os.environ.get("OPENAI_MODEL", "gpt-6.1-sol")


def cad_model_name() -> str:
    return os.environ.get("OPENAI_CAD_MODEL") or model_name()


def build_request(parts, prompt, selected=None, image_data_url=None, model=None):
    """Baut die Anfrage für die Responses API (separat, damit sie ohne Netz testbar ist)."""
    text = f"Teileliste (aktueller Stand):\n{json.dumps(parts, ensure_ascii=False)}\n"
    if selected:
        text += f"\nVom Nutzer im Viewer ausgewähltes Teil: {selected}\n"
    text += f"\nAuftrag: {prompt}"
    content = [{"type": "input_text", "text": text}]
    if image_data_url:
        content.append({"type": "input_text", "text": "Referenzbild des Nutzers (z. B. gewünschter Look oder gewünschte Form):"})
        content.append({"type": "input_image", "image_url": image_data_url})
    req = {"model": model or model_name(), "instructions": SYSTEM_PROMPT,
           "input": [{"role": "user", "content": content}],
           "tools": TOOL_SCHEMAS, "parallel_tool_calls": True}
    effort = os.environ.get("OPENAI_EFFORT", "low")
    if effort:
        req["reasoning"] = {"effort": effort}
    return req


def _client():
    from openai import OpenAI
    kw = {}
    if os.environ.get("OPENAI_BASE_URL"):
        kw["base_url"] = os.environ["OPENAI_BASE_URL"]
    return OpenAI(**kw)


def plan(parts, prompt, selected=None, image_data_url=None, model=None) -> dict:
    """Gibt {'calls': [...], 'text': str, 'usage': {...}} zurück."""
    if mode() == "mock":
        return {"calls": mock_plan(parts, prompt, selected), "text": "", "usage": {"modus": "mock"}}
    resp = _client().responses.create(**build_request(parts, prompt, selected, image_data_url, model))
    calls = [{"name": it.name, "arguments": json.loads(it.arguments)} for it in resp.output if it.type == "function_call"]
    usage = {}
    if getattr(resp, "usage", None):
        usage = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
    return {"calls": calls, "text": getattr(resp, "output_text", "") or "", "usage": usage}


def generate_cad_code(beschreibung: str, groesse_m, model=None) -> str:
    """Zweiter KI-Aufruf: CadQuery-Code für ein neues technisches Teil."""
    dims = ", ".join(f"{v * 1000:.0f} mm" for v in groesse_m)
    prompt = f"Bauteil: {beschreibung}\nZielmaße (Bounding Box x, y, z): {dims}. Die App passt die Größe danach an."
    if mode() == "mock":
        return MOCK_CAD
    resp = _client().responses.create(model=os.environ.get("OPENAI_CAD_MODEL") or model or model_name(),
                                      instructions=CAD_SYSTEM_PROMPT, input=prompt)
    code = resp.output_text.strip()
    return re.sub(r"^```(?:python)?\s*|\s*```$", "", code)


# ---------------------------------------------------------------- Mock (ohne Schlüssel)
FARBEN = {"weiß": [255, 255, 255], "weiss": [255, 255, 255], "schwarz": [10, 10, 10], "rot": [210, 30, 30],
          "blau": [30, 70, 220], "grün": [30, 140, 60], "gruen": [30, 140, 60], "gelb": [250, 210, 20],
          "lila": [150, 60, 200], "orange": [250, 140, 20], "grau": [130, 130, 130]}
TEILWOERTER = {"felge": "felge_*", "reifen": "reifen_*", "rad": "reifen_*", "räder": "reifen_*", "licht": "scheinwerfer_*",
               "lichter": "scheinwerfer_*", "scheinwerfer": "scheinwerfer_*", "spoiler": "spoiler", "dach": "kabine",
               "kabine": "kabine", "karosserie": "karosserie", "auto": "karosserie", "horn": "horn*"}


def mock_plan(parts, prompt, selected=None):
    p = prompt.lower()
    teil = selected
    for wort, muster in TEILWOERTER.items():
        if wort in p:
            teil = muster
            break
    if ("vorne" in p or "vorder" in p) and teil and teil.endswith("_*"):
        teil = teil[:-1] + "v*"
    if ("hinten" in p or "hinter" in p) and teil and teil.endswith("_*"):
        teil = teil[:-1] + "h*"
    if not teil:
        return [{"name": "frage_nach", "arguments": {"frage": "Welches Teil meinst du? Klicke es im Viewer an."}}]
    for wort, rgb in FARBEN.items():
        if wort in p:
            return [{"name": "faerbe", "arguments": {"teil": teil, "rgb": rgb}}]
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
    return [{"name": "frage_nach", "arguments": {"frage": "Was genau soll sich ändern: Farbe, Größe, Position oder Form?"}}]


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
