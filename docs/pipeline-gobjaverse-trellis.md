# Pipeline: Skizze → Bild → 3D (GObjaverse + vortrainiertes Skizzen-Bildmodell + TRELLIS)

Stand 2026-11-21. Übergabe-Dokument für einen Folge-Agenten. Projektregeln (`CLAUDE.md`): Doku auf Deutsch; Sub-Agents nur GPT-6-Luna über `delegate_task`; nur Links aufnehmen, die tatsächlich geöffnet wurden; Repo <https://github.com/janoschbl/SketchToCAD>. Kontext: `HANDOVER.md`, `docs/datasets-skizze-2d-3d.md`, `docs/objaverse-kategorien.md`.

Kennzeichnung: **[geprüft]** = Quelle geöffnet/gelesen oder lokal ausgeführt. **[Annahme]** = plausibel, nicht geprüft; vor dem Verlassen darauf zuerst prüfen.

---

## 0. Ziel und Entscheidungen

**Ziel:** Aus einer handgemachten, abstrakten Skizze (Tiere, Pflanzen, Fabelwesen, Alltagsobjekte) ein 3D-Modell erzeugen, ohne ein 3D-Generierungsmodell selbst von Grund auf zu trainieren.

**Entscheidungen (vom Nutzer getroffen):**
1. 3D-Erzeugung übernimmt **TRELLIS (Microsoft), ohne Training**. Es ist auf Objaverse-artigen Daten vortrainiert (TRELLIS-500K, laut README u. a. aus Objaverse(XL)). [geprüft: README]
2. Wir trainieren/feintunen **nur Skizze → RGB-Bild** („2D-Darstellung“), und zwar auf einem **vortrainierten Bildmodell mit Skizzen-Steuerung** (ControlNet-Typ), nicht von Null.
3. Trainingsdaten: **GObjaverse** (gerenderte Ansichten von Objaverse-Objekten). Die Skizzen dazu erzeugen wir **selbst aus den Karten** und sie passen damit pixelgenau zum Zielbild.

**Nicht-Ziele (vorerst):** Echtzeit (diese Modelle brauchen Sekunden), exakte CAD-Kanten (kommt über unser Schärfen/Segmentieren, Abschnitt 8), Training von TRELLIS.

**Warum das Zielbild RGB sein muss:** `TrellisImageTo3DPipeline` nimmt ein Bild. Normalen-/Tiefenkarten sind keine gültige Eingabe. [geprüft: `example.py`, `trellis_image_to_3d.py`]

---

## 1. Überblick

```
                      EINMAL (offline)                                             ZUR LAUFZEIT
 ┌────────────────┐   ┌────────────────────┐   ┌──────────────────────┐        ┌──────────────┐
 │ GObjaverse     │   │ Stufe 1            │   │ Stufe 2              │        │ Handskizze   │
 │ RGB + Normalen │──▶│ Skizzen aus Karten │──▶│ Paare (Skizze, RGB)  │        │ (Nutzer)     │
 │ + Tiefe + Kamera│   │ erzeugen + stilisie│   │ → ControlNet feintunen│       └──────┬───────┘
 │ (Teilmenge)    │   │ ren                │   │   (SDXL Scribble)    │               │
 └───────┬────────┘   └────────────────────┘   └──────────┬───────────┘               ▼
         │ Metadaten (Lizenz,Kategorie,Caption)            │ Gewichte           ┌──────────────┐
         ▼                                                 └───────────────────▶│ Skizze→Bild  │
 Objaverse-Metadaten (lokal) + Cap3D-Captions                                   │ (Stufe 2)    │
                                                                                └──────┬───────┘
                                                                                       ▼
                                                                          ┌────────────────────────┐
                                                                          │ Stufe 3: Hintergrund   │
                                                                          │ entfernen → TRELLIS    │
                                                                          │ (mehrere Seeds)        │
                                                                          └──────────┬─────────────┘
                                                                                     ▼
                                                                          ┌────────────────────────┐
                                                                          │ Stufe 4: Auswahl,      │
                                                                          │ GLB, Schärfen/Teile    │
                                                                          └────────────────────────┘
```

---

## 2. Was gebraucht wird (Ressourcen)

