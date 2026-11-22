# Prompt-Bearbeitung in der Hauptapp: Probleme und Aufgaben

Übergabedokument für den nächsten Agent. Stand: 21.11.2026, Branch `prompt-editor`.
Alle Pfade sind relativ zum Repo-Root `SketchTo3D/`. Zeilennummern gelten für den Stand dieses Dokuments.

## 1. Worum es geht

Die Hauptapp (`app/`, Canvas unter `/`) kann ein 3D-Modell auswählen und per Prompt ändern („mach die Räder weiß“).
Das Backend ist `prompt-editor/` (FastAPI, OpenAI Responses API). Ablauf einer Änderung:

1. Canvas exportiert das Modell als GLB (`engine.exportModel`, `viewer.exportParts`).
2. `POST /api/edit-glb` (`prompt-editor/app/server.py:257`) legt eine Einmal-Sitzung an, ruft `planner.plan` auf und führt die Werkzeug-Aufrufe aus (`apply_calls`, `server.py:104`).
3. Das Ergebnis-GLB ersetzt das Modell im Canvas (`engine.replaceModel`, `app/src/engine.ts:966`).

Start: `cd app && bun run prompt-server` (Backend, Port 8000) und `bun run dev` (Vite, Proxy `/prompt-api`). Python-Umgebung: `prompt-editor/.venv`.

## 2. Befunde aus den Logs (21.11.2026, 11:41 bis 12:04)

Quellen: `prompt-editor/data/<sitzung>/history.json` und das Uvicorn-Log. Testmodell war der Khronos-„Cesium Milk Truck“
(vier Teile: `Cesium_Milk_Truck`, `_1` Karosserie mit Textur, `_2`, `_3`, dazu `Node__1`, `Node001__1`).

| Prompt des Nutzers | Was das System getan hat | Ergebnis |
|---|---|---|
| „mach daraus ein echtes Modell eines Oldtimers“ | `baue`: 21 Boxen (Kühlermaske, Lamellen, Stoßstange …) auf den Lkw gesetzt | Unsinn, kein Mehrwert, hätte nachfragen oder ablehnen müssen |
| „remove the logo, make it pure white“ | `lackiere` auf `Cesium_Milk_Truck_3`, Farbe weiß | falsches Teil, Logo bleibt, Teile ohne Bezug geändert |
| „just remove this logo, make the whole thing white“ | `faerbe *` auf alle 5 Teile | Räder und Scheiben mitgefärbt, Logo-Textur komplett verloren |
| „Kommentar 2: make the windows black again“ | keine Änderung, keine neue Version | Frage oder Fehler, im Log nicht nachvollziehbar |
| „Kommentar 3/4: remove this logo (on the side and on the top)“ | `lackiere` flach cremeweiß auf `Cesium_Milk_Truck_1` | gesamte Karosserie-Textur (Fenster, Details) ersetzt |
| „Kommentar 5: make the van light sky blue“ | `faerbe` hellblau auf `Cesium_Milk_Truck_1` | gesamte Karosserie flach hellblau, Fenster weg |
| „make it 10 centimeter long then match the other sizes“ (2x) | keine Änderung, keine neue Version | es gibt kein Werkzeug für absolute Maße |

Der Server-Log enthält nur HTTP-Zeilen. Rückfragen, `ki_text`, Fehler und Token-Verbrauch werden nirgends gespeichert,
sobald eine Anfrage keine neue Version erzeugt (`server.py:242` schreibt Verlauf nur bei Änderung).

## 3. Probleme (mit Ursache)

**P1. Die KI sieht das Modell nicht.** Der Planer bekommt nur eine Tabelle (Name, Mitte, Maße, Farbe) plus Text
(`planner.py`, `build_request`). Teilnamen wie `Cesium_Milk_Truck_3` oder `Node__1` sagen nichts. Die KI kann „Logo“,
„Fenster“, „Dach“ nicht zuordnen und rät oder fragt sinnlos nach. Das ist die Hauptursache für dumme Rückfragen und falsche Ziele.

