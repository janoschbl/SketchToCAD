# Datenplan: Synthetische Skizzen aus 3D-Modellen

Stand: 2026-11-20. Zahlen mit „(Schätzung)“ sind eigene Planungswerte, keine Messungen. Mit „unverifiziert“ markierte Angaben haben wir nicht an der Primärquelle bestätigt.

## 1. Kernidee

Wir brauchen **keine gepaarten Daten und keine Labels**. Das Modell lernt nur *Skizze → 3D-Modell*, unabhängig davon, was das Objekt ist. Deshalb reicht uns eine große Menge lizenzsauberer 3D-Modelle. Die Skizzen rendern wir selbst daraus, und jede Skizze passt dadurch exakt zum Modell.

Pro Objekt entstehen viele Trainingsbeispiele: mehrere Perspektiven × mehrere Zeichenstile × mehrere Qualitätsstufen („mal schlecht, mal gut gezeichnet“).

Hinweis zu Kategorien: Wir trainieren ohne Label. Die Kategorie nutzen wir **nur zum Sampling**, damit Tiere, Fahrzeuge, Möbel, Pflanzen und Requisiten gleichmäßig im Datensatz vorkommen und nicht 40 % Stühle darin sind. Objekte ohne Label sind kein Problem.

Grenze: Der Datensatz ist synthetisch. Ob das Modell auf echte Handskizzen übertragbar ist, zeigt erst der Test an echten Skizzen (Abschnitt 6).

## 2. Pipeline im Überblick

```
Objaverse (Metadaten) ─▶ 1 Lizenzfilter ─▶ 2 Qualitätsfilter ─▶ 3 Normalisieren
      ─▶ 4 Ansichten ─▶ 5 Linienrender ─▶ 6 Handzeichen-Simulation ─▶ 7 Paket
                                         3D-Modell ─▶ Mesh/Tokens + USDC-Export
```

