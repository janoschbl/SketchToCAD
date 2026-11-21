"""ChatGPT-Bearbeitung im KI-Studio: Nutzerwunsch („Mach das Flügelmuster blau-grün, überwiegend blau“)
→ Bearbeitungsschritte für den Heim-PC-Server (/region: palette | restyle | replace | delete).

Das Modell sieht das aktuelle Bild der Figur und dasselbe Bild mit eingefärbten, nummerierten Teilen und wählt
darüber die Teile aus. Ohne OPENAI_API_KEY (LLM_MODE=mock) übernehmen einfache Regeln: Farbwörter, Anteile
(„überwiegend“, „mostly“) und Teilwörter (Flügel/wings, Körper/body) über die Lage der Teile.
"""
from __future__ import annotations

import json
import os
import re

from . import planner

SYSTEM = """You are the editing agent of "AI Studio", where a 3D model was built from a sketch.
You get the subject (e.g. butterfly), the list of parts (id, name, area share of the figure, centroid in a
512x512 image, side) and two images: the current front render and the same render with every part tinted
and labeled with its id. Turn the user's request into edit steps that the app executes in order.

Operations:
- palette: recolor parts with one or more colors while keeping the existing pattern, veins and shading.
  colors = [{hex, share}], shares sum to 1. "mostly blue with some green" -> blue 0.7, green 0.3.
  "blue and green, mostly blue" -> blue ~0.7, green ~0.3. Use vivid, natural hex colors.
  Use this for every color request (single colors too: one entry with share 1). Fast (< 2 s).
- restyle: regenerate the surface texture from a short English prompt in `text` (e.g. "white polka dots",
  "leopard spots"), shape stays. Slow (~20 s). Only when a new pattern/texture is asked for, not for colors.
- replace: regenerate the area with a new shape from `text` (English). Only when asked to change the shape.
- delete: remove the parts.

Choosing parts: look at the labeled image. A butterfly's wings are usually several segments (fore and hind wing
per side, sometimes inner patches) - include all of them unless the user restricts it (left/right/front/hind).
"pattern" or "wing pattern" means the wing surfaces. "body" is the thin central part.
Ladybug (seen from above): the two big dome halves are the elytra / shell (Flügeldecken, "Schale", "Rücken");
the small dark part at the front is head + pronotum (Kopf/Halsschild); spots belong to the shell. Starfish (seen
from above): the five arms are the star (Arme), the round middle is the central disc (Mitte); if the figure is one
single part, edit that part. Use only ids from the list.
If the user selected parts in the app (`selected`), apply the request to those unless they clearly mean others.

`reply`: one short, friendly sentence in the user's language saying what you are doing.
Unused fields: empty list / empty string."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply", "steps"],
    "properties": {
        "reply": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["op", "parts", "colors", "text"],
                "properties": {
                    "op": {"type": "string", "enum": ["palette", "restyle", "replace", "delete"]},
                    "parts": {"type": "array", "items": {"type": "string"}},
                    "colors": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["hex", "share"],
                            "properties": {"hex": {"type": "string"}, "share": {"type": "number"}},
                        },
                    },
                    "text": {"type": "string"},
                },
            },
        },
    },
}


def parts_text(parts):
    rows = []
    for p in parts:
        side = "center" if abs(p.get("cx", 256) - 256) < 30 else ("left" if p.get("cx", 256) < 256 else "right")
        vert = "upper" if p.get("cy", 256) < 240 else "lower"
        rows.append(f"- {p['id']}: \"{p.get('name', p['id'])}\" area {p.get('share', 0):.0%}, centroid "
                    f"({p.get('cx', 0):.0f}, {p.get('cy', 0):.0f}), {side} {vert}")
    return "\n".join(rows)


def build_request(body: dict, model=None):
    text = (f"Subject: {body.get('subject') or 'animal'}\nParts:\n{parts_text(body.get('parts') or [])}\n"
            f"Selected in the app: {', '.join(body.get('selected') or []) or 'nothing'}\n")
    hist = [h for h in (body.get("history") or [])[-6:] if h.get("text")]
    if hist:
        text += "Earlier in this chat:\n" + "\n".join(f"{h.get('role', 'user')}: {h['text']}" for h in hist) + "\n"
    text += f"Request: {body.get('prompt', '')}"
    content = [{"type": "input_text", "text": text}]
    detail = os.environ.get("OPENAI_IMAGE_DETAIL", "low")
    for key in ("image", "labeled"):
        if body.get(key):
            content.append({"type": "input_image", "image_url": body[key], "detail": detail})
    req = {"model": model or planner.model_name(), "instructions": SYSTEM,
           "input": [{"role": "user", "content": content}], "store": False,
           "text": {"format": {"type": "json_schema", "name": "studio_plan", "schema": SCHEMA, "strict": True}}}
    effort = os.environ.get("OPENAI_EFFORT", "low")
    if effort:
        req["reasoning"] = {"effort": effort}
    return req


def clean(plan: dict, parts) -> dict:
    ids = {p["id"] for p in parts}
    steps = []
    for s in plan.get("steps") or []:
        op = s.get("op")
        sel = [p for p in s.get("parts") or [] if p in ids]
        if op not in ("palette", "restyle", "replace", "delete") or not sel:
            continue
        cols = [c for c in s.get("colors") or [] if re.fullmatch(r"#?[0-9a-fA-F]{6}", str(c.get("hex", "")))]
        cols = [{"hex": "#" + c["hex"].lstrip("#").lower(), "share": max(float(c.get("share") or 0), 0.01)} for c in cols]
        if op == "palette" and not cols:
            continue
        if op in ("restyle", "replace") and not (s.get("text") or "").strip():
            continue
        steps.append({"op": op, "parts": sel, "colors": cols, "text": (s.get("text") or "").strip()})
    return {"reply": (plan.get("reply") or "").strip(), "steps": steps}


def plan(body: dict, model=None) -> dict:
    parts = body.get("parts") or []
    if planner.mode() == "mock":
        return {**clean(mock_plan(body), parts), "usage": {"modus": "mock"}}
    resp = planner._responses().create(**build_request(body, model))
    out = json.loads(resp.output_text)
    return {**clean(out, parts), "usage": planner.response_usage(resp)}


# ---------------------------------------------------------------- Mock (ohne Schlüssel)
COLORS = {
    "blue": "#1f5fe0", "blau": "#1f5fe0", "green": "#2ea043", "grün": "#2ea043", "gruen": "#2ea043",
    "red": "#e02020", "rot": "#e02020", "yellow": "#f0d828", "gelb": "#f0d828", "orange": "#f08c14",
    "purple": "#8a3ab9", "violet": "#8a3ab9", "lila": "#8a3ab9", "pink": "#f078b4", "rosa": "#f078b4",
    "black": "#202020", "schwarz": "#202020", "white": "#f4f4f4", "weiß": "#f4f4f4", "weiss": "#f4f4f4",
    "brown": "#7a4a1e", "braun": "#7a4a1e", "turquoise": "#20c0c0", "türkis": "#20c0c0", "cyan": "#20c0c0",
    "gold": "#e0b020", "golden": "#e0b020", "grey": "#8c8c8c", "gray": "#8c8c8c", "grau": "#8c8c8c",
    "light blue": "#6ec0f0", "hellblau": "#6ec0f0", "dark blue": "#163a9a", "dunkelblau": "#163a9a",
}
MOSTLY = r"(?:mostly|mainly|mostly in|überwiegend|hauptsächlich|vor allem|größtenteils|meist(?:ens)?)"


def mock_plan(body: dict) -> dict:
    t = (body.get("prompt") or "").lower()
    found = []
    for m in re.finditer(r"(light blue|dark blue|hellblau|dunkelblau|[a-zäöüß]+)", t):
        w = m.group(1)
        if w in COLORS and COLORS[w] not in [c for c, _ in found]:
            found.append((COLORS[w], m.start()))
    parts = body.get("parts") or []
    wings = [p["id"] for p in parts if abs(p.get("cx", 256) - 256) > 30 and p.get("share", 0) > 0.03]
    body_ids = [p["id"] for p in parts if p["id"] not in wings]
    if re.search(r"flügel|wing|muster|pattern|schale|shell|elytra|arme|arms", t):
        sel = wings
    elif re.search(r"körper|koerper|rumpf|body", t):
        sel = body_ids
    else:
        sel = body.get("selected") or [p["id"] for p in parts]
    if not found or not sel:
        return {"reply": "Without an OpenAI key I only understand simple color requests (e.g. “wings blue and green, mostly blue”).", "steps": []}
    shares = [1.0] * len(found)
    mm = re.search(MOSTLY + r"\s+(?:in\s+)?([a-zäöüß ]+)", t)
    if mm:
        for i, (hx, _) in enumerate(found):
            if any(COLORS.get(w) == hx for w in mm.group(1).split()[:2]):
                shares = [0.3 / max(len(found) - 1, 1)] * len(found)
                shares[i] = 0.7 if len(found) > 1 else 1.0
                break
    tot = sum(shares)
    cols = [{"hex": hx, "share": round(s / tot, 3)} for (hx, _), s in zip(found, shares)]
    names = " / ".join(f"{c['hex']} {round(c['share'] * 100)}%" for c in cols)
    return {"reply": f"Recoloring {len(sel)} part(s): {names}.",
            "steps": [{"op": "palette", "parts": sel, "colors": cols, "text": t}]}
