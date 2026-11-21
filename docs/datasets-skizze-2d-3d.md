# Datensätze für Skizze → 2D-Karten → 3D (mehrere Kategorien)

Stand 2026-11-21. Zweck: Trainingsdaten für Modell A (Skizze → Normalen/Tiefe/Teile/Kanten) und Modell B (2D-Karten → 3D mit Teilen).
Alle Links wurden geöffnet (HTTP 200). Angaben zu Größe/Lizenz stammen, wo nicht anders vermerkt, aus Suchergebnis-Zusammenfassungen, **nicht** aus gelesenen Lizenztexten – vor der Nutzung gegenprüfen. Projektregel: Lizenz pro Quelle klären; Forschung ≠ Produkt.

## Kernaussage

Es gibt **keinen** Datensatz mit echter Handskizze + 2D-Karten + 3D-Modell + Teil-Labels über viele Kategorien. Ein realistischer Weg: **3D-Quellen** (viele Kategorien, Teile) + **eigener Generator** (`lab/sketchgen/`, erzeugt Skizze, Normalen, Tiefe, Teil-IDs exakt) für den Masse-Teil, und **kleine echte Skizzen-Sätze** nur für Feinabstimmung und Test.

## A. Echte Skizzen mit 3D-Bezug (klein, für Domänenlücke und Test)

| Datensatz | Inhalt | Kategorien | Link |
|---|---|---|---|
| OpenSketch | >400 Designer-Skizzen, auf das 3D-Modell registriert, Strichtypen, **„Sketch to Normals“-Downloads** (Menü der Seite gelesen); laut Suche CC0 | 12 Produkte | <https://repo-sam.inria.fr/d3/OpenSketch/index.html> |
| ShapeNet-Sketch (Sketch2Model) | 1.300 Handskizzen von Laien + zugehörige 3D-Modelle (Projektseite gelesen, Download per Google Drive) | 13 ShapeNet-Kategorien (laut Deep3DSketch+) | <https://bennyguo.github.io/sketch2model> · Paper <https://arxiv.org/abs/2105.06663> |
| DifferSketching | 3.620 Skizzen, 136 Modelle, Striche mit Druck/Zeit; Lizenz nur nicht-kommerziell (siehe `HANDOVER.md`, 4c) | 9 | <https://arxiv.org/abs/2209.08791> |
| SketchModelling (Lun et al.) | Handskizzen, Teilmenge von ShapeNetCore; Training mit Tiefe/Normalen | 3 (Stuhl, Flugzeug, Figur) | <https://arxiv.org/abs/1707.06375> |
| Fine-Grained VR Sketching | 1.497 VR-Skizzen ↔ Stuhl | 1 | <https://arxiv.org/abs/2209.10008> |

Nicht gefunden/nicht verifiziert: „KO2D“ (taucht in einer Suchzusammenfassung auf, in einer zweiten Suche nicht belegbar) → nicht verwenden.

## B. Synthetische Skizzen aus 3D (Masse)

- Sketch2Mesh: Skizzen aus ShapeNet-Modellen (Kanten auf Normalen-/Tiefenbild), zusätzlich Hand-Skizzen Auto/Stuhl. <https://arxiv.org/abs/2104.00482>
- SketchSampler „Synthetic-LineDrawing“: ShapeNet-Core-Teilmenge, ~50k Modelle, 13 Klassen (laut Suche). Paper-Suche: <https://arxiv.org/abs/2208.06880>
- MarrNet: 2.5D-Skizze (Tiefe/Normalen/Silhouette) als Zwischenschritt – derselbe Gedanke wie unsere Zwei-Schritt-Kette. <https://arxiv.org/abs/1711.03129>
- SHREC'22 „Sketch-Based 3D Shape Retrieval in the Wild“: CAD-Modelle (ModelNet40/ShapeNet/ScanObjectNN) + QuickDraw-Skizzen, 44–47 Klassen (Quellen widersprechen sich). **Skizzen sind abstrakt und nicht je Objekt gepaart** → eher für Kategorie-Erkennung. Seite <https://sites.google.com/site/firmamentqj/sbsrw>, Paper <https://arxiv.org/abs/2207.04945>

