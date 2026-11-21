# HANDOVER – SketchToCAD / SketchLab (Stand 2026-11-21)

Ziel: Skizze → 3D-Modell, nahezu in Echtzeit (RTX 2070, am besten auch Laptop-CPU), Gefühl wie NVIDIA Canvas (jeder Strich rechnet neu). MeshPad bleibt Baseline, ein eigenes kleines Modell wird unabhängig trainiert. Projektregeln: siehe `CLAUDE.md` (Sub-Agents nur GPT-6-Luna über `delegate_task`, Doku auf Deutsch, nur geprüfte Links). Vite-Dev-Server auf Port 5174 laufen lassen.

## 1. Aktueller Stand (ehrlich)

**Das erste eigene Modell ist unbrauchbar für das eigentliche Ziel.** In der Lab-Seite kommt bei Haus, Kreis (Ball/Zwiebel) und Dose nur ein grauer Klumpen heraus. Test-IoU 0,29, stark überangepasst (bestes Val-IoU bei Epoche 5 von 30).

Was existiert und funktioniert (technisch):

| Teil | Ort | Status |
|---|---|---|
| Preprocessing (Voxel 64³, Skizzen 128²) | `lab/prep.py`, `lab/data/` (nicht im Git) | läuft, 233 s auf 16 Threads |
| Training | `lab/train.py` (Kopie auf Heim-PC `~/dev/sketchlab`) | lief, 30 Epochen ~50 min |
| Modell (CNN 2D → Vektor → 3D-Decoder, 9,7 M Param.) | `lab/model.py` | trainiert, schlecht generalisierend |
| Inferenz-Server (FastAPI, Port 8781) | `lab/serve.py`, systemd `sketchlab.service` auf Heim-PC | läuft |
| Trainings-Dashboard (weiß, 8780) | `lab/dashboard.html`, `lab/status.sh` | läuft |
| Lab-Seite mit Live-Vorhersage + MeshPad-Vergleich | `app/lab.html`, `app/src/lab/lab.ts`, Proxy `/lab-api` in `app/vite.config.ts` | läuft, iPad: `http://192.168.0.135:5174/lab.html` |
| Kamera-Konvention (verifiziert, IoU ~0,85 vs. Skizzen) | `lab/cam_probe.py` | Kamera bei (cos az·cos el, sin az·cos el, sin el), Z oben, ortho Maßstab 3,5, Modelle auf z∈[-1,1] |

Nichts davon ist committet (`app/`, `lab/`, `docs/base44-landing-prompt.md` sind untracked).

## 2. Was falsch ist (Ursachenanalyse)

1. **Falsche Eingabe.** Unsere 21.768 Skizzen sind nur *Silhouetten-Umrisse* (zusätzlich orthografisch, 12 Ansichten). Echte Skizzen haben **Innenkanten, Konstruktionslinien, Ellipsen, Perspektive**. Ein Kreis kann Ball, Ei, Stein, Scheibe sein; ein Haus-Umriss ist nur ein Sechseck. Die Information, die ein Mensch zum Erkennen nutzt (Dachfirst, obere Ellipse einer Dose), fehlt komplett.
2. **Falsche Objektwelt.** Nur 448 Poly-Haven-Assets (Steine, Zwiebeln, Requisiten), davon ~360 im Training. Haus, Dose, Einhorn, Möbel kommen nicht vor. Das Modell lernt "Klumpen mit passender Silhouette".
3. **Schwache Architektur.** Flacher Flaschenhals-Vektor (8192 Zahlen) statt räumlicher Projektion der Skizze in den 3D-Raum; keine Symmetrie-Vorgabe; kein vortrainierter Encoder.
4. **Keine Baseline vorab.** Eine triviale Inflate-/Rotations-Baseline (Kreis → Kugel) hätten wir vor dem Training bauen müssen. Ohne sie sagt IoU 0,29 wenig.
5. **Unfairer MeshPad-Vergleich.** MeshPad erwartet Innenlinien und rote Striche für neue Geometrie; Silhouetten-Skizzen liegen außerhalb seiner Verteilung.

