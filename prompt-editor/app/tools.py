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
TEIL = {**STR, "description": "Teilname, * als Platzhalter; mehrere Teile mit Komma trennen."}
UV = array(NUM, 2, 2)
XYZ = array(NUM, 3, 3)
RGB = array({"type": "integer", "minimum": 0, "maximum": 255}, 3, 3)
VORLAGE = object_schema(
    name=STR, form=choice("box", "keil", "kugel", "zylinder", "kegel", "profil", "kopie"),
    quelle=nullable(STR), profil=nullable(array(UV, 3, 32)), positionen=array(XYZ, 1, 32), groesse=XYZ, drehung=XYZ, rgb=nullable(RGB),
)

GROESSE_ACHSE = choice("laenge", "breite", "hoehe", "alle")
OPTION = object_schema(id=STR, label=STR, beschreibung=nullable(STR),
                       teile=nullable({**STR, "description": "Teilmuster, das diese Option meint."}))

TOOL_SCHEMAS = [
    function("faerbe", "Farbe eines ganzen Teils (auch weiß). modus auto: bei texturierten Teilen wird der Lack "
             "umgefärbt (Grundfarbe → rgb, Schattierung, dunkle Details wie Scheiben und Gummi bleiben), bei "
             "einfarbigen Teilen die Farbe gesetzt; Logos als eigene Teile (logo_*) bleiben unberührt. "
             "logos_entfernen=true übermalt zusätzlich alle Aufdrucke in der Textur (Logos, Streifen) flach in rgb. "
             "toenen multipliziert nur (weiß ändert nichts); ersetzen macht das Teil einfarbig ohne Textur.",
             teil=TEIL, rgb=RGB, modus=choice("auto", "toenen", "ersetzen"), logos_entfernen={"type": "boolean"}),
    function("faerbe_bereich", "Nur einen Bereich der Textur eines Teils umfärben oder entfernen (Logo, Aufdruck, "
             "Scheiben in der Textur, Grundlack). Bereich = Texel nahe einer der quellfarben (Abstand <= toleranz, "
             "0–255), optional begrenzt auf bild_bereich [x0, y0, x1, y1] im Texturbild (0–1, oben links 0,0). "
             "ziel_rgb=null entfernt den Bereich (füllt mit der Umgebungsfarbe). Schattierung bleibt erhalten.",
             teil=TEIL, quellfarben=array(RGB, 1, 6), toleranz=NUM,
             bild_bereich=nullable(array(NUM, 4, 4)), ziel_rgb=nullable(RGB)),
    function("skaliere", "Faktoren pro Achse, jedes Teil um seine eigene Mitte. boden/basis hält Unterkante.",
             teil=TEIL, x=NUM, y=NUM, z=NUM, anker=choice("mitte", "boden", "basis")),
    function("setze_groesse", "Echte Größe setzen. Alle Treffer werden gemeinsam skaliert (teil='*' = ganzes Modell). "
             "laenge = längste waagerechte Achse, breite = andere waagerechte, hoehe = Y, alle = größte Ausdehnung. "
             "proportional=true skaliert die anderen Achsen mit.",
             teil=TEIL, achse=GROESSE_ACHSE, wert=NUM, einheit=choice("mm", "cm", "m"),
             proportional={"type": "boolean"}, anker=choice("mitte", "boden")),
    function("gleiche_an", "Größe an ein anderes Modell vom Canvas (Name aus der Modelltabelle) oder an ein Teil "
             "dieses Modells angleichen, auf der gewählten Achse. Alle Treffer werden gemeinsam skaliert.",
             teil=TEIL, referenz=STR, achse=GROESSE_ACHSE, proportional={"type": "boolean"},
             anker=choice("mitte", "boden")),
    function("verschiebe", "Versatz in Metern.", teil=TEIL, x=NUM, y=NUM, z=NUM),
    function("drehe", "Rotation um Teilmitte.", teil=TEIL, achse=choice("x", "y", "z"), grad=NUM),
    function("loesche", "Teile entfernen.", teil=TEIL),
    function("benenne", "Bedeutungslose Teilnamen (teil_03, Node__1, Modellname_2) durch sprechende ersetzen. "
             "Neuer Name = gruppe_name, z. B. glas_frontscheibe, raeder_vorne_links.",
             teile=array(object_schema(teil=STR, name=STR, gruppe=choice(
                 "karosserie", "glas", "raeder", "innenraum", "chrom", "licht", "anbau", "sonstiges")), 1, 64)),
    function("ersetze", "Teilform austauschen. technisch erzeugt CadQuery. organisch nicht verfügbar.",
             teil=TEIL, beschreibung=STR, art=choice("technisch", "organisch")),
    function("baue", "Einzelne einfache Anbauteile hinzufügen (höchstens 6 pro Auftrag). bezug=null: ganzes Modell. "
             "Position ab Bezugsmitte und Größe als Anteile der Bezugsmaße pro Achse (0.5 an der Kante). "
             "Euler-XYZ in Grad nach Skalierung. Zylinder/Kegel: +Y. profil: XY-Polygon mit Dicke in Z. "
             "quelle nur für kopie. Eindeutige Namen aus ASCII-Buchstaben, Zahlen und _. "
             "Mehrere Positionen hängen _1, _2 usw. an.",
             bezug=nullable(STR), teile=array(VORLAGE, 1, 6)),
    function("lackiere", "Neuer Lack mit Muster oder Sticker (ersetzt die vorhandene Textur). Motiv für art=grafik: "
             "gefüllte Polygone in Motivkoordinaten 0–1. rgb/metall/rauheit=null übernimmt vorhandene Werte. "
             "Für Logos/Aufkleber auf vorhandenen Flächen klebe_logo verwenden. Stickerposition UV [0,1], v nach oben, breite relativ "
             "zur Seite. text=null nutzt Bildanhang.",
             teil=TEIL, rgb=nullable(RGB), metall=nullable(NUM), rauheit=nullable(NUM),
             muster=nullable(object_schema(art=choice("streifen", "karo", "punkte", "grafik"),
                                           anzahl={"type": "integer"}, rgb=RGB,
                                           motiv=nullable(array(array(UV, 3, 24), 1, 8)))),
             sticker=nullable(object_schema(seite=choice("vorne", "hinten", "oben", "unten", "links", "rechts"),
                                            position=UV, breite=NUM, text=nullable(STR), rgb=RGB))),
    function("klebe_logo", "Logo, Aufkleber oder Schriftzug als EIGENES Teil (logo_<name>) auf die Oberfläche eines Teils "
             "legen. Das Logo ist danach einzeln wählbar, größer/kleiner, löschbar (skaliere, loesche mit teil=logo_*); "
             "die Textur des Teils bleibt unberührt. nur_symbol=true: nur das Bildzeichen ohne Schriftzug "
             "(z. B. „nur das Logo, ohne Text“). quelle web: Logo der Marke aus dem "
             "Netz holen (marke, z. B. „Red Bull“, und wenn bekannt domain, z. B. redbull.com); anhang: angehängtes "
             "Bild; text: Schriftzug text in rgb. Ort: pin = Nr eines Pins (bevorzugt, klebt genau an die "
             "Pin-Stelle), sonst bild_position [x, y] in der Textur (0–1, oben links 0,0), sonst seite + position "
             "(UV 0–1 auf der Hüllenseite, v nach oben). seite meint Modellachsen, nicht die Fahrzeugsicht: vorne +X, "
             "hinten −X, oben +Y, unten −Y, links +Z, rechts −Z. Die Längsseiten eines Fahrzeugs liegen quer zur "
             "längsten waagerechten Achse (Ausmaß in der Teiletabelle): ist Z am längsten, sind es vorne/hinten. breite_m = echte Logobreite in Metern (passend zur Fläche, "
             "z. B. 0.3–0.8 bei einem Lieferwagen). drehung in Grad (0 = aufrecht).",
             teil=TEIL, quelle=choice("web", "anhang", "text"), marke=nullable(STR), domain=nullable(STR),
             text=nullable(STR), rgb=nullable(RGB), pin=nullable({"type": "integer"}), nur_symbol={"type": "boolean"},
             bild_position=nullable(UV), seite=nullable(choice("vorne", "hinten", "oben", "unten", "links", "rechts")),
             position=nullable(UV), breite_m=NUM, drehung=NUM),
    function("frage_nach", "Eine kurze Rückfrage mit Antwortvorgaben, nur wenn eine falsche Annahme teuer wäre. "
             "typ: auswahl (optionen als Chips), text, teil (Nutzer klickt Teile im Modell an), modell (Nutzer wählt "
             "ein anderes Modell auf dem Canvas), farbe, zahl (mit einheit), ja_nein. standard = id der "
             "vorausgewählten Option.",
             frage=STR, typ=choice("auswahl", "text", "teil", "modell", "farbe", "zahl", "ja_nein"),
             optionen=array(OPTION, 0, 6), standard=nullable(STR), einheit=nullable(STR),
             mehrfach={"type": "boolean"}),
]