**P2. Rückfragen sind nur Freitext und nur ein Toast.** `frage_nach` hat genau ein Feld `frage` (`tools.py:69`).
Das Frontend zeigt es als Toast (`app/src/App.tsx`, `report`, Zeile 258). Es gibt keine Antwortmöglichkeiten, keinen Verlauf
und keine Fortsetzung: Wer antwortet, schickt einen neuen Prompt ohne Kontext. Die Rückfrage-Texte der Mock-Regeln
(`planner.py:197, 211`) sind generisch („Was genau soll sich ändern: Farbe, Größe, Position oder Form?“).

**P3. Farbe ersetzt die Textur.** `faerbe` und `lackiere` mit `rgb` rufen `model_io.set_color` auf
(`prompt-editor/app/model_io.py:40`, `surfaces.py:131`). Das ersetzt das Material durch eine einfarbige Fläche und löscht die
Textur des Teils. Bei texturierten Modellen (Fenster, Logo, Details als Bild) geht damit alles verloren.
Eine Änderung nur eines Bereichs (Logo, Scheiben) ist nicht möglich, es gibt nur ganze Teile als Ziel.

**P4. Keine echten Größen.** `skaliere` kennt nur Faktoren (`tools.py`, `skaliere`). Beim Laden normiert der Canvas jedes Modell
auf 3,5 Einheiten (`app/src/viewer.ts:153`), das Backend sieht also nie echte Meter. „10 cm lang“ hat keine Bedeutung.
Es fehlen Einheit, Referenzgröße pro Modell und ein Werkzeug für absolute oder angeglichene Maße.

**P5. Von-Grund-auf-Erzeugen ist unbrauchbar.** `POST /api/create` baut Modelle aus Boxen und Zylindern
(`server.py:270`, `planner.plan_new`, `tools.CREATE_*`). Das Ergebnis ist grob (z. B. 33 Boxen für einen Oldtimer) und taugt nicht
für Filmqualität. Der Nutzer will die Funktion nicht.

**P6. Kommentar-Pins verlieren ihr Modell.** `replaceModel` legt ein neues Element mit neuer ID an. Pins verweisen über `elId`
auf die alte ID (`engine.ts:371`, `anchorPos` gibt `null` zurück). Nach der ersten Änderung verschwinden die Pins des Modells.
Außerdem geht die Pin-Position (u, v im 2D-Bild) beim Senden verloren: es geht nur der Kommentartext mit („Kommentar 3: remove this logo“),
die KI weiß nicht, wo am Modell der Pin saß.

**P7. Unklare Ziele werden geraten statt abgefragt.** „make the whole thing white“ färbt auch Räder und Glas; „mach daraus ein echtes Modell“
baut 21 Teile. Es gibt keine Regel, wann gehandelt und wann gefragt wird, und keine Schutzgrenze für große Umbauten.

**P8. Teilnamen sind bedeutungslos.** Nach dem Import heißen Teile `teil_01`, `Node__1` usw. Die README nennt „Benennung unbenannter Teile per Bild-KI“
als offen. Ohne sprechende Namen und Gruppen (Karosserie, Glas, Räder, Innenraum) sind Aufträge wie „alles außer den Rädern“ nicht sauber ausführbar.

**P9. Sicherheit.** `vite --host` macht den Dev-Server im LAN erreichbar, und der Proxy `/prompt-api` reicht Anfragen an das Backend
mit dem OpenAI-Schlüssel durch. Jeder im selben Netz kann Aufträge auslösen (Kosten). Dazu fehlen Größenlimits auf Bildern/GLB pro Anfrage im Frontend und ein Ratenlimit.

**P10. Uploads.** Im Canvas geht nur GLB (und eingebettetes glTF) per Drag & Drop (`engine.ts`, `onDrop`). Es gibt keinen Datei-Dialog,
und OBJ/USD/FBX werden nicht angenommen, obwohl das Backend OBJ und USD kann.

**P11. Qualitätsgrenze des Verfahrens.** Auch mit allen Fixes bleibt es eine Bearbeitung vorhandener Geometrie. Für detailreiche Autos wie auf dem Referenzfoto
braucht es einen Bild-zu-3D-Generator (TRELLIS.2, Cloud-APIs). Der Platz dafür ist `art == "organisch"` in `apply_calls` (`server.py`), noch nicht angebunden.
Siehe `docs/` und README-Abschnitt zu Generatoren; Lizenzen vor Nutzung selbst prüfen.