### 2.1 Hardware
| Aufgabe | Mindestbedarf | Vorhanden |
|---|---|---|
| Datenaufbereitung, Skizzen erzeugen | CPU, viel RAM/Platte | Laptop Ryzen 7 7730U (16 Threads), 917 GB frei; Heim-PC |
| ControlNet-Feintuning (SDXL) | laut kohya-ss-Doku ~24 GB GPU-Speicher für SDXL-Training [geprüft: Suchzusammenfassung, nicht Modell-Doku] | **Nein** (Heim-PC: RTX 2070, 8 GB, geteilt mit MeshPad) → gemietete Cloud-GPU nötig |
| ControlNet-Feintuning SD 1.5 (Ausweich) | deutlich weniger [Annahme: mit Gradient-Checkpointing/8-bit auch ~8–12 GB] | Heim-PC evtl. knapp |
| TRELLIS-Inferenz | ≥ 16 GB GPU, Linux, NVIDIA [geprüft: README] | **Nein** → Cloud-GPU oder anderer Rechner |

**Offen für den Folge-Agenten:** eine Maschine mit ≥ 24 GB GPU organisieren (Miet-GPU) und Kosten abstimmen. Das Dokument kann ohne Miet-GPU nur Stufe 0–1 ausführen.

### 2.2 Speicherplatz
GObjaverse ist komplett **6,5 TB** [geprüft: README]. Nie komplett laden. Es gibt eine komprimierte Variante (ein tar pro Objekt, ~260k Dateien) und Teil-Indexdateien pro Kategorie. Plan: Pilot 100 Objekte → 5.000 → 20.000. Platz pro Objekt **gemessen (Pilot, 3.4):** alle 7 Dateitypen × 40 Ansichten ≈ 33 MB; nur benötigte Dateien (`.png`, `_albedo.png`, `_nd.exr`, `.json`) ≈ 13,4 MB → 20.000 Objekte ≈ 270 GB. Der Server (OSS Hangzhou) lieferte nur **≈ 1–1,8 MB/s** gesamt (32 Threads) → 20.000 Objekte ≈ 2 Tage Download. [geprüft: lokal gemessen]
Vorhandene Platten: Laptop `/home` 917 GB frei; Seagate-HDD 1,5 TB frei; Heim-PC `/mnt/storage` ~45 GB frei (System-Platte voll, siehe Memory `sketchlab-own-model`).

### 2.3 Software
- Python-Umgebung für Daten: `lab/.venv` (hat trimesh, scipy, scikit-image, torch, manifold3d; **nicht** matplotlib vor 2026-11-21 → ist nachinstalliert). Zusätzlich: OpenEXR-Lesen (`OpenEXR`/`imageio` oder `cv2` mit `OPENCV_IO_ENABLE_OPENEXR=1`), `opencv-python`, `scikit-image`.
- Skizzen-Training: `diffusers`, `accelerate`, `transformers`, `bitsandbytes` (optional). Trainingsskript: `examples/controlnet/train_controlnet_sdxl.py` im diffusers-Repo [Existenz laut README_sdxl in Suchergebnissen, Skript nicht geöffnet].
- TRELLIS: Repo <https://github.com/microsoft/TRELLIS> (Installation mit `setup.sh`; flash-attn oder xformers; spconv).
- Hintergrundentfernung: `rembg` (nutzt TRELLIS intern, Modell `u2net`). [geprüft: Quelltext]

---

## 3. Stufe 0 – Daten auswählen

### 3.1 Dateien
- GObjaverse-Index: `gobjaverse_280k.json`; Zuordnung zu Objaverse-UIDs: `gobjaverse_280k_index_to_objaverse.json`; Kategorien: `category_annotation.json`, Teil-Indizes `gobjaverse_280k_{Kategorie}.json`; Captions: `text_captions_cap3d.json`. Download-URLs und Skripte stehen im README <https://huggingface.co/datasets/3DAIGC/gobjaverse/raw/main/README.md> [geprüft: gelesen].
- Objaverse-Metadaten lokal: `~/.objaverse/hf-objaverse-v1/metadata/*.json.gz` (798.759 Objekte; `lab/objaverse_stats.py` zählt sie aus). Lizenz je Objekt steht dort (`license`).