SYSTEM_PROMPT = """Bearbeite das vorhandene 3D-Modell per Werkzeug. Einheit Meter, Y oben.
Teiletabelle: Nr, Name, Mitte xyz, Ausmaß xyz, RGB hex, bei Texturen die Hauptfarben der Textur mit Anteil.
Bilder: Ansichten des Modells und eine Ansicht, in der jedes Teil eigenfarbig mit seiner Nr beschriftet ist.
Ordne Begriffe wie Fenster, Logo, Dach, Räder über diese Bilder den Teilen bzw. Texturfarben zu.
Sind Teilnamen bedeutungslos, rufe zuerst benenne für alle Teile auf und verwende danach die neuen Namen.
Gruppenmuster wie glas_* oder raeder_* sind erlaubt.
Farbe: „mach die Karosserie weiß/blau/…“ → faerbe modus auto auf das gewählte Teil (auch weiß; der Lack wird
umgefärbt, Textur-Details und dunkle Teile bleiben). Sollen dabei Logos/Aufdrucke weg: logos_entfernen=true
(„alle Logos löschen“, „einfarbig“); sonst false. Mehrere ausgewählte Teile stehen kommagetrennt in der Auswahl und
gehen unverändert als teil in das Werkzeug. Nur ein Bereich der Textur (Scheiben in der Textur, ein bestimmtes Logo
am Pin) → faerbe_bereich mit den Texturfarben dieses Bereichs als quellfarben; Logo in der Textur entfernen →
ziel_rgb=null. Nie flach „ersetzen“, außer der Nutzer will ausdrücklich ohne Textur.
Logos, Aufkleber, Schriftzüge → klebe_logo (nie lackiere-Sticker, nie den Markennamen als Ersatz-Text, wenn
ein echtes Logo gemeint ist): quelle web mit marke (und domain, wenn bekannt), am Pin kleben. Das Logo wird ein
eigenes Teil logo_<name> (einzeln wählbar, skalierbar, löschbar). „Nur das Logo ohne Text/Schriftzug“ → nur_symbol=true.
Logo größer/kleiner → skaliere auf teil=logo_<name> (alle Achsen gleich), Logo entfernen → loesche auf logo_<name>.
Logo ersetzen („statt des alten Logos“): ist das alte Logo ein Teil logo_*, loesche es und klebe das neue an dieselbe
Stelle; steckt es in der Textur, zuerst faerbe_bereich mit ziel_rgb=null, dann klebe_logo.
Größen sind echte Meter. „10 cm lang“ → setze_groesse. An andere Modelle angleichen → gleiche_an mit dem Namen aus
der Modelltabelle. Pins zeigen Orte am Modell (Teil, Bildposition und Farbe der Textur); nutze sie als Ziel.
Nutze die Auswahl als Standard. Erhalte übrige Geometrie.
Handle, wenn eine vernünftige Annahme möglich ist. Frage nur mit frage_nach (genau eine, ohne weitere Werkzeuge), wenn
eine falsche Annahme zerstörerisch oder teuer wäre: Löschen ganzer Baugruppen, großer Umbau, mehrdeutige Ziele
(z. B. „alles weiß“: auch Räder und Glas?). Kurze Frage mit 2–4 Optionen, Teilmuster in optionen.teile.
Stilwechsel oder ein anderes Fahrzeug („mach einen Oldtimer daraus“) gehen mit diesen Werkzeugen nicht: nicht mit
vielen Vorlagen nachbauen, sondern frage_nach mit konkreten kleinen Änderungen als Optionen oder kurz erklären.
Eine Antwort aus „Bisherige Klärung“ ist bindend; frage nicht erneut dasselbe.
Frage und Texte immer in der Sprache des Nutzers. Gib Werkzeugaufrufe in Ausführungsreihenfolge aus."""