Weitere Schwächen: kein Per-Objekt-Bericht, kein Visual-Hull-Score, Teststücke nur synthetisch, keine echten Zeichnungen im Test, ~12 % der Skizzen sind fast perfekte Ellipsen (Gewicht 0,3 im Training), keine Farben.

## 3. Neuer Plan

**Leitidee (vom User):** Skizzen *aus 3D-Modellen künstlich erzeugen* (wie CAD2Sketch), mit Innenkanten und Perspektive, im Umkehrsinn trainieren. Echte Zeichnungen und Filmskizzen nur als Test (kein 3D vorhanden).

Reihenfolge:

1. **Geometrie-Baseline ohne Training** (Inflate à la Teddy / Rotationskörper um Achse) in der Lab-Seite. Kreis muss Kugel werden. ~1 h. Das ist die Messlatte.
2. **Kanten-Skizzen-Generator, lokal** (kein Onshape): Aus Meshes Silhouette + Faltkanten (Crease-Winkel) + Tiefensprünge rendern, **Perspektive**, freie Blickwinkel (nicht nur 12 ortho), Sichtbarkeit/Verdeckung, optional ein paar Hilfs-/Konstruktionslinien (Ellipsen, Box-Kanten). Danach "handgemacht" stilisieren (Wackeln, Strichunterbrechungen, variable Dicke/Deckkraft, optional Schraffur/Schatten). Werkzeuge: Blender (Freestyle) oder eigener Renderer (numpy/pyrender/Rust). Multiprocessing auf allen Threads; später Heim-PC und KVM-Server .35/.50/.60 (SSH-Schlüssel liegen auf dem Heim-PC).
3. **Prozedurale Primitive als Datenquelle:** Quader, Zylinder, Kegel, Prisma, Kugel, Extrusion, Rotationskörper, boolesche Operationen, Teil-Labels und Farbe pro Teil. Unbegrenzt viele Daten, Symmetrie gratis, passt zu CAD. Mehr echte Formen: CAD-Datensätze (z. B. Fusion 360 Gallery, DeepCAD – hier NICHT geprüft, Lizenz/Verfügbarkeit vorher verifizieren) und größere Mesh-Sammlungen (Lizenz pro Modell prüfen).
4. **Modell v2:** Skizzen-Features als 2D-Karte behalten und mit bekannter Kamera in ein 3D-Gitter projizieren (statt flacher Vektor); optional Primitive-Predictor mit Symmetrie-Constraint (Spiegel-/Rotationsachse); vortrainierter Encoder (DINOv2/ResNet); Flip-Augmentation; Farbe als zusätzlicher Kanal/Output.
5. **Evaluation:** Mean-Voxel-Baseline, Inflate-Baseline, Visual-Hull-IoU, IoU pro Objekt (schlechteste zuerst), echte Testskizzen (Haus, Dose, Einhorn aus den User-Beispielen, FS-COCO/`zoheb/sketch-scene` rein visuell), MeshPad nur mit passender Skizze (Innenlinien, rot).
6. **Später:** Teilstrich-Training mit echter Strichreihenfolge (jeder Strich aktualisiert das Modell), vorsegmentierte Eingabe (SVG-/Visual-Arrow-Idee), Rust nur für sehr große Datenmengen (300k Modelle).

## 4. CAD2Sketch (was verifiziert ist)

Repo: <https://gitlab.inria.fr/D3/cad2sketch> (öffentlich, README gelesen, Dateiliste per GitLab-API gesehen, Code nicht ausgeführt). Projektseite <https://ns.inria.fr/d3/cad2sketch/> ließ sich vom Laptop aus nicht öffnen.