### 3.2 Filter (Reihenfolge)
1. Nur Objekte mit Eintrag in `gobjaverse_280k_index_to_objaverse.json` (= haben Karten).
2. Lizenz ∈ {`cc0`, `by`, `by-sa`}; Attribution je Objekt in `attribution.jsonl` festhalten (wie `lab/sketchgen/objaverse_stream.py`). `by-nc`/`by-nc-sa` ausschließen, falls ein Produkt denkbar ist. [Projektregel: Lizenz je Quelle klären]
3. GObjaverse-Kategorien: Animals (28.882), Plants (7.195), Human-Shape (41.557, enthält Figuren/Kreaturen), optional Food; **„Poor-quality“ (107.001) ausschließen**. Beachte: die Zahlen summieren sich zu mehr als 280k → ein Objekt kann in mehreren Kategorien stehen. [geprüft: Projektseite] Diese Zahlen gelten für alle ~580k Objekte (`category_annotation.json` hat 579.337 Einträge); **innerhalb des 280k-Index** (tatsächlich 265.232 Einträge) sind es laut Teil-Indizes: Animals 17.239, Plants 4.140, Human-Shape 13.622, Poor-quality 41.597. [geprüft: Dateien geladen]
4. Scans/Massenuploads raus: Tags/Namen mit `photogrammetry|scan|polycam|lidar|reality capture|…` (Regex `BAD` in `lab/sketchgen/objaverse_stream.py`), `animationCount > 0` raus.
5. Fabelwesen: Stichwörter in Name/Tags (creature, monster, dragon, unicorn, … siehe `docs/objaverse-kategorien.md`).
6. Aufteilung **nach Objekt** (nie nach Ansicht): 90 % train, 5 % val, 5 % test, per Hash der UID.

**Ergebnis Stufe 0:** `lab/gobj/select.jsonl` (UID, GObjaverse-ID, Kategorie, Lizenz, Autor, Split, Caption).

### 3.3 Pilot (zuerst!)
100 Objekte (je ~40 % Tiere, 30 % Pflanzen, 30 % Kreaturen), alle 40 Ansichten laden. Zweck: Dateiformat prüfen (Abschnitt 4.1), Plattenbedarf messen, Skizzen-Generator entwickeln.