## 4. Aufgaben (nach Priorität)

### A. Von-Grund-auf-Erzeugen entfernen (klein, zuerst)

- Backend: Endpunkt `/api/create`, `planner.plan_new`, `build_create_request`, `mock_create_plan`, `tools.CREATE_TOOL_SCHEMAS`, `CREATE_SYSTEM_PROMPT`,
  `geometry.UNIT_FRAME`, `normalize_new`, den `frame`-Parameter von `add_parts` und `apply_calls`, `OPENAI_CREATE_EFFORT` (`.env.example`, README).
  `baue` bleibt für Umbauten an vorhandenen Modellen.
- Tests in `prompt-editor/tests/test_app.py` anpassen (alles unter „Hauptapp: Erstellen“ außer den `edit-glb`-Tests und dem Aufräum-Test).
- Frontend: Knopf „Modell per Prompt erstellen“ und Modus „Neues Modell“ (`App.tsx`: `promptOpen`, `modeOverride`, `mode`, `createModel`, `addGeneratedModel`;
  `PromptBar.tsx`: Modus-Chip, `/neu`, `MODE_LABEL`, `autoFocus`), `engine.addGeneratedModel`, `lib/prompt.ts: createModel`.
  Die Prompt-Leiste erscheint nur noch, wenn ein 3D-Modell ausgewählt ist. Ohne Modell zeigt ein Hinweis „Wähle ein Modell oder zieh eine GLB-Datei in den Canvas“.
- README-Abschnitt „In der Hauptapp“ entsprechend kürzen.

### B. Vollständiges Anfrage-Log

- Pro Anfrage eine JSON-Zeile in `prompt-editor/data/log/anfragen.jsonl`: Zeit, Sitzung, Auftrag, Auswahl, Modellname, Modus (mock/openai), Planer-Aufrufe (Werkzeug, Argumente),
  Rückfragen, `ki_text`, Fehler, Token (`input/output/cached`), Dauer, ob eine neue Version entstand.
- Auch Anfragen ohne neue Version protokollieren. Schlüssel und Bilddaten nicht loggen (nur Größe).
- Optional `GET /api/log?limit=50` nur auf localhost.

### C. Rückfragen als Chat-Sprechblasen mit Antwortvorgaben

Ziel: Der Agent fragt nur, wenn nötig, kurz und mit Auswahlmöglichkeiten. Die Rückfrage erscheint **über der Prompt-Leiste** als Sprechblase des Agents **auf der rechten Seite**
(Nutzer-Antworten links). Alternative, die der Nutzer genannt hat: die Prompt-Leiste wandert in einen Chat nach links. Die Sprechblasen-Variante ist die bevorzugte.

Backend:
- `frage_nach` wird strukturiert (Strict-Schema), z. B.:
  `frage` (kurz, Nutzersprache), `typ` ∈ `auswahl`, `text`, `teil`, `modell`, `farbe`, `zahl`, `ja_nein`,
  `optionen` (Liste aus `{id, label, beschreibung?, teile?}`), `standard` (optional, vorausgewählt), `einheit` (bei `zahl`),
  `mehrfach` (bool, bei `teil`).
- Antworttypen: Auswahl-Chips mit Text, Freitext, **ein oder mehrere Teile im Modell anklicken** (Teile im Canvas hervorheben),
  **ein anderes Modell im Canvas auswählen** (z. B. als Größenreferenz), Farbfelder (mit freier Farbe), Zahlenfeld mit Einheit, Ja/Nein.
- Fortsetzung: Anfrage trägt einen `verlauf` (Liste aus Auftrag, Rückfrage, Antwort). Der Planer bekommt ihn als Kontext
  („Bisherige Klärung: …“). Beantwortet der Nutzer, läuft die ursprüngliche Anfrage mit der Antwort weiter, ohne neuen Upload des Modells,
  wenn die Sitzung noch lebt (Einmal-Sitzung länger halten oder Zustand im Frontend halten).
- Regeln im System-Prompt: höchstens eine Rückfrage pro Runde; erst handeln, wenn eine vernünftige Annahme möglich ist; nur fragen, wenn eine falsche Annahme
  teuer oder zerstörerisch wäre (Löschen, großer Umbau, Mehrdeutigkeit zwischen Teilen). Immer in der Sprache des Nutzers antworten (er schreibt Deutsch und Englisch).