## C. 3D-Quellen mit vielen Kategorien / Teilen / 2D-Karten

| Datensatz | Nutzen für uns | Lizenz laut Suche | Link |
|---|---|---|---|
| PartNet | 26.671 Modelle, 573.585 Teile, 24 Kategorien, hierarchische Teil-Labels (auf ShapeNet-Modellen) | nicht-kommerziell, Zugang per Antrag | <https://partnet.cs.stanford.edu> · <https://huggingface.co/datasets/ShapeNet/PartNet-archive> |
| GObjaverse | 280k Objaverse-Objekte, je Ansicht RGB, Albedo, **Normalen+Tiefe (EXR)**, Kamera → fertige 2.5D-Karten | Datensatz „mit“ MIT (README), Objekte nach Objaverse | <https://aigc3d.github.io/gobjaverse> · <https://huggingface.co/datasets/3DAIGC/gobjaverse> |
| Objaverse 1.0 | >800k Objekte, sehr diverse Kategorien; Lizenz je Objekt (CC-BY, wenige CC0) | ODC-By + Objekt-Lizenzen | <https://huggingface.co/datasets/allenai/objaverse> |
| PartObjaverse-Tiny | 200 Objaverse-Objekte, Teile (semantisch + Instanz), 8 Gruppen | – | <https://huggingface.co/datasets/yhyang-myron/PartObjaverse-Tiny> |
| ABC | ~1 Mio. CAD-Modelle (Onshape), scharfe Kanten/Flächen, Normalen-Benchmark | Datensatz MIT, Modelle gehören den Urhebern | <https://deep-geometry.github.io/abc-dataset> |
| Toys4k | 4.179 Objekte, 105 Kategorien, CC/frei, Zugang per Formular | CC/royalty-free | <https://arxiv.org/abs/2101.07296> · <https://github.com/rehg-lab/lowshot-shapebias> |

## D. Verknüpfbarkeit (was passt zusammen)

1. **ShapeNet-Kette:** ShapeNet-Modelle ↔ PartNet (Teile) ↔ ShapeNet-Sketch (Handskizzen) ↔ Synthetic-LineDrawing/Sketch2Mesh. Gleiche Modell-IDs → Handskizze + Teil-Labels + 3D für dieselben Objekte, aber nur wenige Klassen und nicht-kommerziell.
2. **Objaverse-Kette:** Objaverse-UID ↔ GObjaverse (Normalen/Tiefe, Kamera) ↔ PartObjaverse-Tiny (200 mit Teilen). Skizzen dazu **selbst** mit `sketchgen/objaverse_stream.py` (läuft bereits). Viele Kategorien, Lizenz je Objekt prüfen.
3. **CAD-Kette:** ABC/DeepCAD-artige Modelle → eigener Generator (Konstruktionslinien) → exakte Kanten/Flächen; Stilreferenz OpenSketch/CAD2Sketch.
4. **Test mit echten Skizzen:** OpenSketch, DifferSketching, ShapeNet-Sketch – nie ins Training für ein Produkt, nur Feinabstimmung/Test.

## Empfehlung

- Modell A (Skizze → Karten): Training auf **eigenen** Skizzen aus Objaverse/ShapeNet/ABC-Meshes mit Karten aus GObjaverse oder dem Generator; Feinabstimmung/Test auf OpenSketch (hat „Sketch to Normals“), DifferSketching, ShapeNet-Sketch.
- Modell B (Karten → 3D mit Teilen): Teil-Labels aus PartNet (24 Kategorien, nicht-kommerziell) und procad-Programmen (eigene, lizenzfrei); später PartObjaverse-Tiny zum Test.
- Offene Prüfungen vor dem Einbau: Lizenztexte (ShapeNet/PartNet-Zugang, ABC-Nutzungsbedingungen, Objaverse pro Objekt), Kategorie-Überschneidung der Sätze, Kamera-Konventionen (GObjaverse-Normalenkoordinaten sind laut Suche nicht voll dokumentiert).