### 3.4 Ergebnis Stufe 0 + Pilot (ausgeführt 2026-11-21) [geprüft: lokal]
Skripte: `lab/gobj/select.py` → `lab/gobj/select.jsonl` + `pilot.json`; `lab/gobj/download.py` (URL-Schema aus dem offiziellen `download_gobjaverse_280k.py`, <https://github.com/modelscope/richdreamer/tree/main/dataset/gobjaverse>); `lab/gobj/inspect_sample.py` → `lab/gobj/pilot_sheet.png` (Übersicht Ansicht 0 aller 100) + `pilot_sheet.json`. Daten unter `lab/gobj/data/` (nicht im Git).
- **Auswahl:** 29.720 Objekte (animal 11.467, plant 3.382, creature 4.104, human 10.767); Split train 26.647 / val 1.534 / test 1.539. Abgelehnt: 3.592 Scan-Stichwort, 1.689 Animation/Altersgrenze. **Kein einziges Objekt wurde wegen der Lizenz abgelehnt** und alle hatten Objaverse-Metadaten → der 280k-Index enthält offenbar nur `by`/`by-sa`/`cc0` (Treffer: by 29.333, by-sa 266, cc0 121).
- **Pilot:** 100/100 Objekte vollständig geladen, 1,3 GB, Masken aus Alpha und aus Tiefe > 0 stimmen bei allen zu 100 % überein.
- **Inhaltliche Auffälligkeiten (Sichtprüfung `pilot_sheet.png`):** ≈ 19 % untexturiert (weiß/grau, automatisch gezählt: Albedo-Sättigung < 20 und Helligkeit > 150) – als RGB-Zielbild für „farbige“ Ergebnisse ungeeignet, evtl. getrennt behandeln oder als eigener Stil („Tonmodell“); mehrere **Markenfiguren** (Sonic, Bowser, Yu-Gi-Oh-Drache) trotz CC-BY-Lizenz → Rechte der Figur ≠ Lizenz des Modells, für ein Produkt herausfiltern; Voxel-/Minecraft-Stil häufig; Sockel/Bodenplatten häufig; vereinzelt Scans, die der Stichwortfilter nicht erkennt; die Gruppe „creature“ (Stichwortregex) enthält auch normale Tiere (Orca, Wespe). Ein Objekt (121/615784) liegt, die übrigen stehen aufrecht.
- **Nächster Schritt:** Filter für untexturiert/Marken/Voxel nachrüsten (Albedo-Statistik, Stichwortliste Marken), dann Stufe 1 (Skizzen) auf dem Pilot.

---

## 4. Stufe 1 – Skizzen aus den Karten erzeugen

### 4.1 Zuerst prüfen (Annahmen, nicht geöffnet)
Pro Ansicht liegen laut README: `NNNNN.png` (RGB), `NNNNN_albedo.png`, `NNNNN_hdr.exr`, `NNNNN_mr.png`, `NNNNN_nd.exr` (Normalen + Tiefe), `NNNNN.json` (Kamera); Ordner `campos_512_v4`. [geprüft: README] Das offizielle Download-Skript lädt zusätzlich `NNNNN_ng.exr` und Ansichten 0–39. [geprüft: Skript]
**Geklärt am Pilot (2026-11-21) [geprüft: lokal ausgelesen]:**
- Auflösung **512×512**. `NNNNN.png` = **RGBA mit transparentem Hintergrund** (Ecke = 0,0,0,0) → Maske = Alpha > 0; identisch mit Tiefe > 0. `_albedo.png`, `_mr.png` = RGBA mit Alpha überall 255, Hintergrund schwarz.
- `_nd.exr`: ein Kanal-Satz `RGBA`, float16. **RGB = Normalen in [−1, 1]** (Hintergrund = (0,0,1)), **A = Tiefe** (Hintergrund = 0, Objekt ≈ 0,9–2,2 bei Kameraabstand 1,55–1,77). Lesbar mit dem Paket `OpenEXR` (`OpenEXR.File(p).channels()["RGBA"].pixels`) oder OpenCV mit `OPENCV_IO_ENABLE_OPENEXR=1`. `_ng.exr` wie `_nd`, aber A = 1.
- Kamera-JSON: `origin`, Achsen `x`,`y`,`z`, `x_fov`=`y_fov`=0,691 rad (≈ 39,6°), `bbox`, `scale`, `offset`, `max_depth`=5.
- **Ansichten (40 Dateien, 38 verschiedene):** 0–23 Ring mit Azimut je 15° bei einer **pro Objekt zufälligen Elevation 5–27°** (Pilot: 5,0–26,8°), Abstand 1,77; **24 = Duplikat von 0**; 25 = von oben (90°), 26 = von unten (−90°); 27–38 Ring mit Azimut je 30° bei −2°, Abstand 1,55; **39 = Duplikat von 27**.

Ursprünglich offene Punkte (jetzt beantwortet, siehe oben):
- Hintergrund der RGB-Bilder: weiß/schwarz/transparent (RGBA)? Entscheidet, ob eine Maske aus Alpha oder aus Tiefe kommt.
- Kanalaufbau von `_nd.exr` (3 Normalen + 1 Tiefe?), Wertebereich, Hintergrundwert für „leer“.
- Normalen-Koordinatensystem: Unity-basiert, nicht Blender (laut README, mit Beispielcode zur Umrechnung). Für Kanten reicht die **relative** Änderung der Normalen, die Umrechnung ist erst für 3D-Vergleiche nötig.
- Ansichtswinkel laut Projektseite: 38 Ansichten = 24 bei Elevation 5–30° (Azimut je 15°) + 12 bei −5…5° (Azimut je 30°) + Oben + Unten. [geprüft: Projektseite; im Pilot bestätigt, Details oben]

### 4.2 Linien ableiten (Rastervariante, zuerst bauen)
Eingabe pro Ansicht: Maske M, Normalen N, Tiefe D, RGB, Albedo A.
1. **Umriss:** Rand von M (1–2 px).
2. **Knicke (Kanten):** Kantenstärke aus dem Gradienten von N (Winkelsprung zwischen Nachbarpixeln > Schwelle 25–40°, Schwelle pro Bild zufällig wählen wie `crease_deg` im Generator).
3. **Tiefensprünge:** |∇D| relativ zur Objektgröße > Schwelle.
4. **Innenmuster (optional, dünn):** Kanten in A (Fellmuster, Textur) → blasse Linien; Plattform für „Konstruktionslinien“-Ersatz.
5. Zusammensetzen mit **Deckkraft nach Linienart**: Umriss dunkel, Knicke mittel, Texturlinien blass (nach dem Muster von CAD2Sketch, siehe `HANDOVER.md` Abschnitt 4 und Paper-Kernaussagen).

### 4.3 Stilisieren (Handschrift simulieren)
Pro Bild **3–5 Varianten** mit zufälligem Stil, damit das Modell nicht auf einen Stil überanpasst (Erfahrung aus `real_v1`: >80 % CAD2Sketch → Modell hat dessen Stil auswendig gelernt, siehe Memory `sketchlab-own-model`):
- Abstraktionsstufen: A) viele Details, B) nur Umriss + Hauptkanten, C) stark vereinfacht (nur Umriss und 3–6 Binnenstriche).
- Wackeln (zufällige Verschiebungsfelder), Strichunterbrechungen, Überschwung, variable Dicke/Druck, Doppelstriche, Strich-Rauschen, leichte Verschiebung.
- Optional Vektorisierung (Skelett → Polylinien) und dann den vorhandenen Strichstil aus `lab/sketchgen` (Novize … Profi, Zielfehler, Überschwung, Wackeln) anwenden: Details in `lab/sketchgen/README.md`.
- Hintergrund weiß, Tinte schwarz/grau, Auflösung wie Zielbild (512²).

