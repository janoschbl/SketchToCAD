# sketchgen – synthetische Konzeptskizzen aus 3D-Modellen

Lokaler Generator (kein Onshape, kein Blender): 3D-Modell → perspektivische Ansichten → Kanten + Konstruktionslinien → handgezeichneter Strichstil. Liefert gepaarte Trainingsdaten Skizze ↔ Normalen/Tiefe/Kamera/Objekt. Idee und Linientypen nach CAD2Sketch (Hähnlein et al. 2022, siehe `../ext/cad2sketch/paper.pdf`), Code komplett eigenständig geschrieben.

## Ablauf

1. **Quelle** (`procad.py`, `generate.load_mesh`):
   - *procad*: prozedurale CAD-Formen mit manifold3d – Quader mit Extrusionen/Taschen/Bohrungen (Rechteck/Kreis, optional gespiegelt), Verrundung, Fase, Haus (Dach, Schornstein, Fenster), Drehkörper (Dose, Flasche, Vase), gestapelte Primitive, Tisch. Konstruktionslinien kommen aus der Konstruktionshistorie (Hüllquader, Profile, Projektionslinien, Achsen, Ellipsen).
   - *Meshes* (Objaverse-GLB, OBJ, STL): Konstruktionslinien werden geschätzt (`construct.py`): senkrecht ausgerichteter Hüllquader, Mittelachse, Mittellinien, Ellipsen bei rotationsähnlichen Formen, Quader großer Teile.
   - Alles wird normiert: Mittelpunkt des Hüllquaders im Ursprung, halbe Diagonale = 1, Z oben (`norm_center`, `norm_scale` im JSON).
2. **Kamera** (`generate.sample_camera`): perspektivisch, FOV 25–55°, Azimut frei, Elevation meist 15–40° (20 % flach, 10 % steil), Objekt füllt das Bild, berührt den Rand nicht.
3. **Rendern** (`render.py`): moderngl über EGL (headless, läuft auf der Laptop-iGPU). Puffer: Tiefe, Kamera-Normalen, Face-ID, Maske.
4. **Linien** (`lines.py`): Außenkontur aus der Maske (glatt, subpixelgenau), Innen-Silhouetten und Faltkanten aus der Mesh-Topologie (Winkel 30–45°, bei verrauschten Meshes automatisch höher), Sichtbarkeit per Tiefenpuffer, Verkettung zu Polylinien, Teilung an Knicken.
5. **Stil** (`stylize.py`): pro Skizze ein „Zeichner“ (Können 0 = Novize … 1 = Profi). Pro Strich: Zielfehler an den Enden, Überschwung (Konstruktionslinien stärker), Bogen, Wackeln, Druckverlauf → Strichbreite, Nachziehen, lange Striche in Teilstriche zerlegt. Deckkraft nach Typ: Konstruktion blass, verdeckt blass, finale Kanten dunkel, Außenkontur dicker. Reihenfolge: Achsen → Gerüst → Profile → Projektionen → Ellipsen → Kontur → Kanten → verdeckt.
6. **Filter**: Ansichten mit extrem vielen Innenlinien (Scans, Rauschen) werden verworfen (`error: clutter` im Index).

## Ausgabe pro Probe (`out/<lauf>/<shard>/<id>`)

| Datei | Inhalt |
|---|---|
| `<id>.png` | stilisierte Skizze, 512², Graustufen |
| `<id>_normal.png` | Normalen in Kamerakoordinaten (OpenGL-Stil: x rechts, y oben, z zur Kamera), RGBA, A = Maske |
| `<id>_depth.png` | Kameratiefe × 10000 als uint16, 0 = Hintergrund |
| `<id>_clean.png` | saubere Linien ohne Stil (nur mit `--clean`) |
| `<id>.json` | Kamera (K, R, t, C, az, el, fov, dist; OpenCV-Konvention), Normierung, Quelle (Seed bzw. UID), Stilparameter, Striche in Zeichenreihenfolge (Typ, Punkte, Druck, Deckkraft) |

`index_*.jsonl` listet alle Proben und Fehler. Procad-Objekte lassen sich aus `seed` exakt neu erzeugen (`procad.generate(seed)`), z. B. für Voxel-/SDF-Ziele.

## Benutzung

```bash
cd lab
# prozedurale CAD-Formen
.venv/bin/python -m sketchgen.generate --procad 20000 --views 3 --out out/procad_v1 --workers 12 --preview
# vorhandene Meshes
.venv/bin/python -m sketchgen.generate --meshes 'objaverse/glb/*.glb' --views 3 --out out/obja_pilot --preview
# Objaverse 1.0 im Durchlauf (laden -> erzeugen -> GLB löschen), fortsetzbar
.venv/bin/python -m sketchgen.objaverse_stream --out out/objaverse_v1 --target 20000 --views 3
```

Abhängigkeiten (in `lab/.venv`): moderngl, manifold3d, pycairo, trimesh, scikit-image, scipy, pillow, objaverse.

## Leistung (Laptop, Ryzen 7 7730U, 12 Worker, iGPU)

- procad: ~17 Skizzen/s → 60k Skizzen in ~1 h
- Objaverse: ~4 Skizzen/s (Meshes größer), plus Download; ~13 % der Ansichten als „clutter“ verworfen
- Speicher: ~150–200 kB pro Probe inkl. Striche-JSON → 1 Mio. Proben ≈ 150–200 GB

## Lizenzen

- **Objaverse**: Lizenz pro Objekt. Standardfilter cc0, by, by-sa (keine NC-Lizenzen); Urheber/Link stehen in `attribution.jsonl` (CC-BY verlangt Namensnennung). Fotogrammetrie/Scans und animierte Modelle werden über Metadaten herausgefiltert.
- **CAD2Sketch-Datensatz** (`../ext/cad2sketch/`): EULA erlaubt nur interne Forschung, nicht kommerziell, keine Weitergabe → nur als Stilreferenz und Testset, nicht in ein Produkt einbauen.
- **DifferSketching**: laut Projektseite nur nicht-kommerzielle Forschung.

## Bekannte Grenzen / Nächste Schritte

- Keine Schraffur/Schattierung, keine Farbe.
- Konstruktionslinien bei Meshes nur geschätzt (keine Historie); keine Auswahl-Optimierung wie bei CAD2Sketch (Gurobi), stattdessen Zufallsauswahl nach Zeichner-Dichte.
- Strichstil von Hand modelliert. Kalibrierung gegen echte Striche: CAD2Sketch-SVGs (Druck pro Punkt, Deckkraft) und DifferSketching (Novizen/Profis, vortrainierte Störmodelle) – siehe HANDOVER.
- Objaverse enthält auch Szenen/flache Objekte; ggf. zusätzlicher Qualitätsfilter.
