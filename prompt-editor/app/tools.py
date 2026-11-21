"""Der Werkzeugkasten: die einzigen Operationen, die die KI auslösen kann.
Jedes Werkzeug ändert nur die gemeinten Teile. Alles andere bleibt unverändert."""
from __future__ import annotations

import fnmatch

import numpy as np
import trimesh

from . import model_io

def object_schema(**properties):
    return {"type": "object", "properties": properties, "required": list(properties),
            "additionalProperties": False}


def function(name, description, **properties):
    return {"type": "function", "name": name, "description": description,
            "strict": True, "parameters": object_schema(**properties)}


def array(items, minimum, maximum):
    return {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}


def nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


def choice(*values):
    return {"type": "string", "enum": list(values)}


STR = {"type": "string"}
NUM = {"type": "number"}
TEIL = {**STR, "description": "Teilname, * als Platzhalter."}
UV = array(NUM, 2, 2)
XYZ = array(NUM, 3, 3)
RGB = array({"type": "integer", "minimum": 0, "maximum": 255}, 3, 3)
VORLAGE = object_schema(
    name=STR, form=choice("box", "keil", "kugel", "zylinder", "kegel", "profil", "kopie"),
    quelle=nullable(STR), profil=nullable(array(UV, 3, 32)), positionen=array(XYZ, 1, 32), groesse=XYZ, drehung=XYZ, rgb=nullable(RGB),
)

TOOL_SCHEMAS = [
    function("faerbe", "Einfarbig lackieren.", teil=TEIL, rgb=RGB),
    function("skaliere", "Faktoren pro Achse. boden/basis hält Unterkante.",
             teil=TEIL, x=NUM, y=NUM, z=NUM, anker=choice("mitte", "boden", "basis")),
    function("verschiebe", "Versatz in Modelleinheiten.", teil=TEIL, x=NUM, y=NUM, z=NUM),
    function("drehe", "Rotation um Teilmitte.", teil=TEIL, achse=choice("x", "y", "z"), grad=NUM),
    function("loesche", "Teile entfernen.", teil=TEIL),
    function("ersetze", "Teilform austauschen. technisch erzeugt CadQuery. organisch nicht verfügbar.",
             teil=TEIL, beschreibung=STR, art=choice("technisch", "organisch")),
    function("baue", "Vorlagen hinzufügen. bezug=null: ganzes Modell. Position ab Bezugsmitte und Größe "
             "als Anteile der Bezugsmaße pro Achse (0.5 an der Kante). Euler-XYZ in Grad nach Skalierung. "
             "Zylinder/Kegel: +Y. profil: XY-Polygon mit Dicke in Z. quelle nur für kopie. "
             "Eindeutige Namen aus ASCII-Buchstaben, Zahlen und _. Mehrere Positionen hängen _1, _2 usw. an.",
             bezug=nullable(STR), teile=array(VORLAGE, 1, 32)),
    function("lackiere", "Lack, Muster, Sticker. Motiv für art=grafik: gefüllte Polygone in Motivkoordinaten 0–1. "
             "rgb/metall/rauheit=null "
             "übernimmt vorhandene Grundfarbe/Oberflächenwerte. Nur Sticker: bestehende Editor-Textur behalten. "
             "Stickerposition UV [0,1], v nach oben, breite relativ zur Seite. text=null nutzt Bildanhang.",
             teil=TEIL, rgb=nullable(RGB), metall=nullable(NUM), rauheit=nullable(NUM),
             muster=nullable(object_schema(art=choice("streifen", "karo", "punkte", "grafik"),
                                           anzahl={"type": "integer"}, rgb=RGB,
                                           motiv=nullable(array(array(UV, 3, 24), 1, 8)))),
             sticker=nullable(object_schema(seite=choice("vorne", "hinten", "oben", "unten", "links", "rechts"),
                                            position=UV, breite=NUM, text=nullable(STR), rgb=RGB))),
    function("frage_nach", "Kurze konkrete Rückfrage bei fehlender Information.", frage=STR),
]

SYSTEM_PROMPT = """Bearbeite das vorhandene 3D-Modell per Werkzeug. Y oben, +X vorne, +Z links aus Objektsicht.
Teiletabelle: Name, Mitte xyz, Ausmaß xyz, RGB hex. Verwende Teilnamen oder gemeinsame *-Muster.
Kombiniere vorhandene Teile, Transformationen und neue Vorlagen (z.B. Keil, Spoiler oder Sitzreihen)
für Umbauten. Kopiere vorhandene passende Teile bevorzugt. Lösche nur eindeutig überzählige Teile.
Erhalte übrige Geometrie. Nutze Auswahl als Standard. Wenn Ziele anhand der Namen unklar sind, frage nach.
Gib Werkzeugaufrufe in Ausführungsreihenfolge aus, ohne zusätzliche Erklärung."""


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
    if not np.all(np.isfinite(s)) or min(s) <= 0 or max(s) > 20:
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
    offset = np.array([x, y, z], dtype=float)
    if not np.isfinite(offset).all():
        raise ToolError("Versatz muss endlich sein.")
    for n in names:
        scene.geometry[n].apply_translation(offset)
    return names


def drehe(scene, teil, achse, grad):
    if not np.isfinite(float(grad)):
        raise ToolError("Drehwinkel muss endlich sein.")
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
    if len(names) == len(scene.geometry):
        raise ToolError("Mindestens ein Teil muss im Modell bleiben.")
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