**Wichtig (Prozess, wie in `HANDOVER.md` Schritt 4):** Erst **50 Beispiele** (Tiere, Pflanzen, Kreatur) dem Nutzer zeigen und freigeben lassen, **bevor** großflächig erzeugt wird.

### 4.4 Ausgabeformat (Paar)
```
lab/gobj/pairs/<gobj_id>/<view>/
    sketch_<style>.png   # 512², weiß/schwarz
    target.png           # RGB aus GObjaverse (NNNNN.png), Hintergrund wie in 4.1 geklärt
    mask.png             # Objektmaske
    meta.json            # uid, gobj_id, view (az,el), kategorie, lizenz, autor, caption, split, sketch_style
```
Training liest daraus `(sketch, target, caption)`.

### 4.5 Ansichten wählen
Nicht alle 38 verwenden (24 und 39 sind Duplikate). Je Objekt 6–8 Ansichten, davon die Hälfte „3/4-Ansicht“ (Ring 0–23; welcher Azimut „vorne“ ist, ist je Objekt unbekannt [Annahme: nicht einheitlich]; die Elevation ist pro Objekt fest, 5–27°), der Rest Seite/Front/Rücken. Ober-/Unteransicht nur wenige (selten gezeichnet). Skizzen sind im Einsatz meist 3/4-Ansichten.

---

## 5. Stufe 2 – Skizze → Bild (vortrainiertes Modell feintunen)

### 5.1 Kandidaten (Lizenz geprüft per Hugging-Face-API 2026-11-21)
| Modell | Lizenz | Hinweis |
|---|---|---|
| `xinsir/controlnet-scribble-sdxl-1.0` (ControlNet-Scribble für SDXL) | apache-2.0 | <https://huggingface.co/xinsir/controlnet-scribble-sdxl-1.0> – **erste Wahl** |
| `stabilityai/stable-diffusion-xl-base-1.0` (Basismodell) | openrail++ | <https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0> |
| `lllyasviel/control_v11p_sd15_scribble` (SD 1.5) | openrail | <https://huggingface.co/lllyasviel/control_v11p_sd15_scribble> – leichter Ausweich bei wenig GPU-Speicher |
| `xinsir/controlnet-union-sdxl-1.0` | apache-2.0 | mehrere Steuerungsarten in einem Modell |
| FLUX.1-dev + Union-ControlNets | „other“ (nicht-kommerziell) | **nicht verwenden**, sofern Produkt denkbar |