**Lokale Kopien (geladen und gelesen):**
- Paper: <https://repo-sam.inria.fr/d3/cad2sketch/cad2sketch_paper.pdf> → `lab/ext/cad2sketch/paper.pdf` (Text: `paper.txt`). "CAD2Sketch: Generating Concept Sketches from CAD Sequences", Hähnlein, Li, Mitra, Bousseau, ACM Trans. Graph. 41(6), Art. 279, Dez. 2022.
- Supplemental: <https://repo-sam.inria.fr/d3/cad2sketch/supplemental.pdf> → `supplemental.pdf` / `s2.txt`.
- Datensatz: <https://repo-sam.inria.fr/d3/cad2sketch/cad2sketch_dataset.gz> (2,5 GB gepackt, **12 GB entpackt**, Stand 2023-02-24) → entpackt in `lab/ext/cad2sketch/data/` (nicht im Git).
- Lizenz: <https://gitlab.inria.fr/D3/cad2sketch/-/raw/main/LICENSE.pdf> → `LICENSE.pdf`/`LICENSE.txt` (gelesen). EULA für die „CAD2Sketch Software“: kostenlos, nicht übertragbar, **nur interne Forschung/akademisch, keine kommerzielle Nutzung, keine Weitergabe** (Art. 4.1, 4.2, 4.4). Datensatz nicht separat lizenziert → genauso behandeln: nur Stilreferenz und Testset, nicht in ein Produkt/Modell für kommerzielle Nutzung.

### Datensatz-Inhalt (entpackt und angesehen)

- 2268 Modell-Ordner (Shape-Grammatik), 6834 Ansichten (≈ 3 pro Modell), Ansicht-Ordner benannt `<theta>_<phi>_<radius>` (z. B. `44.12_-126.08_1.4`; Deutung als Kamerawinkel nicht verifiziert).
- Pro Modell: `shape_<k>.obj/.stl` für jeden CAD-Zwischenschritt (letzter = finale Form), `feature_lines_<k>.json`, `feature_faces_<k>.json`, Onshape-`features.json`, `sketch_info.json`, `bodydetails*.json`.
- Pro Ansicht: `npr_sketch.svg` (Polylinien mit **Druck pro Punkt** und Deckkraft – echte Strichstil-Statistik), `strokes_dict.json` (Strichtyp z. B. `extrude_line`, Ebenen, Schnitte), `constraints.json`, `final_edges.json`, `visibility_scores`, `individual_lines/`, und `training_data/` (256², RGBA): `npr_*` (volle Methode), `npr_*_professional3` (Stil Designer 3), `npr_baseline0_*` (nur Featurelinien), `npr_baseline1(_clean)_*`, `normal_*` (Normalmap), `out_*` (Netzausgaben 512×256).
- Brauchbar für uns: (a) **Stilreferenz** (SVG-Striche mit Druck/Deckkraft, Typen), (b) **Testset** echter CAD-Formen mit Mesh + Normalmap, (c) Vergleich unserer Skizzen mit ihren (Bild `compare` siehe unten). Für kommerzielles Training nicht nutzbar (Lizenz).

### Kernaussagen des Papers (für unser Problem direkt relevant)