class ToolError(Exception):
    pass


def match(scene, pattern: str) -> list[str]:
    """Teilnamen zu einem Muster; mehrere Muster mit Komma (Mehrfachauswahl im Canvas)."""
    pats = [p.strip().lower() for p in str(pattern).split(",") if p.strip()] or [str(pattern).lower()]
    names = [n for n in scene.geometry if any(fnmatch.fnmatch(n.lower(), p) for p in pats)]
    if not names:
        raise ToolError(f"Kein Teil passt zu '{pattern}'. Vorhanden: {', '.join(scene.geometry)}")
    return names


def _scale_about(mesh, s, anchor_point):
    T = trimesh.transformations.translation_matrix(anchor_point)
    Ti = trimesh.transformations.translation_matrix(-anchor_point)
    S = np.diag([s[0], s[1], s[2], 1.0])
    mesh.apply_transform(T @ S @ Ti)


def faerbe(scene, teil, rgb, modus="auto", logos_entfernen=False):
    from . import surfaces

    names = match(scene, teil)
    for n in names:
        mesh = scene.geometry[n]
        textured = model_io.texture_of(mesh) is not None
        if modus == "toenen":
            model_io.tint(mesh, rgb)
        elif modus == "auto" and textured and not n.lower().startswith("logo_"):
            scene.geometry[n], _ = surfaces.repaint_texture(mesh, rgb, bool(logos_entfernen))
        else:
            model_io.set_color(mesh, rgb)
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