## E. Große Bild→3D-Datensätze mit Fokus Tiere / Pflanzen / Fabelwesen (Nachtrag 2026-11-21)

Alle Links geöffnet (HTTP 200); Zahlen aus Suchzusammenfassungen. Wichtig: **keiner liefert Skizzen**, nur Bilder/Video + 3D. Skizzen müssten wir wie bisher aus den 3D-Daten erzeugen.

| Datensatz | Umfang | Fokus | Hinweis | Link |
|---|---|---|---|---|
| Objaverse 1.0 | 798.759 Objekte (lokal gezählt), Details in `docs/objaverse-kategorien.md` | Fabelwesen (z. B. creature/monster/dragon ~2.500–3.200 Objekte mit dem Stichwort), Tiere (~32k Stichwort-Treffer), Pflanzen (~21k) | nur 3D; Lizenz pro Objekt | <https://arxiv.org/abs/2212.08051> |
| Objaverse-XL | >10 Mio. Objekte | breit | Lizenz pro Objekt, Zugang per Formular | <https://huggingface.co/datasets/allenai/objaverse-xl> |
| TexVerse | 858.669 hochaufgelöste, texturierte GLB-Modelle (CC, ohne „NoAI“) | breit, Texturen | gut für Teil-Färbung/Texturen | <https://arxiv.org/abs/2508.10868> |
| MVImgNet / MVImgNet2.0 | 6,5 Mio. Frames, 238 Klassen (v1); ~520k Objekte, 515 Kategorien (v2) | Alltagsobjekte (Video, echte Fotos) | Mehrfachansichten statt Skizzen | <https://arxiv.org/abs/2303.06042> · <https://arxiv.org/abs/2412.01430> |
| CO3D | ~19k Videos, 50 COCO-Kategorien (inkl. Tiere) | Alltagsobjekte | | <https://arxiv.org/abs/2109.00512> · <https://ai.meta.com/datasets/CO3D-dataset/> |
| OmniObject3D | 6.000 gescannte Objekte, 190 Kategorien (Abstract gelesen) | Alltag inkl. Obst/Pflanzen | realer Scan, hohe Qualität | <https://arxiv.org/abs/2301.07525> |
| 3D-Fauna (Fauna Dataset) | >100 Vierbeiner-Arten aus Internetbildern | Tiere | nur 2D-Bilder, 3D wird gelernt | <https://arxiv.org/abs/2401.02400> |
| Animal3D | 3.379 Bilder, 40 Säugetierarten, SMAL-Form | Tiere | klein, Pose/Form | <https://arxiv.org/abs/2308.11737> |
| TreeNet3D | 13.000 Modelle, 10 Baumarten | Pflanzen (Bäume) | Mesh + Punktwolke | <https://github.com/ao216/TreeNet3D> |
| Tree-D Fusion | 600.000 simulationsfähige Baummodelle | Pflanzen (Bäume) | aus Street-View + Diffusion erzeugt | <https://arxiv.org/abs/2407.10330> |
| Synthetic-Mythical-Creatures | klein; Seite geöffnet, Inhalt nicht gelesen | Fabelwesen | Lizenz ungeprüft | <https://huggingface.co/datasets/ThomasTheMaker/Synthetic-Mythical-Creatures> |

**Fazit:** Für Fabelwesen, Tiere und Pflanzen in großem Maßstab ist Objaverse (und TexVerse) die einzige realistische Quelle; es gibt keinen speziellen Fabelwesen-Datensatz in dieser Größe. Spezialsätze (3D-Fauna, TreeNet3D, Animal3D) sind klein oder nur für eine Gruppe. Vorsicht: Objaverse enthält viele Scans/Massenuploads – vorher filtern (siehe Warnung in `docs/objaverse-kategorien.md`).
