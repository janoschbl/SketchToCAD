# Plan: Teil-Segmentierung (Dach, Wand, Tür …) für SketchLab

Stand 2026-11-21. Übergabe an einen Agenten. Projektregeln: `CLAUDE.md` (Doku auf Deutsch, Sub-Agents nur GPT-6-Luna über `delegate_task`, nur geprüfte Links). Kontext: `HANDOVER.md` (Abschnitte 4b–4d), `lab/sketchgen/README.md`.

## Ziel

Aus einer Skizze entsteht ein 3D-Modell, das **in benannte Teile zerlegt** ist (z. B. Haus: Dach, Wände, Schornstein, Tür, Fenster; Tisch: Platte, Beine). In der Lab-Seite kann man:
1. ein Teil anklicken und auswählen,
2. dem Teil eine Farbe geben,
3. ein Teil einzeln als 3D-Datei (GLB/OBJ) exportieren, z. B. um es an ein anderes Modell zur Texturierung zu geben (welches, ist offen und vorher zu prüfen).

## Machbarkeit: ja

Der Kernpunkt: **Wir erzeugen die Trainingsdaten selbst**, also kennen wir die Teile.
- procad (`lab/sketchgen/procad.py`) baut jede Form aus Grundkörpern (Wandquader, Dachprisma, Schornstein, Fenster-Taschen, Tischbeine …). manifold3d merkt sich auch nach booleschen Operationen, aus welchem Grundkörper jedes Dreieck stammt: `Manifold.as_original()` → `original_id()`, nach `to_mesh()` die Felder `run_original_id` + `run_index` (lokal geprüft mit manifold3d 3.5.5: Würfel ∪ Zylinder − Würfel liefert drei Läufe mit drei IDs; die Schnittflächen gehören zum abziehenden Körper). → exakte Teil-Labels pro Dreieck, ohne Handarbeit.
- Das Modell (`lab/model_v2.py`, LiftNet) sagt bereits ein blickausgerichtetes 64³-Gitter voraus. Ein zusätzlicher Ausgabekopf mit K Teil-Klassen pro Voxel ist eine kleine Änderung.

## Vorgehen in Phasen

### Phase 0 – Schnelle Demo ohne Training (½ Tag, optional)
Geometrische Zerlegung des vorhergesagten Meshes: Flächen nach Normalen/Ebenen gruppieren (Region Growing), Heuristik „schräge, nach oben zeigende Flächen oben = Dach“, „senkrechte = Wand“. Nur als Demo für die UI, bricht bei klumpigen Vorhersagen.

### Phase 1 – Teil-Labels in den Trainingsdaten
- `procad.py`: jeden Grundkörper mit `as_original()` markieren und eine Tabelle `original_id → (Teilname, Teilklasse)` führen. Vokabular (erweiterbar): `wand, dach, schornstein, tuer, fenster, platte, bein, koerper, deckel, boden, griff, rohr, bohrung, sonstiges`. Kleine Taschen/Bohrungen: Label des abziehenden Körpers (z. B. `fenster`, `tuer`) – das ist gewollt, so wird das Fenster ein eigenes Teil.
- `generate.make_item`: pro Dreieck `part_id` mitgeben; Generator speichert pro Probe zusätzlich `<id>_parts.png` (Teil-ID pro Pixel aus dem Face-ID-Puffer, `render.py` liefert `fid` schon) und die Teil-Tabelle im JSON. Nützlich auch für 2D-Auswertung.
- Objaverse (später): GLB-Knoten-/Mesh-/Materialnamen als schwache Teil-Labels (z. B. „roof“, „wheel“), nur wo Namen sinnvoll sind; sonst nur als „Teil n“ ohne Klasse.
- CAD2Sketch: Zwischenschritte `shape_<k>.obj` → Differenz zwischen Schritten ergibt pro CAD-Operation ein Teil (Extrusion, Fase …), klassenlos. Lizenz: nur Forschung.