1. **Domänenlücke ist der Hauptgrund für schlechte Generalisierung.** Synthetische Linienbilder aus 3D-Modellen (nur Feature-Linien, Standard-NPR) generalisieren schlecht auf echte Konzeptskizzen. Zwei Ursachen laut Paper: (a) Designer zeichnen zusätzlich **Hilfs- und Konstruktionslinien** (Gerüst aus Quadern/Zylindern, Mittelpunkte, Ausrichtung, Projektionslinien), (b) sie **variieren Deckkraft und Strichform**: Konstruktionslinien blass, finale Kanten dunkel. Das ist genau unsere Lücke (wir haben nur saubere Umrisse).
2. **Pipeline:** CAD-Sequenz → (1) *Linien erzeugen*: Gerüstlinien aus Feature-Kurven aller Zwischenschritte, Hilfslinien aus Constraints (Mittelpunkt, horizontale/vertikale Ausrichtung, Proportionen), lokale Ebenen für Fillet-Bögen, Projektionslinien bei Extrusionen (Bounding-Box des Profils, Gitterlinien, Schnitte, Linien von Start- zu Endpunkt); Reihenfolge: Bounding-Box → Profilkurven → Gitter/Schnitte → Projektionslinien. (2) *Linien auswählen*: binäres Optimierungsproblem (Gurobi) mit Gewichten λ1 (Konstruktionsqualität) und λ2 (Lesbarkeit/Unordnung); Parameter werden pro Modell so gewählt, dass Anteile von Konstruktions-/sichtbaren/versteckten Linien den echten OpenSketch-Skizzen entsprechen. (3) *Stilisieren*: Strichform, Zielabweichung ("aim"), Überschuss ("overshoot") und Deckkraft aus echten Strichen von OpenSketch-Designern kopiert (Stylesheets im Repo).
3. **Menschenstudie:** Mit Designlehrern wurden die synthetischen Skizzen als ähnlich gut wie echte bewertet. Fig. 1 des Papers zeigt Beispiele.
4. **Anwendung Normal-Map-Vorhersage (das ist der Datensatz):** Netz basiert auf Sketch2Normal (1-Kanal-Graubild-Eingabe, ohne Normal-Hinweiskanal). 2000 synthetische CAD-Modelle (aus der Shape-Grammatik, siehe unten) für Training, 300 zum Testen, je 3 Skizzen aus verschiedenen 3/4-Ansichten → 6000 Skizze/Normal-Paare; λ1=0,5, λ2=0,01 (mehr Konstruktionslinien). Zusätzlich 108 ABC-Modelle und je 6 OpenSketch-Zeichnungen zweier Designer (D1, D3) als Test auf echte Formen/Skizzen.
5. **Ablation (Tabelle 2, Spaltenzuordnung gegen PDF-Layout S. 14 geprüft):** B0 nur finale Featurelinien (stilisiert), B1 alle Gerüstlinien schwarz, B2 Gerüstlinien stilisiert ohne Hilfslinien, „Ours“ mit ausgewählten Konstruktionslinien. B0–B2 mit 15k Skizzen trainiert (laut Text, nicht separat geprüft).
   | IoU / Winkelfehler | B0 | B1 | B2 | Ours-15k | Ours-30k | Ours-60k |
   |---|---|---|---|---|---|---|
   | synthetisch | 0,90 / 9,67° | 0,95 / 11,42° | 0,93 / 8,79° | 0,94 / 12,75° | 0,95 / 9,45° | 0,96 / 8,31° |
   | ABC | 0,87 / 14,63° | 0,88 / 18,82° | 0,90 / 14,01° | 0,86 / 18,4° | 0,90 / 15,71° | 0,91 / 13,24° |
   **Lesart:** Bei gleicher Datenmenge (15k) ist „Ours“ nicht besser als B0/B2; der Vorteil kommt erst mit 60k. Stilisierte Gerüstlinien (B2) bringen schon viel. → Für uns: Menge zählt, Konstruktionslinien helfen vor allem bei viel Daten; Netze ohne sie halten Konstruktionslinien für Kanten (qualitativ laut Paper).