- Statt Freitext-Mock-Fragen sinnvolle Standardfragen mit Optionen.

Frontend:
- Chat-Verlauf pro Modell, über der Prompt-Leiste, Animation mit Feder-Einblendung wie die bestehende Leiste (`rise-in`, `pop-in` in `app/src/index.css`).
- Agent-Blase rechts mit Frage und darunter die Antwort-Chips. Antwort des Nutzers erscheint links als Blase, danach läuft die Anfrage weiter.
- Bei Typ `teil`/`modell`: Auswahlmodus im Canvas aktivieren („Klick das Fenster an“), Teile hervorheben, Bestätigen-Knopf.
- Während die KI arbeitet, zeigt die Leiste den Ladezustand (vorhanden). Der Verlauf bleibt sichtbar, bis der Nutzer ihn schließt.
- Tastatur: Pfeile/Enter für Optionen, Esc bricht ab.

### D. Echte Größen und Größenangleichung

- Pro Modell speichern: `masse_m` (echte Länge/Breite/Höhe in Metern oder ein Skalierfaktor auf Meter) im `ModelEl` und im Sync-Record (`app/src/sync/CanvasSync.ts`).
  Beim ersten Mal aus der GLB (Einheit Meter nach glTF-Standard) ableiten, bei Bedarf per Rückfrage („Wie lang ist das Modell in echt?“).
- Der Canvas exportiert Modelle in echten Metern, nicht auf 3,5 normiert. Die Anzeige-Normierung bleibt eine reine Darstellung (`viewer.ts:153`).
- Neue Werkzeuge: `setze_groesse` (Ziel Teil oder Modell, Achse `laenge|breite|hoehe|alle`, Wert, Einheit mm/cm/m, `proportional` ja/nein, Anker)
  und `gleiche_an` (Teil/Modell an Maß eines Referenzmodells oder -teils angleichen, Achse wählbar). Das Frontend schickt Maße aller Modelle auf dem Canvas
  als Tabelle mit (nur Namen und Maße, keine Geometrie), damit „match the other sizes“ funktioniert.
- „make it 10 cm long then match the other sizes“ heißt: Länge auf 0,10 m, Breite/Höhe proportional, danach an die anderen Modelle auf dem Canvas angleichen.
  Unklare Teile fragt der Agent per Rückfrage (Typ `modell`) ab.
- Maßanzeige im Canvas (z. B. „10 cm“ am ausgewählten Modell), Eingabefeld für Maße im ElementBar.
- Tests: Modell wird exakt auf gewünschte Länge gebracht (Toleranz 1e-6), Proportionen bleiben, Anker `boden` hält die Unterkante.

### E. Der KI das Modell zeigen (größte Qualitätswirkung für P1, P7, P8)

- Frontend rendert 3 bis 4 Ansichten (vorne, seitlich, oben, schräg) des Modells und eine Ansicht, in der jedes Teil eine eigene Farbe und eine Nummer/Beschriftung trägt
  („Set-of-Marks“). Beides geht als Bild an den Planer (`input_image`, `detail` nach Bedarf). Die Teiletabelle erhält die Zuordnung Nummer, Name, Farbe.
- Teile vom Bildmodell benennen lassen („Karosserie“, „Frontscheibe“, „Rad vorne links“) und die Namen im GLB speichern, damit Folgeaufträge stabil sind (P8).
- Gruppen einführen: `karosserie`, `glas`, `raeder`, `innenraum`, `chrom`. Aufträge wie „alles außer den Rädern“ laufen dann über Gruppen.
- Kosten im Auge behalten: Bilder nur beim ersten Auftrag pro Modellversion oder bei Bedarf senden; Ergebnis cachen.

### F. Texturerhaltende und bereichsgenaue Änderungen (P3)

