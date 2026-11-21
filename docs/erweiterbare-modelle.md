# Erweiterbare Modelle: Skizze ergänzen, nur das Neue erzeugen

Stand 2026-11-21. Umgesetzt in der Testseite `app/trellis.html` (+ `app/src/trellis-lab.ts`) und im lokalen Backend
`lab/trellis_lab/server_local.py` + `lab/trellis_lab/parts_geo.py` (läuft auf dem Heim-PC, Unit `sketch3d`, Port 8790).

Kennzeichnung: **[geprüft]** = lokal ausgeführt/gemessen, **[Annahme]** = nicht geprüft.

## Idee

Ein Ergebnis ist kein einzelnes Mesh, sondern ein **Projekt aus Teilen**. Jedes Teil kennt seine Striche, seine
2D-Maske im Bild und sein eigenes 3D-Stück (eigene GLB-Datei, eigener Knoten im Viewer). Neue Striche werden einem
Teil zugeordnet, und **nur dieses Teil** wird erzeugt oder geändert. Alle anderen Teile bleiben Byte für Byte gleich;
das wird per SHA-256-Prüfsumme je Teil nachgewiesen.

## Ablauf

1. Skizze → Bild → erstes 3D-Modell: Das wird Teil `p0` „Körper“ (`/img2three`). Das Projekt hat Version 0.
2. Weiterzeichnen: Striche bekommen die Version `Projektversion + 1` und leuchten orange. Nach jedem Strich ordnet
   `/plan` sie zu (ohne GPU, Millisekunden):
   | neue Striche liegen … | Aktion |
   |---|---|
   | zu ≥ 60 % in einem Teil, nur farbig | **Nur Farbe**: Vertexfarben der Vorderseite im Bereich umfärben |
   | zu ≥ 60 % in einem Teil, mit Linien | **Teil ersetzen**: nur dieses Teil neu |
   | sonst | **Neues Teil**, angedockt an das berührte (sonst nächste) Teil |
   Die Seite zeigt das Ergebnis an und färbt das betroffene Teil in der Skizze ein; Aktion, Zielteil und Methode
   lassen sich überschreiben.
3. `/edit` wendet an:
   - **Schnell** (Standard bei dünnen Teilen wie Schwanz, Horn, Bein; ohne KI): Strichfläche (inkl. umschlossener
     Innenfläche) wird „aufgeblasen“ (Querschnitt kreisförmig über die Distanz zum Rand, Marching Cubes), Farbe aus
     den Strichen oder vom Elternteil am Kontakt. [geprüft: 0,2 s]
   - **KI**: Inpainting (SD 1.5 Inpainting + Scribble-ControlNet) **nur in der Maske** der neuen Striche; außerhalb
     wird jedes Pixel aus dem alten Bild zurückkopiert. Dann TripoSR nur auf dem ausgeschnittenen Teil (dünne Teile:
     aufblasen mit Bildfarben). [geprüft: ~13 s für einen Flügel auf der RTX 2070]
4. Platzierung ohne Neuberechnung: Alle Teile liegen in einem gemeinsamen Koordinatensystem, das an den Bildpixeln
   hängt (Kamera der Skizze auf +X, `Z = -(u-256)/256`, `Y = -(v-256)/256`). Ein Teil wird so skaliert/verschoben,
   dass seine Projektion seine 2D-Maske trifft; die Tiefe kommt aus dem Median der Elternpunkte im Kontaktbereich.
   TripoSR-Konvention empirisch bestimmt: Rohmesh mit Kamera auf +x, Bild-u ∝ +y, Bild-v ∝ −z (Silhouetten-IoU 0,89).
   [geprüft]
5. Versionen: `project_v{n}.json` je Version, `cur_v{n}.png` (aktuelles Bild), Teile als `parts/p{k}_v{n}.glb`
   (neue Datei je Änderung, alte bleiben liegen). „Änderung zurück“ (`/undo`) stellt die Vorversion her, „löschen“
   (`/part_delete`) entfernt ein Teil (Kinder hängen dann am Großelternteil).

## Test (2026-11-21) [geprüft]

Orange Katze → Schwanz (schnell, 0,2 s, 723 Kontaktpunkte) → Flügel (KI, 13,5 s). Nach beiden Schritten:
`p0` und `p1` „unverändert ✓“ (Prüfsumme gleich), Vorderansicht deckt sich mit dem 2D-Bild.

## Grenzen / nächste Schritte

- Tiefe ist aus einer Ansicht geraten; Teile in der Bildebene (Flügel) werden eher flach. Nächster Schritt:
  über einer gedrehten 3D-Ansicht weiterzeichnen (gleiche Projektion, andere Kamera). [Annahme: machbar mit derselben
  Platzierung]
- Das erste Modell ist ein einziges Teil; „Teil ersetzen“ am Körper erzeugt den ganzen Körper neu (Anbauten bleiben).
  Nachträgliches Zerlegen (Kopf, Beine …) wäre ein eigener Schritt (vgl. Segmentierung im Prompt-Editor).