### Schritt 1: Lizenzfilter
- Quelle: [Objaverse 1.0](https://huggingface.co/datasets/allenai/objaverse). Laut Dataset-Card steht pro Objekt eine Lizenz: ca. 721k CC-BY 4.0, ca. 16k CC-BY-SA 4.0, ca. 3,5k CC0, ca. 25k CC-BY-NC, ca. 52k CC-BY-NC-SA. Wir haben das aus der Karte übernommen und nicht selbst nachgezählt.
- **Behalten:** CC0, CC-BY, CC-BY-SA. **Raus:** alle NC-Varianten.
- Pro Objekt speichern wir Objekt-ID, Lizenz, Urheber und Quell-URL in einer Provenienz-Tabelle. CC-BY verlangt Namensnennung, CC-BY-SA hat eine Share-Alike-Pflicht (rechtlich klären, bevor Modelle verkauft werden).

### Schritt 2: Qualitätsfilter
Ansatz wie bei [Objaverse++](https://arxiv.org/abs/2504.07334) (manuelle Qualitätsannotation, Filter gegen Szenen, monochrome und transparente Assets). Unsere Stufen:
1. Import und Render erfolgreich?
2. Leere oder entartete Bounding Box, extreme Polygonzahl (zu wenig/zu viel)?
3. Szenen mit mehreren Objekten oder Boden/Umgebung aussortieren.
4. Fast leere oder winzige Silhouette aussortieren.
5. Duplikate: Geometrie-Hash plus Embedding (z. B. CLIP) der gerenderten Silhouette.
6. Grenzfälle stichprobenhaft ansehen.

Wichtig für das Ziel: Es zählen **Form und Geometrie**. Texturen und Materialien ignorieren wir.

### Schritt 3: Normalisieren
- Mesh in den Einheitswürfel skalieren, zentrieren, einheitliche Up-Achse, Lage festlegen.
- Mesh reparieren, Teile-Hierarchie als Metadatum behalten (für spätere Teile-Editierung).
- Normalisierungs-Transform speichern, damit wir auf das Original zurückrechnen können.

### Schritt 4: Perspektiven
- Pro Objekt 8–30 Ansichten (Schätzung): kanonische Ansichten (vorn, Seite, oben), Dreiviertelansichten und zufällige Ansichten (Azimut/Elevation).
- Mix aus orthografischer und perspektivischer Kamera, damit auch grobe Schrägansichten vorkommen.
- Mehr Ansichten bedeuten nicht automatisch mehr Information. Die Zahl der **eindeutigen Formen** zählt.
- Das Modell soll später auch aus mehreren Skizzen derselben Form lernen. Deshalb speichern wir Ansichten, die zum selben Objekt gehören, zusammen.

### Schritt 5: Saubere Linien rendern
Ausgangsbild ist eine geometrisch korrekte Strichzeichnung:
- **Blender Freestyle** bzw. **Line Art**: Silhouette, scharfe Kanten, Falten (Creases), Verdeckung. Linien hinter Flächen werden entfernt. Quellen: [Freestyle](https://docs.blender.org/manual/en/5.1/render/freestyle/view_layer/line_style/index.html), [Line Art](https://docs.blender.org/manual/en/4.3/grease_pencil/modifiers/generate/line_art.html).
- Ergänzend: Kantenkarten aus Normalen-/Tiefenbildern (Verfahren wie HED, PiDiNet, DexiNed; für uns **unverifiziert**, vor Nutzung prüfen).
- Nicht aus den Eckpunkten zeichnen. Punkte ergeben keine Skizze. Wir brauchen Kanten- und Konturlinien.

### Schritt 6: Handzeichnung simulieren („mal schlecht, mal gut“)
Auf die saubere Linienzeichnung legen wir Effekte in **Qualitätsstufen**. Jede Skizze bekommt zufällige Parameter, die wir mitspeichern.

| Stufe | Aussehen | Wie wir es erzeugen (Schätzung der Parameter) |
|---|---|---|
| 1 – sehr grob | wenige Striche, stark vereinfacht, schief, Lücken | CLIPasso mit wenigen Strichen (z. B. 8–16) oder starkes Linien-Ausdünnen; starker Jitter |
| 2 – schnelle Skizze | Hauptkonturen, wacklig, doppelte Linien, überlappende Enden | mittlerer Jitter, Mehrfachstriche, Über-/Untershoot an den Ecken |
| 3 – normale Skizze | Kontur plus wichtigste Kanten, leichte Unsauberkeit | leichter Jitter, variable Strichdicke, einzelne Lücken |
| 4 – saubere Zeichnung | fast Linienzeichnung, einzelne Fehler | wenig Jitter, konstante Linien, wenig Lücken |
| 5 – Konstruktionsskizze | Kanten, Hilfslinien, Schraffur | zusätzliche Hilfs- und Schattierungslinien |

Dazu zufällig:
- **Strichform:** Linien in Bézier-Kurven oder Polylinien umwandeln, Punkte verwackeln, Stiftdruck (Strichdicke und Deckkraft) simulieren.
- **Fehler:** Linien weglassen, Striche verlängern oder kürzen, falsche Verbindungen, doppelte Konturen.
- **Perspektivfehler:** leichte Verzerrungen und Winkelfehler wie bei freihändig gezeichneten Quadern.
- **Papier und Aufnahme:** Papiertextur, Hintergrundrauschen, Kontrast, Rotation und Beschnitt. Zusätzlich ein Pixel-Stil (Bleistift/Fineliner) und ein Vektorstil (Strichfolgen wie auf einem Tablet).
- **Stile mischen:** Freestyle-Linien, Kantenkarten und CLIPasso getrennt rendern und im Training mischen. Ein Generator-Stil allein führt zu Überanpassung an dessen Eigenheiten. Quelle für CLIPasso: [Paper](https://arxiv.org/abs/2202.05822).
- Diffusions-Stilisierung (z. B. ControlNet-Scribble) nur als eigener Stil-Mix, weil sie Details erfinden kann und Skizze und Modell dann nicht mehr exakt zusammenpassen.

Wir speichern pro Skizze: Objekt-ID, Kamera, Stil, Qualitätsstufe und Zufalls-Seed. So können wir später gezielt Stufen gewichten und Fehler zurückverfolgen.

### Schritt 7: Format und Paketierung
- **Fürs Training:** kanonisches Mesh (PLY/OBJ plus JSON) und später Mesh-Tokens oder 3D-Latents. Beispiele: [MeshGPT](https://arxiv.org/abs/2311.15475), [BPT](https://arxiv.org/abs/2411.07025). Ein kleiner Transformer muss keine USDC-Bytes lesen.
- **Export:** zusätzlich **USDC** pro Objekt (Blender-USD-Export, [Doku](https://docs.blender.org/manual/en/5.0/files/import_export/usd.html); Metadaten `upAxis` und `metersPerUnit` setzen, siehe [OpenUSD](https://openusd.org/release/user_guides/schemas/usdGeom/overview.html)). Das ist für Austausch, Archiv und spätere CAD-Weiterverarbeitung gedacht.
- Fallstricke: Einheiten, Y/Z-up, Materialübersetzung, fehlende Texturen, offene Meshes. Stichprobenweise Roundtrip-Import prüfen.
- **Train/Val/Test nach Objekt trennen** (nicht nach Ansicht), sonst leckt dasselbe Modell in den Test.

## 3. Mengen und Speicher (Schätzung)

| Stufe | Objekte | Skizzen pro Objekt | Skizzen gesamt | Zweck |
|---|---|---|---|---|
| Pilot | 2k | 8 Ansichten × 3 Stile | ca. 48k | Pipeline, Renderzeit messen, erstes Modell |
| Prototyp | 20k | 8–30 | 160k–600k | Training mit eingefrorenem 3D-Latentmodell |
| Breit | 100k+ | 10–50 | Millionen | eigenes Modell über offene Kategorien |

Speicher: Bei 256² und 1 Kanal sind 8 Ansichten ca. 0,5 MiB pro Objekt roh, also ca. 10 GiB für 20k und ca. 49 GiB für 100k Objekte. Bei RGB das Dreifache. Dazu kommen die Meshes. PNG komprimiert, die Werte sind Obergrenzen.

Renderzeit: **nicht gemessen.** Vor der Kapazitätsplanung 500 Objekte mit Freestyle, Line Art und eigener Raster-Linienpipeline testen und getrennt Importzeit und Renderzeit messen.

Parallelisierung: ein Blender-Prozess pro GPU-/CPU-Kern, deterministische Seeds, Jobs in Shards, jeder Job kann wiederholt werden. BlenderProc und Kubric sind Kandidaten (Kompatibilität nicht geprüft).

## 4. Datensatz-Links

### 4.1 3D-Quellen für die Skizzen-Generierung (Hauptquellen)

| Quelle | Menge | Lizenz | Hinweis |
|---|---|---|---|
| [Objaverse 1.0](https://huggingface.co/datasets/allenai/objaverse) | ca. 800k | pro Objekt (siehe oben) | Hauptquelle; Metadaten pro Objekt filtern |
| [Objaverse-XL](https://objaverse.allenai.org/objaverse-xl/) | 10M+ | assetabhängig | nur mit Lizenzmanifest pro Asset |
| [Poly Haven Models](https://polyhaven.com/models) | Hunderte | CC0 | Props, Möbel, Pflanzen |
| [Kenney Assets](https://kenney.nl/assets) | viele Pakete | CC0 | Low-Poly-Stil |
| [Smithsonian 3D (HF)](https://huggingface.co/datasets/codepawl/smithsonian-3d-glb) | wenige 100 CC0 | CC0 nur bei gekennzeichneten Einträgen | Tiere, Fossilien, Artefakte |
| [Thingi10K](https://ten-thousand-models.appspot.com/) | 10k STL | pro Objekt gemischt | Alltagsobjekte, nur mit freier Lizenz |
| [ShapeNet](https://shapenet.org/) | 51k+ | Zugriffsbedingungen, Rechte der Einzelmodelle | Forschung; kommerzielle Nutzung nicht bestätigt |
| [3D-FUTURE](https://3d-future.org/) | ca. 20k Möbel | Forschung | kommerzielle Rechte nicht bestätigt |
| [ABO](https://amazon-berkeley-objects.s3.amazonaws.com/index.html) | ca. 8k 3D-Modelle | CC BY-NC (laut Paper) | nur Forschung |
| [OmniObject3D](https://omniobject3d.github.io/) | ca. 6k Scans | Forschung | kommerzielle Rechte nicht bestätigt |
| [CAD-Steps (HF)](https://huggingface.co/datasets/amzyst1/cad-steps) | unverifiziert | unverifiziert | enthält laut Beschreibung Skizzen plus CAD-Geometrie |
| [Zero-To-CAD-1m (HF)](https://huggingface.co/datasets/inrange/Zero-To-CAD-1m) | unverifiziert | unverifiziert | synthetische CAD-Programme |

Für ein kommerzielles Modell nutzen wir zunächst nur CC0 und CC-BY(-SA)-Objekte. Alles mit Forschungs- oder NC-Lizenz kommt in eine getrennte Gruppe (nur Evaluation).

### 4.2 Echte Handskizzen ↔ 3D (nur Validierung und Feintuning)

| # | Dataset | Umfang | Format / Lizenz |
|---|---|---|---|
| 1 | [Sketch2Vox](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/9384_ECCV_2024_paper.php) | 12.877 Handskizzen, 9 ShapeNet-Klassen | Voxel 32³; Lizenz unverifiziert |
| 2 | [Sketch2Model / ShapeNet-Sketch](https://github.com/bennyguo/sketch2model) | 1.300 Handskizzen (Test) plus Synthetik, 13 Klassen | ShapeNet-Mesh |
| 3 | [SketchEPM / THU-CAD](https://di-huang.github.io/THU-CAD-Freehand-Sketch-Dataset/index.html) | 33.300 Hand- plus 35.873 synthetische Skizzen / 9.759 CAD | B-Rep; Lizenz unverifiziert |
| 4 | [SHREC'14 SBR](https://sites.usm.edu/bli/sharp/sharp/contest/2014/SBR/data.html) | 12.680 Skizzen / 8.987 Modelle, 171 Klassen | nur Klassenebene gepaart |
| 5 | [SHREC'13 SBR](https://catalog.data.gov/dataset/shrec13-track-large-scale-sketch-based-3d-shape-retrieval) | 7.200 / 1.258 | NIST Open License |
| 6 | [SHREC'22 in the Wild](https://arxiv.org/abs/2207.04945) | 145.000 Skizzen / 47.700 Punktwolken | QuickDraw-basiert, Klassenebene |
| 7 | [DifferSketching](https://chufengxiao.github.io/DifferSketching/) | 3.620 Skizzen / 136 Objekte | nicht kommerziell |
| 8 | [KO3D+](https://openaccess.thecvf.com/content/CVPR2024/papers/Chen_Rapid_3D_Model_Generation_with_Intuitive_3D_Input_CVPR_2024_paper.pdf) | 4.200 VR-3D-Skizzen | Release unverifiziert |
| 9 | [VRChairSketch](https://cvssp.org/data/VRChairSketch/) | 1.497 Skizzen / 1.005 Stühle | OBJ; Lizenz nicht genannt |
| 10 | [OpenSketch](https://repo-sam.inria.fr/d3/OpenSketch/) | über 400 Skizzen / 12 Objekte | CC0, 906 MB |

Ausführliche Beschreibung, Vorschaubilder und Kategorien stehen in der [README](../README.md). Die echten Paare reichen insgesamt nicht zum Training, aber sie sind unser **Realitätstest**.

### 4.3 Skizze+Bild-Datasets (optional, nur Domänenvergleich)

| Dataset | Umfang | Paarung |
|---|---|---|
| [Sketchy](https://patsorn.me/projects/sketchy/) | 75k Skizzen / 12,5k Fotos / 125 Klassen | instanzgenau |
| [SketchyCOCO](https://github.com/sysu-imsl/SketchyCOCO) | ca. 20k Objekt-Tripel | Komposit |
| [QMUL Shoe/Chair/Handbag](https://openaccess.thecvf.com/content_ICCV_2017/html/Song_Deep_Spatial-Semantic_Attention_ICCV_2017_paper.html) | ca. 1,3k Paare | instanzgenau |
| [FS-COCO](https://fscoco.github.io/) | 10k Szenen | Szene, CC BY-NC |
| [Quick, Draw!](https://github.com/googlecreativelab/quickdraw-dataset) | 50 Mio. Skizzen | nur Klasse |
| [ImageNet-Sketch](https://github.com/HaohanWang/ImageNet-Sketch) | 50k | nur Klasse |

Diese Skizzen nutzen wir **nicht als 3D-Paare**, sondern als Vorlage für den Stil: Wir vergleichen echte Strichmerkmale (Dicke, Jitter, Lücken) mit unseren simulierten Skizzen und passen die Parameter an.

### 4.4 Werkzeuge
- [Blender](https://docs.blender.org/manual/en/latest/render/freestyle/index.html) (Freestyle/Line Art, USD-Export)
- [CLIPasso](https://clipasso.github.io/) (abstrakte Strichskizzen)
- [BlenderProc](https://github.com/DLR-RM/BlenderProc), [Kubric](https://github.com/google-research/kubric) (Batch-Rendering)
- [Cap3D](https://cap3d-um.github.io/) (Beschreibungen; für unser Ziel nicht nötig, nur optional)

## 5. Modelle und Datenbedarf

- Plan A (empfohlen): vortrainiertes 3D-Latentmodell einfrieren (z. B. [3DShape2VecSet](https://arxiv.org/abs/2301.11445)) und nur einen kleinen Skizzen-Encoder trainieren. 20k Objekte × viele Skizzen sind dafür plausibel (Planungsschätzung).
- Vergleichswerte: Sketch2Model und Sketch2Mesh nutzen synthetische Skizzen und gleichen die Lücke zu echten Zeichnungen per Domänenanpassung bzw. Konturoptimierung aus ([Sketch2Model](https://arxiv.org/abs/2105.06663), [Sketch2Mesh](https://openaccess.thecvf.com/content/ICCV2021/papers/Guillard_Sketch2Mesh_Reconstructing_and_Editing_3D_Shapes_From_Sketches_ICCV_2021_paper.pdf)).
- Ein Paper von Dezember 2025 nutzt ca. 20k synthetische Paare und feintunt auf 500 echten (aus unserer Websuche, nicht an der Quelle geprüft).
- Ein eigenes Modell über alle Objektarten von null braucht deutlich mehr Daten (100k+ Objekte). Eine belegte Mindestmenge gibt es nicht.

## 6. Pilot-Plan und Erfolgskriterien

1. 2k Objekte aus Objaverse filtern (Lizenz, Qualität, Duplikate), alle Kategorien gemischt.
2. Pipeline aus Schritt 3–7 bauen, 500 Objekte als Zeitmessung.
3. Erstes Modell (eingefrorener 3D-Decoder + Skizzen-Encoder) trainieren.
4. **Realitätstest** an den echten Handskizzen aus 4.2. Erfolg heißt: Ergebnisse auf echten Skizzen sind deutlich besser als Zufall und ähnlich wie auf simulierten.
5. Wenn die Lücke groß ist: Stile und Strichparameter anpassen, kleines Feintuning auf echten Skizzen.
6. Erst danach auf 20k skalieren.

## 7. Offen / nicht geprüft

- Objaverse-Lizenzzahlen selbst per Metadaten nachzählen.
- Renderzeiten (500-Objekt-Messung).
- Rechtliche Klärung CC-BY-Namensnennung und CC-BY-SA beim Training und Verkauf eines Modells.
- Lizenz von CAD-Steps und Zero-To-CAD-1m.
- HED/PiDiNet/DexiNed, BlenderProc, Kubric: nicht an Primärquellen geprüft.
- Wie weit simulierte Skizzen auf echte Handskizzen übertragen: nur empirisch zu klären.
- Plan B (Bild → 3D per TRELLIS, TripoSR, Hunyuan3D oder GPT-in-Blender) bleibt eine Ergänzung für Lücken: ca. 5–15 s pro Objekt für die Modelle (Schätzung), bei GPT-in-Blender Minuten und hohe Kosten pro Objekt (Schätzung).