### 5.2 Schritt 2a – Zero-Shot-Baseline (ohne Training!)
Vor jedem Training: Skizzen aus Stufe 1 → `xinsir/controlnet-scribble-sdxl-1.0` mit Caption als Prompt (aus `text_captions_cap3d.json` oder „a 3D render of a {kategorie}, white background, centered, soft lighting“) → Bild. Danach Stufe 3 (TRELLIS). **Misst die Messlatte** und zeigt, ob Feintunen überhaupt nötig ist.

### 5.3 Schritt 2b – Feintuning
Ziel: Bilder im **GObjaverse-Render-Stil** (zentriertes Einzelobjekt, saubere Beleuchtung, neutraler Hintergrund), damit TRELLIS sie gut versteht, und stärkere Treue zur Skizze.
- Ansatz A (empfohlen): ControlNet weiter trainieren (Skript `train_controlnet_sdxl.py` aus diffusers) auf Paaren (Skizze → target.png), Prompt = Caption.
- Ansatz B (billiger): LoRA auf dem SDXL-U-Net, ControlNet eingefroren.
- Auflösung: GObjaverse-Bilder sind 512² [Annahme, Ordner `campos_512_v4`]; SDXL arbeitet nativ mit 1024². Optionen: (i) 512² hochskalieren (Qualität leidet), (ii) SD 1.5 verwenden, die nativ mit 512² arbeitet. **Entscheidung nach dem Zero-Shot-Test.**
- Startwerte (Annahmen, nicht geprüft): Lernrate 1e-5, Batch 1–4 mit Gradient-Accumulation, bf16, Gradient-Checkpointing, 20–50k Schritte, Validierung alle 1.000 Schritte auf festen 50 Val-Skizzen.
- **Wichtiger Trainings-Punkt:** Mischung der Abstraktionsstufen und Stile (Abschnitt 4.3); Anteil „stark vereinfacht“ nicht zu klein halten, sonst bricht das Modell bei echten Handskizzen ein.
- Echte Skizzen **nie ins Training** eines Produktmodells (DifferSketching/CAD2Sketch sind nur Forschung); nur als Test (Abschnitt 7).

### 5.4 Ausgabeanforderungen an das Bild
1 Objekt, zentriert, ganz sichtbar, Blickwinkel passend zur Skizze, neutraler Hintergrund. Das Bild wird in Stufe 3 weiterverarbeitet; ein schmutziger Hintergrund erschwert die Freistellung.

---

## 6. Stufe 3 – Übergabe an TRELLIS (ohne Training)

### 6.1 Aufruf [geprüft: `example.py`, `trellis_image_to_3d.py`]
```python
import os
os.environ['SPCONV_ALGO'] = 'native'
from PIL import Image
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils

pipeline = TrellisImageTo3DPipeline.from_pretrained("microsoft/TRELLIS-image-large")  # MIT [geprüft: HF-API]
pipeline.cuda()
outputs = pipeline.run(image, seed=1)   # image: PIL
# outputs['gaussian'][0], outputs['radiance_field'][0], outputs['mesh'][0]
# Optionale Sampler: sparse_structure_sampler_params={"steps":12,"cfg_strength":7.5}, slat_sampler_params={"steps":12,"cfg_strength":3}
```
GLB-Export: `postprocessing_utils.to_glb(outputs['gaussian'][0], outputs['mesh'][0], simplify=…, texture_size=…)` (im README-Beispiel; Parameter beim Einbau nachlesen).

### 6.2 Was TRELLIS mit der Eingabe macht (`preprocess_image`, gelesen)
- Hat das Bild einen **Alpha-Kanal** (RGBA mit Transparenz), wird dieser direkt verwendet; sonst Hintergrundentfernung mit `rembg` (u2net).
- Zuschnitt auf die Objektbox, ×1,2 Rand, auf **518×518** skaliert, Alpha vorab multipliziert (Hintergrund **schwarz**).
→ Empfehlung: Wir liefern **RGBA mit sauberer Maske** (Maske aus einer eigenen Hintergrundentfernung oder aus dem Skizzenumriss), damit `rembg` nicht fehlschlägt.