- Teile werden nicht verschmolzen (eigene Knoten); für den Export wäre eine Vereinigung nötig.
- Rückseiten-Farben von TripoSR sind geraten (oft grau/weiß).

## Update 2026-11-21: Segmente von Anfang an [geprüft]

Ersetzt den Ablauf oben. Nach dem ersten 3D-Modell zerlegt SAM (`facebook/sam-vit-base`, Apache-2.0, automatisches
Punktgitter) das Bild in Segmente; kleinere Masken überschreiben größere (Flosse über Rumpf), Rest = „Rumpf“ (`p0`).
Das 3D-Modell wird nach Projektion der Flächenmitten in dieselben Segmente geschnitten (eigene GLB je Segment).
Neue Striche werden je räumlicher Gruppe einem Segment zugeordnet (`classify`):

| Striche | Modus | Was passiert |
|---|---|---|
| ≥ 90 % innerhalb des Umrisses | Oberfläche | Inpainting nur auf den Strichen (Stärke 0,55, Strichfarben scharf vorgegeben), Vertexfarben des Segments aus dem neuen Bild, Form bleibt |
| auf einem Segment, ragen heraus | Segment ersetzen | Inpainting nur im Segment (+ Striche), Prompt nur für das Teil, Verbot „ganzes/zweites Tier“, neues Mesh in alter Tiefe ersetzt das Segment |
| auf dem Rumpf, ragen heraus | gemischt | Rumpf nie komplett neu: innen Oberfläche, außen neues Teil |
| überwiegend außerhalb | neues Teil | Inpainting nur im Strichbereich, Teil an Kontakt angesetzt |

Test Goldfisch (rote Striche quer über den Rumpf, unten heraus): 5 Segmente; Rumpf bekommt roten Streifen (nur Farbe),
unten entsteht eine rote Flosse als neues Teil, die 4 Flossen-Segmente bleiben unverändert (Prüfsumme), 24 s.
Automatische Benennung per CLIP war unzuverlässig (Schweif → „Horn“) und ist entfernt; Segmente lassen sich umbenennen,
der Name geht in den Prompt. Grenze: 3D-Schnitt per Projektion trennt hintereinanderliegende Teile nicht.

## KI-Studio (Canvas-Integration, 2026-11-21)

Das Lab ist als **KI-Studio** in die Canvas-App eingebaut (Toolbar-Knopf mit Zauberstab, Taste `K`, oder direkt `studio.html`). Code: `app/src/studio/` (`Studio.tsx` Oberfläche, `pad.ts` Zeichenfläche, `view3d.ts` 3D-Ansicht, `api.ts` Backend-Aufrufe).

- **KI-Stift, Radierer, Auswahl** wie in der Canvas-App, Pinsel S/M/L/XL, Spiegeln (für Schmetterlinge standardmäßig an), Tierwahl (Schnellwahl + alle Klassen).
- **Linientreue**-Regler 0…1 → ControlNet-Stärke `0,1 + 0,8·t` und Wirkdauer `0,35 + 0,5·t` (0,5 = bisherige Lab-Werte).
- **Erstes Bild:** 2 Versionen zur Wahl; Klick auf eine Version baut das 3D-Modell. **Danach** wird nicht mehr gefragt: das Backend nimmt die automatisch erkannte Deutung (`/plan` → `/edit` mit `action=auto`).
- **Radierer** im Bild = Radierer im Modell (`/erase`: Geometrie unter dem Strich, ganze Tiefe); im 3D-Fenster radiert er von jeder Seite (`/erase3d`: Flächen in Kugeln um die Trefferpunkte).
- **Auswahl:** Klick = Segment, Ziehen = Lasso, Umschalt = mehrere, „feiner" = SAM-Zauberstab (`/segment_at`). Aktionen über `/region`: Farbe tauschen (ohne KI, < 1 s), Oberfläche per Prompt (Form bleibt; Farbwörter im Prompt werden vorab umgefärbt, weil SD-Inpainting sie sonst ignoriert), Ersetzen per Prompt (neues Teil), Löschen.
- **Ins Canvas:** `/export/{id}` fasst alle Teile zu einem GLB mit mattem Material zusammen (ohne Material wäre es in three.js voll metallisch und dunkel).
- Teilmasken werden jetzt versioniert (`parts/pX_mask_vN.png`), damit „Rückgängig" auch nach Radieren stimmt.

### Flug-Animation (Schmetterling)

Im 3D-Fenster des Studios gibt es bei Schmetterling/Falter den Knopf **„Fliegen“** (`app/src/studio/flight.ts`). Er macht aus den Teilen ein Skinned Mesh mit fünf Knochen: `body`, `wing_fore_L/R` und `wing_hind_L/R`. Die Rumpfbreite wird aus dem Dickenprofil quer zur Spannweite geschätzt, das Gelenk liegt an der Flügelwurzel. Der Übergang zwischen Vorder- und Hinterflügel ist weich gewichtet.

