"""Der Werkzeugkasten: die einzigen Operationen, die die KI auslösen kann.
Jedes Werkzeug ändert nur die gemeinten Teile. Alles andere bleibt unverändert."""
from __future__ import annotations

import fnmatch

import numpy as np
import trimesh

from . import model_io

TEIL = {"type": "string", "description": "Teilname aus der Teileliste; Platzhalter * erlaubt (z. B. 'felge_*')."}
NUM = {"type": "number"}

TOOL_SCHEMAS = [
    {"type": "function", "name": "faerbe", "description": "Ändert die Farbe ganzer Teile.",
     "parameters": {"type": "object", "properties": {
         "teil": TEIL, "rgb": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 255}, "minItems": 3, "maxItems": 3}},
         "required": ["teil", "rgb"], "additionalProperties": False}},
    {"type": "function", "name": "skaliere",
     "description": "Vergrößert/verkleinert Teile. Getrennte Faktoren je Achse möglich (x=Länge, y=Höhe, z=Breite). "
                    "anker='boden' hält die Unterkante am Boden (z. B. Räder), anker='basis' hält die Unterseite fest (z. B. Horn auf Kopf).",
     "parameters": {"type": "object", "properties": {
         "teil": TEIL, "x": NUM, "y": NUM, "z": NUM,
         "anker": {"type": "string", "enum": ["mitte", "boden", "basis"]}},
         "required": ["teil", "x", "y", "z", "anker"], "additionalProperties": False}},
    {"type": "function", "name": "verschiebe", "description": "Verschiebt Teile (Meter; y = oben).",
     "parameters": {"type": "object", "properties": {"teil": TEIL, "x": NUM, "y": NUM, "z": NUM},
                    "required": ["teil", "x", "y", "z"], "additionalProperties": False}},
    {"type": "function", "name": "drehe", "description": "Dreht Teile um ihren Mittelpunkt.",
     "parameters": {"type": "object", "properties": {"teil": TEIL, "achse": {"type": "string", "enum": ["x", "y", "z"]}, "grad": NUM},
                    "required": ["teil", "achse", "grad"], "additionalProperties": False}},
    {"type": "function", "name": "loesche", "description": "Entfernt Teile.",
     "parameters": {"type": "object", "properties": {"teil": TEIL}, "required": ["teil"], "additionalProperties": False}},
    {"type": "function", "name": "ersetze",
     "description": "Ersetzt Teile durch ein NEU erzeugtes Teil (nur wenn sich die FORM ändern soll). "
                    "art='technisch' für geometrische Teile (Felgen, Lampen, Möbel): wird als CAD-Code erzeugt. "
                    "art='organisch' für Tiere, Pflanzen, Figurenteile. Beschreibung ohne Markennamen.",
     "parameters": {"type": "object", "properties": {
         "teil": TEIL, "beschreibung": {"type": "string"},
         "art": {"type": "string", "enum": ["technisch", "organisch"]}},
         "required": ["teil", "beschreibung", "art"], "additionalProperties": False}},
    {"type": "function", "name": "frage_nach",
     "description": "Rückfrage an den Nutzer, wenn unklar ist, welches Teil gemeint ist, das Teil nicht existiert "
                    "oder der Auftrag eine komplette Neuerstellung wäre.",
     "parameters": {"type": "object", "properties": {"frage": {"type": "string"}},
                    "required": ["frage"], "additionalProperties": False}},
]

SYSTEM_PROMPT = """Du bearbeitest ein BESTEHENDES 3D-Modell für Film-Requisiten. Du darfst es NIEMALS neu erstellen.
Nutze ausschließlich die Werkzeuge. Ändere nur die Teile, die der Nutzer meint; nur GANZE Teile sind änderbar.
Koordinaten in Metern, y = oben. „links/rechts“ aus Sicht des Objekts selbst (Fahrersicht/Blickrichtung der Figur), +x = vorne.
Farben als RGB 0–255. Gleiche Teile auf beiden Seiten mit EINEM Aufruf und Platzhalter ansprechen (z. B. 'felge_v*').
Bei vagen Wünschen (z. B. „sportlicher“) oder fehlenden Teilen: frage_nach mit einem konkreten Vorschlag.
Wenn ein Teil ausgewählt ist, bezieht sich der Auftrag im Zweifel auf dieses Teil."""


class ToolError(Exception):
    pass


def match(scene, pattern: str) -> list[str]:
    names = [n for n in scene.geometry if fnmatch.fnmatch(n.lower(), str(pattern).lower())]
    if not names:
        raise ToolError(f"Kein Teil passt zu '{pattern}'. Vorhanden: {', '.join(scene.geometry)}")
    return names


def _scale_about(mesh, s, anchor_point):
    T = trimesh.transformations.translation_matrix(anchor_point)
    Ti = trimesh.transformations.translation_matrix(-anchor_point)
    S = np.diag([s[0], s[1], s[2], 1.0])
    mesh.apply_transform(T @ S @ Ti)


def faerbe(scene, teil, rgb):
    names = match(scene, teil)
    for n in names:
        model_io.set_color(scene.geometry[n], rgb)
    return names


def skaliere(scene, teil, x=1.0, y=1.0, z=1.0, anker="mitte"):
    names = match(scene, teil)
    s = [float(x), float(y), float(z)]
    if min(s) <= 0 or max(s) > 20:
        raise ToolError("Skalierungsfaktoren müssen zwischen 0 und 20 liegen.")
    for n in names:
        m = scene.geometry[n]
        lo, hi = m.bounds
        p = (lo + hi) / 2
        if anker in ("boden", "basis"):
            p = np.array([p[0], lo[1], p[2]])
        _scale_about(m, s, p)
    return names


def verschiebe(scene, teil, x=0.0, y=0.0, z=0.0):
    names = match(scene, teil)
    for n in names:
        scene.geometry[n].apply_translation([float(x), float(y), float(z)])
    return names


def drehe(scene, teil, achse, grad):
    axis = {"x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}[achse]
    names = match(scene, teil)
    for n in names:
        m = scene.geometry[n]
        c = m.bounds.mean(0)
        R = trimesh.transformations.rotation_matrix(np.radians(float(grad)), axis, c)
        m.apply_transform(R)
    return names


def loesche(scene, teil):
    names = match(scene, teil)
    scene.delete_geometry(names)
    return names


def ersetze_mit_mesh(scene, teil, neu: trimesh.Trimesh):
    """Setzt ein neues Teil passend in Position und Größe des alten ein.
    Teile auf der Gegenseite (z der Teilmitte < z der Modellmitte) bekommen das gespiegelte Teil,
    damit die Schauseite außen liegt. Das neue Teil wird nur EINMAL erzeugt."""
    names = match(scene, teil)
    model_center_z = scene.bounds.mean(0)[2]
    for n in names:
        old = scene.geometry[n]
        m = neu.copy()
        if old.bounds.mean(0)[2] < model_center_z:
            m.apply_transform(trimesh.transformations.reflection_matrix([0, 0, 0], [0, 0, 1]))
            m.invert()
        s = (old.extents / np.maximum(m.extents, 1e-9)).min()
        m.apply_scale(s)
        m.apply_translation(old.bounds.mean(0) - m.bounds.mean(0))
        col = model_io.color_of(old)
        if col:
            model_io.set_color(m, col)
        scene.geometry[n] = m
    return names


SIMPLE_TOOLS = {"faerbe": faerbe, "skaliere": skaliere, "verschiebe": verschiebe, "drehe": drehe, "loesche": loesche}