6. **Grenzen laut Paper:** Nur Extrusion/Fillet/Chamfer unterstützt, keine Sweep/Loft (Maus-Beispiel: keine Flow-Linien); ABC-Sequenzen nur über Onshape-API und deshalb nur wenige hundert nutzbar; Fusion360 Gallery enthält nur Profile + Extrusionen; keine Modellierung von Zeichenfehlern jenseits Strichstil; reale Evaluation nur klein (OpenSketch).
7. **Verwandte Arbeiten/Verweise** (nur Namen aus dem Paper, nicht geprüft): Sketch2Normal (Su et al. 2018), OpenSketch (Gryaditskaya et al. 2019, <https://repo-sam.inria.fr/d3/OpenSketch/index.html> laut README), ABC (Koch et al. 2019), Fusion360 Gallery (Willis et al. 2021). Blender-Freestyle wird im Paper erwähnt (Fußnote 2) – Option für unseren lokalen Generator.

**Folgerung für uns:** Nicht nur Kanten rendern, sondern (i) Konstruktionslinien (Bounding-Box/Gerüst, Ellipsen für Zylinder, Mittel-/Ausrichtungslinien), (ii) gestufte Deckkraft, (iii) echte Strichform-Statistik (OpenSketch/`data/stroke_datasets`). Für Meshes ohne CAD-Historie gibt es keine Constraints; dort bleiben Silhouette, Faltkanten, Tiefensprünge und wenige automatisch abgeleitete Hilfslinien (z. B. Bounding-Box, Hauptachsen-Ellipsen). Prozedurale Primitive/CAD-artige Modelle liefern die Konstruktionsstruktur dagegen gratis.

### Pipeline laut README (Onshape, nicht für uns nötig)

Download (Onshape-API) → Linien (SynDraw) → Auswahl (Gurobi) → Stilisierung (OpenSketch-Strichdaten). Abhängigkeiten: SynDraw, pylowstroke, Gurobi, OpenCascade. Die Autoren raten selbst davon ab, damit große Datensätze zu erzeugen (Konto-Sperre möglich). **Wir brauchen keine Onshape-API:** der fertige Datensatz oben und ein eigener lokaler Generator reichen.

### Shape-Grammatik des Datensatzes (Supplemental)

Quader (quadratische Extrusion) → [Extrusion (+/−, Quadrat/Kreis) | Chamfer] → [Extrusion | Chamfer] → Fillet auf variabler Kantenzahl; Flächen/Kanten zufällig aus dem Zwischen-BREP, Tiefen/Radien diskret, Profilgröße/-position zufällig; Ansichten so gewählt, dass die CAD-Operation gut sichtbar ist (Skalarprodukt Blickrichtung/Operationsrichtung). Umsetzung im Repo: `synthetic_cad_utils.py`. Das Supplemental nennt zusätzlich eine Parameterwahl über OpenSketch-Statistiken (Anteile Konstruktions-/sichtbare/versteckte Linien liegen auf einer Geraden).

## 4b. Eigener Skizzen-Generator `lab/sketchgen/` (gebaut 2026-11-21)

Lokale Pipeline, Details in `lab/sketchgen/README.md`. Kurz: procad (manifold3d, Konstruktionshistorie → Konstruktionslinien) oder Mesh (Objaverse) → perspektivische Kamera → moderngl/EGL-Render (Tiefe, Normalen, Face-ID; läuft auf Laptop-iGPU) → Außenkontur aus Maske + Silhouetten/Faltkanten/verdeckte Kanten aus Mesh → Strichstil (Novize…Profi: Zielfehler, Überschwung, Wackeln, Druck, Nachziehen, Deckkraft nach Linientyp). Ausgabe: Skizze 512², Normalen, Tiefe, Kamera, Striche in Reihenfolge (JSON).
- Durchsatz Laptop: procad ~17/s, Objaverse ~4/s. `objaverse_stream.py` lädt Objaverse 1.0 stapelweise (Lizenzfilter cc0/by/by-sa, Scan-Filter), erzeugt Skizzen und löscht die GLBs wieder, `attribution.jsonl` für CC-BY.
- Erster Produktionslauf: `lab/out/procad_v1` (20k Objekte × 3 Ansichten = 60k Skizzen, Seed 1).
- Sichtvergleich mit CAD2Sketch: Profi-Stil sehr ähnlich; CAD2Sketch hat mehr Konstruktions-/Schnittlinien und verdeckte Linien.

## 4c. DifferSketching (geladen und angesehen)

Details: `lab/ext/differsketching/NOTES.md`. 3620 echte Skizzen (70 Novizen, 38 Profis) zu 136 OBJ-Modellen in 9 Kategorien, Striche mit Druck und Zeit, Referenzbild + saubere Nachzeichnung pro Ansicht, keine Kameraparameter. Code: vortrainierte MLP-„Disturber“ (Novize/Profi) für Freihand-Stil. Lizenz: nur nicht-kommerzielle Forschung, ausdrücklich auch für abgeleitete Daten.

**Kombination:** CAD2Sketch (Konstruktionslinien, Designer-Stil, CAD) + DifferSketching (echte Abweichungen Novize/Profi, vielfältige Objekte) ergänzen sich als *Stilreferenz und Testset*. Trainingsbasis bleibt unser eigener Generator (procad + Objaverse cc0/by/by-sa).

## 4d. Modell v2 auf CAD2Sketch + DifferSketching (gestartet 2026-11-21, Wunsch des Users)

- **Daten** (`lab/realdata/build.py` → `lab/data_real/`): pro Ansicht Kamera geschätzt (`realdata/camfit.py`, Silhouetten-Abgleich auf GPU; CAD2Sketch: Ordnername = `<Polarwinkel>_<Azimut>_<Radius>`, Z oben, Elevation = 90° − Polarwinkel, IoU ~0,99; DifferSketching: freie Suche über Azimut/Elevation/FOV und Hochachse Y/Z, Maske = nicht-weiße Pixel, plus Schattierungs-Korrelation, IoU ~0,85–0,97). Objekt einmal in 128³ vollvoxelisiert, je Ansicht in ein **blickausgerichtetes 64³-Gitter [Tiefe, Zeile, Spalte]** umgerechnet (pixelgenau zur Skizze, Ausschnitt 1,2 × Silhouetten-Box). Skizzen: CAD2Sketch 5 Stile/Ansicht, DifferSketching Original + registriert je Zeichner + Nachzeichnung; Eingabe 128² zugeschnitten auf 1,2 × Tinten-Box (identisch zur Inferenz). Split nach Objekt.
- **Live-Test** (`realdata/ood.py` → `data_real/ood/`): 18 procad-Skizzen (Häuser, Dosen, Tische …) – nicht im Training, misst „normales Haus“.
- **Modell** `lab/model_v2.py` (LiftNet, 13,5 M Param.): 2D-U-Net, Merkmale pixelgenau in die Tiefe gehoben (32³ und 64³), 3D-Faltungen. Kein Blickwinkel als Eingabe nötig.
- **Training** `lab/train_real.py` auf dem Heim-PC (Batch 8, ~10 it/s, GPU geteilt mit MeshPad 2,2 GB + voxtype 1,5 GB; `sketchlab.service` (altes Modell) dafür gestoppt). Bestes Val-Modell → `runs/real_v1/best.pt`, frühes Stoppen nach 40 Epochen ohne Verbesserung. Dashboard 8780 zeigt den Lauf.
- **Server** `lab/serve_v2.py`: gleiche API wie `serve.py`; dreht die blickausgerichtete Vorhersage mit az/el der Lab-Seite in Weltkoordinaten.
- Lizenz: beide Datensätze nur nicht-kommerzielle Forschung → dieses Modell ist ein Forschungsmodell, nicht für ein Produkt.

## 5. Infrastruktur

- Laptop: Ryzen 7 7730U (16 Threads), ~14 GB RAM, `/home` 917 GB frei, Seagate-HDD (`/run/media/janosch/Seagate HDD`, 1,5 TB frei) mit Originaldaten `testcreate/handdrawn_dataset`.
- Heim-PC "omarchy": Tailscale `100.86.99.105`, SSH `ssh -i ~/.ssh/meshpad_ed25519 janosch@100.86.99.105`, RTX 2070 8 GB (MeshPad belegt ~4 GB → Batchgröße ≤ 32), 31 GB RAM, **Platte zu 95 % voll (5,8 GB frei)**, venv `~/dev/meshpad/.venv` (torch 2.1.1+cu118). Dienste (systemd user): `meshpad.service` (8766), `sketchlab.service` (8781), `sketchlab-web.service` (8780).
- KVM-Server .35/.50/.60: noch ungenutzt; SSH-Schlüssel liegen auf dem Heim-PC.
- Lektionen: Hintergrund-SSH hängt, wenn Kindprozesse die Verbindung halten → systemd-Units nutzen; nie `pkill -f` auf ein Muster, das im eigenen Befehl steckt.

## 6. Nächste konkrete Schritte für den Folge-Agenten

1. ~~CAD2Sketch laden/entpacken/ansehen~~, ~~LICENSE lesen~~ (erledigt). Offen: Tabelle 2 (Spaltenzuordnung) gegen PDF-Seite 14 prüfen.
2. `procad_v1` (60k) ansehen; Stil gegen DifferSketching-Statistik (tracing ↔ reg_json) kalibrieren; Objaverse-Lauf starten (`objaverse_stream.py`).
3. Inflate-/Rotations-Baseline in `lab.ts` (Kreis → Kugel, Haus-Umriss → aufgeblasene Form).
4. Lokalen Kanten-Skizzen-Generator bauen (Blender Freestyle oder eigener Renderer), erst 50 Beispielbilder aus Meshes und prozeduralen Primitiven zeigen (Haus, Dose, Box, Kugel), User entscheidet, ob sie nach echten Skizzen aussehen, **erst dann** großflächig erzeugen/trainieren.
5. Dann Modell v2 (räumliche Projektion), Evaluation nach Abschnitt 3.5, Ergebnisse im Dashboard + Lab-Seite.
6. ETR-Updates an den User, Dashboard weiß und simpel (siehe `lab/dashboard.html`).