### 6.3 Mehrere Kandidaten
Pro Skizze **N Seeds (z. B. 4–8)** erzeugen. Auswahl nach Rendern der Gaussians/des Meshes aus der **bekannten Ansicht** und Vergleich der Silhouette mit der Skizze bzw. dem generierten Bild (Maske-IoU). So wird die Streuung von TRELLIS abgefangen.

---

## 7. Auswertung (Stufe für Stufe + Ende-zu-Ende)

Jede Stufe einzeln messen, damit klar ist, wo Qualität verloren geht.

| Stufe | Maß | Datensatz |
|---|---|---|
| Skizzen (Stufe 1) | Sichtprüfung durch den Nutzer (50 Beispiele); Linien liegen auf Objektkanten | Pilot |
| Skizze → Bild (Stufe 2) | Maske-IoU gegen Ziel-Maske, LPIPS/CLIP-Ähnlichkeit zum Ziel-Render, Kanten-Chamfer zwischen Eingabe-Skizze und Kanten des Ergebnisbilds | Val/Test-Objekte |
| TRELLIS (Stufe 3) | Silhouetten-IoU des gerenderten Ergebnisses aus der Eingabeansicht gegen Ziel-Maske; **Oberschranke:** TRELLIS auf dem **echten GObjaverse-RGB-Bild** | Test |
| Ende-zu-Ende | Silhouetten-IoU, Sicht-/CLIP-Vergleich; 3D-Chamfer gegen das Original-Mesh nur nach Ausrichtung (Maßstab/Pose, Koordinatensystem beachten) | Test |
| Echte Skizzen | Nutzer-Sichtprüfung auf OpenSketch, DifferSketching, SketchANIMAR (Test, nicht Training) | siehe `docs/datasets-skizze-2d-3d.md` |

**Pflicht-Baselines:** (1) Zero-Shot-ControlNet + TRELLIS; (2) TRELLIS direkt auf dem GT-Bild (Oberschranke); (3) unser bisheriges Voxel-Modell (`lab/seg_eval.py`, IoU nach Schärfen) als historischer Vergleich.

---

## 8. Stufe 4 – Nachverarbeitung und Anschluss

- **Mesh/Format:** GLB exportieren; Ausrichtung/Skalierung normieren.
- **Teile/Segmentierung:** (a) kantenbasiert: `prompt-editor/app/segmentation.py`, (b) Ebenen schärfen: `prompt-editor/app/sharpen.py` (für flächige Objekte), (c) teilbewusst direkt aus dem Bild: PartCrafter <https://arxiv.org/abs/2506.05573> oder OmniPart <https://arxiv.org/abs/2507.06165> (beide bauen laut Suchergebnis auf vortrainierten 3D-Generatoren auf; Eignung für unsere Daten prüfen).
- **Prompt-Editor:** Teile werden als benannte Szenenknoten (`flaeche_NN`) in `prompt-editor` geladen; Farbe/Änderungen pro Teil per Prompt. Pipeline getestet: `lab/pipeline_demo.py`.

---

## 9. Risiken, Annahmen, offene Fragen

1. **Datenformat ungeprüft** (Hintergrund, EXR-Kanäle, Auflösung) → Pilot Abschnitt 3.3/4.1.
2. **Skizzen aus Renderings ≠ echte Handskizzen.** Abgeleitete Linien sind „zu sauber“ und haben keine verdeckten Linien/Konstruktionslinien. Gegenmaßnahme: starke Stilisierung (4.3) plus Test auf echten Skizzen (7). Restrisiko bleibt.
3. **Verdeckte Rückseite** ist aus einer Ansicht immer geraten; TRELLIS ergänzt sie plausibel, aber nicht notwendig richtig.
4. **ControlNet ignoriert Linien oder erfindet Details.** Im Zero-Shot-Test beobachten; Gegenmaßnahme Feintunen und höhere Steuerstärke.
5. **GPU:** Weder Heim-PC (8 GB) noch Laptop erfüllen SDXL-Training oder TRELLIS (≥16 GB). Cloud-GPU nötig. Kosten/Zeit noch nicht geschätzt.
6. **Lizenzen:** GObjaverse-Datensatz MIT [geprüft: README], aber Objekte tragen eigene Lizenzen (CC-BY usw.). TRELLIS-Gewichte MIT, SDXL OpenRAIL++, Scribble-ControlNet Apache-2.0 [geprüft: HF-API]. Objaverse-Attributionen für CC-BY mitführen.
7. **Koordinatensystem/Ansichtswinkel:** Skizze und Ansicht müssen zusammenpassen; GObjaverse-Kamera-JSON verwenden, falls 3D-Vergleiche nötig werden.
8. **Skalierung:** Ein Hash-Split nach Objekt ist Pflicht, sonst Leck zwischen Ansichten desselben Objekts.
9. **TRELLIS-Streuung:** Ergebnisse variieren je Seed → Mehrfachsampling (6.3).