Der Clip `flap` (0,5 s, Schleife, ohne Vorwärtsbewegung) ist an Tagfaltern orientiert:
- Flügelschlag von +75° (oben fast Flügelschluss) bis −30°; der Abschlag dauert 45 % des Zyklus, der Aufschlag 55 %.
- Der Hinterflügel schlägt etwas später (5 % der Phase) und mit 88 % des Ausschlags.
- Die Flügel verdrehen sich: im Abschlag kippt die Vorderkante nach unten (Pronation), im Aufschlag nach oben (Supination).
- Der Körper hebt sich im Abschlag, senkt sich im Aufschlag und nickt um ±7°.

„Flug-GLB“ lädt das animierte GLB herunter, etwa für Blender oder eine Game-Engine. „Zeitlupe“ spielt mit 0,25-facher Geschwindigkeit. Das Schweben auf einer liegenden Acht gibt es nur in der Vorschau.

Grenzen: Der Rig setzt die Pipeline-Lage voraus (Draufsicht, Rücken = +X, Kopf = +Y, gespiegelt gezeichnet). „Ins Canvas“ bleibt statisch, weil der Canvas noch keine Animationen abspielt.

Ein vorhandenes Projekt lässt sich direkt öffnen: `studio.html?project=<id>`.

### Canvas und Studio getrennt (2026-11-21)

- **Canvas = Notizen.** Die Werkzeugleiste zeigt nur Hand, Auswahl und Stift. Alle anderen Werkzeuge (Formen, Pfeil, Linie, Text, Notiz, Kommentar, Radierer, Füllen, Bild, 3D-Datei) liegen im Untermenü ▾; links daneben steht immer das zuletzt benutzte. Der Magic Pen ist aus dem Canvas entfernt.
- **KI-Studio = Zeichnen und 3D.** Es gibt einen Knopf dafür (oder Taste `K`). Im Studio gibt es jetzt auch Linie, Rechteck und Ellipse (`L`, `R`, `O`, Umschalt = Quadrat/Kreis). Formen werden wie Striche ans Backend geschickt und beim Spiegeln mitgespiegelt.
- **Zurück ins Studio.** Ein Modell aus dem Studio merkt sich sein Projekt (`ModelEl.studio`, synchronisiert als `sp`). Anklicken → „Im Studio bearbeiten“ öffnet das Projekt wieder; „Ins Canvas“ ersetzt dann dasselbe Modell (Lage, Größe und Kommentare bleiben). Modelle, die vor dieser Änderung in den Canvas gelegt wurden, haben keine Verknüpfung.
- **3D-Modell im Canvas.** Ausgewählt zeigt der Rahmen vier Anfasser. Ziehen an einer Ecke ändert die Größe (Seitenverhältnis bleibt, Umschalt = frei). Ziehen auf leerem Hintergrund im Rahmen verschiebt das Modell, Ziehen auf dem Modell dreht es, ein Klick auf das Modell wählt ein Teil. Die Prozent-Größen im Menü sind entfallen.

### Englische Oberfläche, Live-Sync im Studio, ChatGPT-Bearbeitung (2026-11-21)

- **UI auf Englisch:** Canvas-App, KI-Studio („AI Studio“) und die Meldungen des Heim-PC-Servers (`lab/trellis_lab/server_local.py`). Neue Projekte nennen das Wurzelteil „Body“ statt „Rumpf“; alte Namen werden im Studio englisch angezeigt.
- **Engere Modell-Box im Canvas:** `viewer.tightFrame()` projiziert die Eckpunkte des Modells und setzt Kameraabstand und Seitenverhältnis der Box (längste Seite 300 px statt fest 380 × 285).
- **Live-Sync im Studio** (`app/src/studio/sync.ts`): gleiches Yjs-Dokument wie der Canvas (`canvas:<room>`). Geteilt werden Striche (Y.Map je Strich, gleichzeitiges Zeichnen geht nicht verloren), Tier, 2 Versionen, gewählte Version, Projekt + Version, „arbeitet gerade“, Hinweis und der KI-Chat; flüchtig (Awareness) der Strich in Arbeit und der Zeiger mit Namen.
- **Ask AI (ChatGPT):** Endpunkt `POST /api/studio/plan` im Prompt-Server (`prompt-editor/app/studio_agent.py`). Das Modell bekommt das Bild der Figur und dasselbe Bild mit nummerierten Teilen und antwortet mit Schritten (`palette | restyle | replace | delete`, Structured Outputs). Neue Operation `palette` in `/region`: mehrere Farben mit Anteilen („überwiegend Blau“ ≈ 70 %), Muster, Adern und Schattierung bleiben erhalten. Ohne `OPENAI_API_KEY` einfache Regeln (Testmodus). `python-dotenv` steht jetzt in `requirements.txt`, damit die `.env` geladen wird.