- `faerbe` bekommt einen Modus `tönen` (Grundfarbfaktor multiplizieren, Textur bleibt) neben `ersetzen`. Standard: tönen bei texturierten Teilen, wenn der Auftrag nicht „alles einfarbig“ sagt.
- Bereichswerkzeug `faerbe_bereich`: Ziel ist ein Bereich einer Textur oder einer Fläche (Logo, Scheiben). Bereiche entstehen aus UV-Inseln, Materialien und einer
  Segmentierung (Kanten-Segmentierung existiert in `prompt-editor/app/segmentation.py`; für Texturbereiche z. B. Masken aus der Bild-KI oder SAM auf gerenderten Ansichten, zurück auf UV projiziert).
- Alternative für „Logo entfernen“: Textur-Inpainting im Bereich des Logos (Maske plus Hintergrundfarbe aus der Umgebung).
- Zielwirkung: „make the windows black“ ändert nur die Scheiben, „remove the logo“ nur das Logo, der Rest der Textur bleibt unverändert.

### G. Kommentar-Pins mit 3D-Ort

- Pin-Position (u, v im Elementrahmen) per Raycast im Modell auflösen: getroffenes Teil, UV-Koordinate und Weltpunkt (Viewer hat `pick`).
  Beim Senden als strukturierte Angabe mitschicken („Pin 3: Teil `Cesium_Milk_Truck_1`, UV 0.42/0.31, Fläche links“). Der Planer nutzt sie als Ziel.
- Pins mit dem Modell verknüpfen und nach einer Änderung behalten (P6, siehe H). Gesendete Pins als „erledigt“ markieren, Rücknahme bei Undo.

### H. Modell-ID bei Änderungen erhalten

- `engine.replaceModel` ersetzt heute das Element durch ein neues mit neuer ID. Stattdessen dasselbe Element behalten und nur `ms` und `src` austauschen,
  mit Undo/Redo über eine Operation und mit Sync (neuer Blob-Hash, `CanvasSync.apply3d` muss bei geändertem `src` die Szene neu laden).
- Dann behalten Pins, Auswahl und Kommentare ihre Bezüge (P6).

### I. Sicherheit und Robustheit

- Dev-Server nur lokal (`vite --host` weglassen oder `/prompt-api` nur für Loopback/mit Token erlauben), Backend auf `127.0.0.1` binden.
- Ratenlimit und maximale Bild-/GLB-Größe pro Anfrage, auch im Frontend prüfen; `OPENAI_API_KEY` bleibt nur in `prompt-editor/.env`.
- Tests: Anfragen mit zu großer Datei, ungültigem Format, abgebrochener Verbindung.

### J. Uploads

- Datei-Dialog „3D-Datei hochladen“ im Canvas (Toolbar). Das Frontend nimmt GLB/GLTF direkt, OBJ/USD/USDA/USDC über das Backend (`model_io.load_model`) und bekommt ein GLB zurück.
- Fehlerhinweis bei `.gltf` mit externen Dateien („Bitte als GLB exportieren“).

### K. Generator für echte Qualität (später, eigene Entscheidung)

- Nutzer will für Autos Filmqualität. Anbindung eines Bild-zu-3D-Generators am Platz `art == "organisch"`; Kette: Referenzbild → Generator → Segmentierung → Prompt-Änderungen.
- Offene Entscheidung: eigene GPU (z. B. TRELLIS.2, braucht viel VRAM) oder Cloud-API. Lizenzen und Filmnutzung prüfen, bevor etwas gebaut wird.

## 5. Abnahme (Beispiele, die funktionieren müssen)

1. „make the windows black“ auf dem Milk Truck: nur die Scheiben werden schwarz, Karosserie-Textur bleibt.
2. „remove the logo“ nach Klick auf einen Kommentar-Pin am Logo: nur das Logo verschwindet.
3. „mach alles weiß“: Agent fragt per Sprechblase „Auch Räder und Scheiben?“ mit Chips `Alles`, `Nur Karosserie`, `Ohne Räder und Glas`.
4. „mach ihn 10 cm lang und gleich die anderen Größen an“: Modell ist danach exakt 0,100 m lang, proportional skaliert; die Frage nach dem Referenzmodell erscheint nur, wenn mehrere Modelle auf dem Canvas liegen.
5. „mach daraus einen Oldtimer“ auf einem Lkw: kein 21-Boxen-Umbau, sondern eine kurze Rückfrage oder eine freundliche Ablehnung mit Hinweis.
6. Pins eines Modells bleiben nach jeder Änderung an derselben Stelle sichtbar.
7. Jede Anfrage, auch ohne Ergebnis, steht in `prompt-editor/data/log/anfragen.jsonl`.
8. Der Von-Grund-auf-Modus ist im Frontend und Backend weg, die Tests laufen (`cd prompt-editor && .venv/bin/python -m pytest -q tests`), `cd app && node_modules/.bin/tsc --noEmit -p .` ist sauber.