---

## 10. Meilensteine mit Abnahmekriterium

| # | Arbeit | Abnahme |
|---|---|---|
| M0 | Umgebungen: Daten-Venv (OpenEXR, OpenCV), Cloud-GPU mit TRELLIS + diffusers lauffähig | TRELLIS erzeugt aus einem Beispielbild ein GLB |
| M1 | Stufe 0 + Pilot (100 Objekte) laden, Format klären, Platzbedarf messen | `select.jsonl`, Formatnotiz (Hintergrund, EXR-Kanäle) – **erledigt 2026-11-21, siehe 3.4/4.1** |
| M2 | Skizzen-Generator (Raster, dann Stil) | 50 Beispiele, vom Nutzer freigegeben |
| M3 | Zero-Shot-Baseline: Skizze → ControlNet → TRELLIS auf Pilot-Test | Maske-IoU-Zahl + Bilderblatt; Oberschranke (TRELLIS auf GT-Bild) |
| M4 | Skalierung Stufe 0–1 auf 5.000, dann 20.000 Objekte | Paare vorhanden, Splits sauber |
| M5 | Feintuning Skizze → Bild | besser als M3 auf Val/Test (Maske-IoU, Kanten-Chamfer, Sicht) |
| M6 | Ende-zu-Ende + echte Skizzen (Test) | Bericht mit Zahlen und Bilderblatt |
| M7 | Nachverarbeitung (Schärfen/Teile) + Prompt-Editor | Haus/Tier-Demo wie `lab/pipeline_demo.py` |

---

## 11. Vorgeschlagene Ordner

```
lab/gobj/
  select.py            # Stufe 0 (Filter, Splits, Attributionen)
  download.py          # GObjaverse-Teilmengen laden (nach README)
  inspect_sample.py    # Format prüfen (Abschnitt 4.1)
  sketch_from_maps.py  # Stufe 1 (Raster + Stil)
  pairs/               # Paare (nicht im Git)
  train_controlnet.sh  # Aufruf des diffusers-Skripts mit Parametern
  run_trellis.py       # Stufe 3 (Mehrfach-Seeds, Auswahl, GLB)
  eval_pipeline.py     # Abschnitt 7
```

---

## 12. Quellen (alle geöffnet)

- GObjaverse: <https://aigc3d.github.io/gobjaverse> · <https://huggingface.co/datasets/3DAIGC/gobjaverse> (README: 38 Ansichten, Dateistruktur, Downloads, Kategorien, Koordinatensystem) · Download-Skripte: <https://github.com/modelscope/richdreamer/tree/main/dataset/gobjaverse>
- Objaverse: <https://arxiv.org/abs/2212.08051> · <https://huggingface.co/datasets/allenai/objaverse>
- TRELLIS: <https://github.com/microsoft/TRELLIS> · Paper <https://arxiv.org/abs/2412.01506> · Gewichte <https://huggingface.co/microsoft/TRELLIS-image-large>
- Scribble-ControlNet SDXL: <https://huggingface.co/xinsir/controlnet-scribble-sdxl-1.0>
- SDXL: <https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0>
- SD1.5-Scribble: <https://huggingface.co/lllyasviel/control_v11p_sd15_scribble>
- PartCrafter: <https://arxiv.org/abs/2506.05573> · OmniPart: <https://arxiv.org/abs/2507.06165>
- Echte Skizzen zum Testen: OpenSketch <https://repo-sam.inria.fr/d3/OpenSketch/index.html> · DifferSketching <https://arxiv.org/abs/2209.08791> · SketchANIMAR <https://arxiv.org/abs/2304.05731>