EINHEIT_M = {"mm": 0.001, "cm": 0.01, "m": 1.0}


def group_bounds(scene, names):
    lo = np.min([scene.geometry[n].bounds[0] for n in names], axis=0)
    hi = np.max([scene.geometry[n].bounds[1] for n in names], axis=0)
    return lo, hi


def axis_index(extents, achse):
    """laenge = längste waagerechte Achse (x oder z), breite = die andere, hoehe = y, alle = größte."""
    if achse == "hoehe":
        return 1
    if achse == "alle":
        return int(np.argmax(extents))
    long = 0 if extents[0] >= extents[2] else 2
    return long if achse == "laenge" else 2 - long


def masse(extents) -> dict:
    """Länge/Breite/Höhe in Metern aus einem Ausmaß xyz."""
    e = np.asarray(extents, dtype=float)
    return {"laenge": float(e[axis_index(e, "laenge")]), "breite": float(e[axis_index(e, "breite")]),
            "hoehe": float(e[1])}


def _resize(scene, names, achse, ziel_m, proportional, anker):
    if not np.isfinite(ziel_m) or not 1e-4 <= ziel_m <= 1e4:
        raise ToolError("Zielgröße muss zwischen 0,1 mm und 10 km liegen.")
    lo, hi = group_bounds(scene, names)
    ext = hi - lo
    i = axis_index(ext, achse)
    if ext[i] <= 1e-12:
        raise ToolError("Das Ziel hat auf dieser Achse keine Ausdehnung.")
    f = ziel_m / ext[i]
    factors = [f, f, f] if proportional else [f if k == i else 1.0 for k in range(3)]
    p = (lo + hi) / 2
    if anker == "boden":
        p[1] = lo[1]
    for n in names:
        _scale_about(scene.geometry[n], factors, p)
    return names


def setze_groesse(scene, teil, achse, wert, einheit, proportional=True, anker="boden"):
    if einheit not in EINHEIT_M:
        raise ToolError(f"Unbekannte Einheit: {einheit}")
    return _resize(scene, match(scene, teil), achse, float(wert) * EINHEIT_M[einheit], proportional, anker)


def gleiche_an(scene, teil, referenz, achse, proportional=True, anker="boden", modelle=()):
    """referenz: Name eines anderen Modells (Tabelle aus dem Frontend, Maße in m) oder Teilmuster dieses Modells."""
    names = match(scene, teil)
    ref = next((m for m in modelle if str(m.get("name", "")).strip().lower() == str(referenz).strip().lower()), None)
    if ref is not None:
        dims = {k: float(ref[k]) for k in ("laenge", "breite", "hoehe")}
    else:
        lo, hi = group_bounds(scene, match(scene, referenz))
        dims = masse(hi - lo)
    ziel = max(dims.values()) if achse == "alle" else dims[achse]
    return _resize(scene, names, achse, ziel, proportional, anker)


GRUPPEN = ("karosserie", "glas", "raeder", "innenraum", "chrom", "licht", "anbau", "sonstiges")


def benenne(scene, teile):
    """Benennt Teile um (Gruppe_Name). Reihenfolge der übrigen Teile bleibt; umbenannte wandern ans Ende."""
    plan, used = [], {n.lower() for n in scene.geometry}
    for t in teile:
        alt = t["teil"]
        if alt not in scene.geometry:
            raise ToolError(f"Teil '{alt}' gibt es nicht.")
        gruppe = t["gruppe"] if t["gruppe"] in GRUPPEN else "sonstiges"
        base = model_io._safe(f"{gruppe}_{model_io.ascii_name(t['name'])}").lower()
        if base.startswith(f"{gruppe}_{gruppe}_"):
            base = base[len(gruppe) + 1:]
        neu, k = base, 2
        used.discard(alt.lower())
        while neu in used:
            neu = f"{base}_{k}"; k += 1
        used.add(neu)
        plan.append((alt, neu))
    for alt, neu in plan:
        if alt == neu:
            continue
        mesh = scene.geometry[alt]
        scene.delete_geometry(alt)
        scene.add_geometry(mesh, node_name=neu, geom_name=neu)
    return [neu for _, neu in plan]


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


SIMPLE_TOOLS = {"faerbe": faerbe, "skaliere": skaliere, "verschiebe": verschiebe, "drehe": drehe, "loesche": loesche,
                "setze_groesse": setze_groesse, "benenne": benenne}