## 6. Hinweise für die Umsetzung

- Dokumentation und UI-Texte auf Deutsch (siehe `CLAUDE.md`). Quellen nur mit geöffneten, verifizierten Links.
- Sub-Agents laufen laut `CLAUDE.md` immer als GPT-6-Luna-Agents über `delegate_task`.
- Testsitzungen im Canvas immer mit eigenem Raum (`?room=...`), sonst landen sie im echten Canvas auf dem Sync-Server.
- Das Testmodell liegt unter `prompt-editor/data/testmodelle/cesium-milk-truck/` (CC BY 4.0, © 2017 Cesium; Quelle in `QUELLE.txt`).
- Reihenfolge-Vorschlag: A, B, H (Basis), dann C und E (Rückfragen und Sicht), danach D, F, G, zuletzt I, J, K.

## 7. Umsetzungsstand (21.11.2026)

Umgesetzt auf Branch `prompt-editor` (noch nicht committet). Tests: `pytest` 37 grün (1 übersprungen), `tsc --noEmit` sauber,
`vite build` erfolgreich. Im Browser mit Mock-KI geprüft (eigener Raum, eigener Sync- und Datenordner).

| Aufgabe | Stand |
|---|---|
| A Von-Grund-auf entfernen | erledigt: `/api/create`, `plan_new`, Create-Schemas, `UNIT_FRAME`, `normalize_new`, Modus-Chip, `/neu`, Knopf entfernt; Leiste nur mit ausgewähltem Modell |
| B Anfrage-Log | erledigt: `data/log/anfragen.jsonl`, auch ohne neue Version und bei Fehlern; `GET /api/log` nur lokal |
| C Rückfragen als Chat | erledigt: strukturierte `frage_nach`, `AgentChat.tsx` (Agent rechts, Nutzer links), alle Antworttypen, Fortsetzung per `/api/<sitzung>/edit` mit `verlauf` ohne neuen Upload, Rückfrage blockiert andere Werkzeuge |
| D Echte Größen | erledigt: Export in Metern, `setze_groesse`, `gleiche_an`, Maße aller Modelle gehen mit, Maßanzeige und Eingabe in der Elementleiste (lokal, synchronisiert, Undo) |
| E Modell zeigen | erledigt: 4 Ansichten + 2 Set-of-Marks-Bilder, Nummern in der Teiletabelle, Texturpaletten, `benenne` mit Gruppen. Ergebnis-Cache je Modellversion noch offen (Bilder gehen bei jedem Auftrag mit, `detail=low`) |
| F Texturerhaltend | erledigt: `faerbe` mit `auto/toenen/ersetzen`, `faerbe_bereich` (Farbe + Bildbereich + UV-Maske, Logo entfernen mit Umgebungsfarbe). SAM/Inpainting nicht eingebaut |
| G Pins mit 3D-Ort | erledigt: Teil, UV und 3D-Punkt am Pin, Pin folgt dem Modell, Texturfarbe und Umkreisfarben an die KI. Rücknahme von „erledigt“ bei Undo offen |
| H Modell-ID erhalten | erledigt: `replaceModel` tauscht nur Szene und Quelle, Undo/Redo und Sync (`swapModel`) |
| I Sicherheit | erledigt: Backend auf 127.0.0.1, `/prompt-api` nur Loopback (Freigabe `PROMPT_ALLOW`), Ratenlimit, Größenprüfung im Frontend |
| J Uploads | erledigt: Knopf „3D-Datei hochladen“, OBJ/USD über `/api/convert`, Hinweis bei glTF mit externen Dateien |
| K Generator | offen (eigene Entscheidung zu GPU/Cloud und Lizenzen) |

Abnahme 1, 2 und 5 hängen im echten Betrieb von der KI ab (Mock-Regeln decken 3, 4, 5 ab); mit echtem Schlüssel noch nicht geprüft.