### Phase 2 – Labels ins Voxelgitter
`lab/realdata/build.py` (bzw. neues `build_parts.py` für procad): Objekt-Voxel (128³) bekommen ein Label je Voxel: Oberflächen-Voxel aus der Teil-ID der nächsten Dreiecke, Innen-Voxel per nächster Oberfläche (`scipy.ndimage.distance_transform_edt(..., return_indices=True)`). Beim Umrechnen ins blickausgerichtete 64³-Gitter `map_coordinates(order=0)` für Labels. Speichern als `parts64.npy` (uint8, 0 = leer).

### Phase 3 – Modell
- LiftNet: Ausgabe von 1 auf 1 + K Kanäle (Belegung + Teil-Logits). Verlust: bisheriger Belegungs-Verlust + Kreuzentropie auf Teil-Klassen **nur innerhalb belegter Voxel**.
- Zwei Varianten zum Vergleichen: (a) semantische Klassen (Dach, Wand …) – direkt benannt; (b) klassenlose Teile über Instanz-Embedding + Clustering – flexibler für unbekannte Objekte. Mit (a) beginnen.
- Training auf procad (60k Skizzen in `lab/out/procad_v1`, Seeds → Meshes exakt reproduzierbar) plus optional CAD2Sketch/DifferSketching nur für die Belegung (Teil-Verlust dort maskieren). Heim-PC: RTX 2070, ~3,5 GB frei neben MeshPad + voxtype → Batch 8.
- Metriken: Belegungs-IoU wie bisher, Teil-mIoU pro Klasse auf procad-Test, Sichtprüfung an Häusern/Tischen/Dosen.

### Phase 4 – Server
`lab/serve_v2.py`: pro Teil ein eigenes Mesh (Marching Cubes auf `logits_occ > 0 & argmax == k`, kleine Teile < N Voxel verwerfen), Rückgabe `parts: [{id, name, color, mesh}]` statt nur `mesh`. Nahtstellen: Teile teilen sich Grenzflächen; für Export ok, optional leicht schrumpfen.

### Phase 5 – Lab-Seite (`app/lab.html`, `app/src/lab/lab.ts`)
- Teile als einzelne Three.js-Meshes; Klick per Raycaster → Teil auswählen (Umriss hervorheben), Liste der Teile mit Namen.
- Farbwähler pro Teil.
- Export: ausgewähltes Teil oder alle Teile als GLB (Three.js `GLTFExporter`, Teile als benannte Knoten) bzw. OBJ.
- Übergabe zur Texturierung: Teil-GLB + Textvorschlag („Dach, rote Tonziegel“). Welches Texturmodell/welcher Dienst genutzt wird, ist **offen und vor Einbau zu prüfen** (Lizenz, API, Kosten); hier nur eine saubere Export-Schnittstelle bauen.

### Phase 6 – Später
- Zweiter Pass: Teil-Meshes glätten/vereinfachen (z. B. Ebenen bei Wand/Dach einpassen → saubere CAD-Flächen).
- Nutzer markiert in der Skizze selbst Teile (Strichfarbe = Teil) als zusätzliche Eingabe.

## Reihenfolge / Aufwand (grob)

| Phase | Aufwand | Ergebnis |
|---|---|---|
| 1 + 2 Daten | 1 Tag | procad-Skizzen mit Teil-Labels (2D + 3D) |
| 3 Modell | 1 Tag + Training (~2–3 h) | Belegung + Teil-Klassen |
| 4 + 5 Server/UI | 1 Tag | Klicken, Färben, Teil-Export |

## Risiken

- Modell sagt aktuell noch Klumpen statt Dächer voraus (Lauf `real_v1` ohne Häuser in den Daten). Teil-Segmentierung lohnt erst mit procad-Häusern im Training → Phase 3 trainiert ohnehin auf procad.
- 64³ ist grob: Fenster/Türen sind wenige Voxel dick → eventuell nur als Farbe/Fläche statt als Volumen-Teil.
- Lizenz: CAD2Sketch/DifferSketching nur Forschung; procad + Objaverse (cc0/by/by-sa) sind die Basis für alles, was später ein Produkt werden soll.

## Abnahme

Haus-Skizze zeichnen → 3D mit mindestens Dach und Wänden als getrennte, benannte Teile; Dach anklicken → rot färben → als `dach.glb` exportieren und in einem externen Viewer öffnen.
