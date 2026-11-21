# SketchToCAD – Prompt-Editor (Web-App)

Ein bestehendes 3D-Modell per Text (und optional Referenzbild) gezielt ändern, ohne es neu zu erzeugen.
Die KI (z. B. GPT-6.1 Sol über die OpenAI-API) plant nur Werkzeug-Aufrufe; Python führt sie aus.
Alles, was kein Aufruf anfasst, bleibt unverändert. Jede Änderung ist eine neue Version (Rückgängig möglich).

## Starten
```bash
pip install -r requirements.txt
cp .env.example .env            # Schlüssel eintragen – die .env wird beim Start automatisch geladen
uvicorn app.server:app --port 8000
# Browser: http://localhost:8000
```
Echte Umgebungsvariablen haben Vorrang vor der `.env`. Ohne `python-dotenv` bleibt der alte Weg
(`export $(grep -v '^#' .env | xargs)`). Ohne Schlüssel läuft die App im Testmodus (`LLM_MODE=mock`, einfache Regeln statt KI).

## In der Hauptapp (Canvas unter `/`)

Die Hauptapp (`app/`) nutzt dasselbe Backend und dieselbe `.env`: Modelle auf dem Canvas lassen sich per Prompt ändern.
Ein Erzeugen von Grund auf gibt es nicht mehr (die Ergebnisse aus Boxen und Zylindern waren zu grob).
```bash
cd app && bun run prompt-server   # startet dieses Backend auf 127.0.0.1:8000 (PROMPT_PORT ändert den Port)
cd app && bun run dev             # Vite leitet /prompt-api an das Backend weiter (PROMPT_URL für einen anderen Host)
# oder alles zusammen: bun run dev:all
```
- **Ändern:** 3D-Modell auswählen (optional ein Teil im Modell anklicken, es erscheint als Chip „Teil: …“), Auftrag eingeben.
  Die Prompt-Leiste erscheint nur, wenn ein 3D-Modell ausgewählt ist. Das Modell geht mit seinen aktuellen Teilen in
  **echten Metern** als GLB an `POST /api/edit-glb`; das Ergebnis ersetzt den Inhalt desselben Elements (gleiche ID, Lage,
  Größe und Kamera, Kommentar-Pins bleiben). Rückgängig im Canvas bringt die alte Version zurück, auch auf anderen Geräten.
- **Die KI sieht das Modell:** Der Canvas rendert vier Ansichten und zwei „Set-of-Marks“-Ansichten (jedes Teil eigenfarbig mit
  Nummer, die Nummer steht auch in der Teiletabelle). Texturierte Teile bekommen ihre Hauptfarben mit Anteil in die Tabelle.
  Bedeutungslose Teilnamen benennt die KI mit `benenne` in Gruppen um (`glas_frontscheibe`, `raeder_vorne_links`).
- **Rückfragen als Chat:** Fragt die KI nach, erscheint die Frage als Sprechblase rechts über der Prompt-Leiste, die Antwort des
  Nutzers links. Antworten gehen per Chips, Freitext, Teile im Modell anklicken, anderes Modell auf dem Canvas wählen, Farbe,
  Zahl mit Einheit oder Ja/Nein (Pfeiltasten und Enter, Esc bricht ab). Danach läuft der ursprüngliche Auftrag mit dem
  Klärungsverlauf weiter, ohne das Modell erneut hochzuladen (`POST /api/<sitzung>/edit` mit `verlauf`).
- **Kommentar-Pins:** Ein Pin auf einem Modell merkt sich Teil, Textur-UV und 3D-Punkt; er folgt dem Modell beim Drehen und
  bleibt nach Änderungen. Beim Senden bekommt die KI Teil, Bildposition, Texturfarbe am Pin und die Farben im Umkreis.
- **Echte Größen:** Die Elementleiste zeigt die Länge des Modells („4,87 m lang“) und setzt Länge, Breite oder Höhe
  proportional (Boden bleibt). Per Prompt: „mach ihn 10 cm lang“ (`setze_groesse`), „gleich die anderen Größen an“
  (`gleiche_an` mit den Maßen der anderen Modelle auf dem Canvas; bei mehreren fragt die KI, welches).
- **Hochladen:** Knopf „3D-Datei hochladen“ in der Werkzeugleiste oder Drag & Drop. GLB/glTF lädt der Browser direkt,
  OBJ/USD/USDA/USDC wandelt `POST /api/convert` in GLB um. glTF mit externen Dateien bitte als GLB exportieren.
- Die Modellauswahl in der Leiste kommt von `/api/config` (`OPENAI_MODEL` und die Modellliste).
- Jeder Auftrag legt eine Einmal-Sitzung in `data/` an (Marker `.adhoc`), die nach `ADHOC_TTL_MIN` Minuten (Standard 60) gelöscht wird.

### Anfrage-Log

Jede Anfrage steht als JSON-Zeile in `data/log/anfragen.jsonl`, auch ohne neue Version: Zeit, Sitzung, Auftrag, Auswahl,
Modellname, Modus, Werkzeugaufrufe, Rückfragen, `ki_text`, Fehler, Tokens, Dauer, Pins, Klärungsverlauf, Größen der Uploads.
Schlüssel und Bilddaten werden nicht gespeichert. Die letzten Einträge zeigt `GET /api/log?limit=50` (nur vom eigenen Rechner).

## Bedienung
1. Beim Öffnen erscheint das Testauto. Ein eigenes GLB/GLTF/OBJ/USD über „Modell laden“ auswählen oder in den Viewer ziehen (ein Modell aus einem Stück wird automatisch nach Verbundenheit zerlegt).
2. Optional ein Teil anklicken (wird an die KI als „ausgewählt“ übergeben).
3. Auftrag schreiben, optional Bild anhängen, Modell wählen (Sol 6.1/Sol 6.2/Astra/Terra), „Ändern“.
4. Rechts erscheinen Ergebnis, Werkzeugaufrufe, Rückfragen, Dauer und Tokenverbrauch. Versionen lassen sich ansehen und rückgängig machen.
5. GLB exportiert Geometrie und Texturen. Der USDA-Export enthält Geometrie und Grundfarben.

### Beispielaufträge

- „Mach die Felgen weiß.“
- „Mach den Wagen sportlicher: Dach niedriger, Frontschürze tiefer und einen Heckflügel drauf.“
- „Füge in der Kabine vier Reihen mit je zwei Sitzen ein.“ Danach: „Lass nur die vorderen zwei Sitze drin.“
- Karosserie anklicken und „Tiefblauer Hochglanzlack mit weißen Pfeilen und einem 27-Sticker auf der linken Seite.“
- Ein PNG anhängen und „Setz das angehängte Bild als Sticker mittig auf das Dach.“

Umbauten nutzen die Teile des geladenen Modells als Bezug. Sprechende Segmentnamen wie `kabine`, `karosserie` oder `sitz_1` helfen bei der Zuordnung. Im Mock-Modus lässt sich das Hinzufügen mit „Setz einen Heckflügel drauf“ ausprobieren.

## Planung und Latenz

Eindeutige Farbaufträge mit bekanntem Ziel laufen lokal. Andere Aufträge gehen über einen Planungsaufruf. Die Werkzeuge `baue` und `lackiere` führen dessen Ergebnis direkt lokal aus. `ersetze` mit CadQuery kann einen zusätzlichen KI-Aufruf auslösen. Die Oberfläche zählt beide Aufrufe und deren gemeldete Tokens.

Der Planer sendet eine kompakte Tabelle mit Teilname, Mittelpunkt, Ausmaß und RGB-Hexwert. Beim Testauto mit 13 Teilen spart die Tabelle rund 48 % der Tokens für den Teilekontext gegenüber der vorherigen JSON-Liste (lokal mit `o200k_base` gezählt). Der gesamte API-Verbrauch hängt auch von Werkzeugdefinitionen, Prompt, Bild und geplanter Änderung ab.

`POST https://api.openai.com/v1/responses` mit
- `model`: `gpt-6.2-sol` (Standard), `gpt-6.1-sol`, `gpt-6.2-astra` (stärkstes) oder `gpt-6.1-terra` (günstigstes), per `OPENAI_MODEL` oder Auswahl im UI;
  für den CAD-Code neuer Teile optional ein eigenes Modell per `OPENAI_CAD_MODEL` (z. B. `gpt-6.2-astra`)
- `instructions`: Regeln für Zielauswahl, Umbau, Koordinaten und Ausführungsreihenfolge
- `input`: Teiletabelle (mit Nummern und Texturfarben), Modellmaße, andere Modelle auf dem Canvas, Pins, bisherige Klärung,
  Auftrag, Auswahl, die Modellansichten (`OPENAI_VIEW_DETAIL`, Standard `low`) und optional ein Referenzbild
  (`OPENAI_IMAGE_DETAIL`, Standard `low`, für feinere Bilddetails `high`).
- `tools`: der Werkzeugkasten als Function-Schemas (`app/tools.py`)
- `reasoning.effort`: `low` (per `OPENAI_EFFORT` änderbar)

Antwort: `function_call`-Einträge → werden in `app/server.py:apply_calls` ausgeführt.

## Werkzeuge
| Werkzeug | Zweck |
|---|---|
| faerbe | Farbe ganzer Teile. `modus=auto` tönt texturierte Teile (Textur bleibt, Grundfarbfaktor wird gesetzt), `ersetzen` macht einfarbig |
| faerbe_bereich | Nur einen Bereich einer vorhandenen Textur umfärben oder entfernen: Texel nahe den Quellfarben, optional in einem Bildbereich, nur innerhalb der UV-Fläche des Teils. Schattierung bleibt. `ziel_rgb=null` entfernt z. B. ein Logo (Lücken und Umriss werden geschlossen, Füllung mit der Umgebungsfarbe) |
| setze_groesse | Echte Größe in mm/cm/m für Länge (längste waagerechte Achse), Breite, Höhe oder größte Ausdehnung; alle Treffer gemeinsam, proportional, Anker `boden`/`mitte` |
| gleiche_an | Größe an ein anderes Modell vom Canvas (Maße aus dem Frontend) oder an ein Teil angleichen |
| skaliere | getrennte Faktoren x/y/z je Teil, Anker `mitte`/`boden`/`basis` (Räder bleiben am Boden, Horn bleibt am Kopf) |
| verschiebe, drehe, loesche | Position (Meter), Rotation, Entfernen |
| benenne | Sprechende Teilnamen in Gruppen (`karosserie`, `glas`, `raeder`, `innenraum`, `chrom`, `licht`, `anbau`, `sonstiges`) |
| ersetze | neue Form: `art=technisch` → zweiter KI-Aufruf schreibt CadQuery-Code → Ausführung in Sandbox → einmal erzeugt, für die Gegenseite gespiegelt, passend eingesetzt. `art=organisch` → Platzhalter (eigenes Modell / Meshy / TRELLIS.2 anbinden) |
| baue | Einzelne einfache Anbauteile (Box, Keil, Kugel, Zylinder, Kegel, Profil, Kopie), relativ zum gewählten Teil oder Modell. Schutzgrenze: höchstens `MAX_NEUE_TEILE` (Standard 12) neue Teile pro Auftrag |
| lackiere | PBR-Lack mit Metallanteil und Rauheit, Streifen, Karos, Punkte oder ein eigenes Polygonmuster sowie Bild- oder Textsticker auf einer gewählten Seite (ersetzt die Textur) |
| klebe_logo | Logo, Aufkleber oder Schriftzug in die vorhandene Textur kleben, ohne sie zu ersetzen: am Kommentar-Pin (Texturposition), an einer Bildposition oder auf einer Hüllenseite, in echter Breite (Meter), aufrecht ausgerichtet. Quelle: Logo aus dem Netz (`marke`, optional `domain`), Bildanhang oder Text. Farbtönung des Teils wird vorher in die Textur gebacken, damit das Logo seine Farben behält; grobe Texturen werden dafür hochgerechnet (höchstens 4096 px) |
| frage_nach | Strukturierte Rückfrage: `frage`, `typ` (`auswahl`, `text`, `teil`, `modell`, `farbe`, `zahl`, `ja_nein`), `optionen` (`id`, `label`, `beschreibung`, `teile`), `standard`, `einheit`, `mehrfach`. Enthält ein Plan eine Rückfrage, wird nichts anderes ausgeführt |

Regeln im System-Prompt: handeln, wenn eine vernünftige Annahme möglich ist; höchstens eine Rückfrage, nur wenn eine falsche
Annahme zerstörerisch oder teuer wäre (Löschen, großer Umbau, mehrdeutige Ziele wie „alles weiß“); Stilwechsel wie
„mach einen Oldtimer daraus“ nicht mit vielen Vorlagen nachbauen; Antworten in der Sprache des Nutzers.

### Logos aus dem Netz

`klebe_logo` mit `quelle=web` sucht das Logo in dieser Reihenfolge (`app/logos.py`):

1. Dateisuche auf Wikimedia Commons über die MediaWiki-API ([commons.wikimedia.org/w/api.php](https://commons.wikimedia.org/w/api.php)). Dateien mit „logo“ und dem Markennamen im Titel gewinnen, SVGs kommen als PNG-Vorschau mit transparentem Hintergrund. Beispiel: [Logo of Red bull.svg](https://commons.wikimedia.org/wiki/File:Logo_of_Red_bull.svg), [Base44 logo.svg](https://commons.wikimedia.org/wiki/File:Base44_logo.svg).
2. Icons aus dem HTML-Kopf der Website (`domain`, z. B. `apple-touch-icon`).
3. Favicon-Dienst von Google (bis 256 px) als letzter Ausweg.

Abgerufen werden nur öffentliche https-Adressen (keine lokalen oder LAN-Adressen), höchstens 6 MB pro Datei. Treffer liegen danach in `data/logos/`. Einfarbige Bildränder (z. B. Weiß) werden freigestellt. Markenlogos sind geschützt: für eigene Entwürfe und Mockups gedacht, Nutzungsrechte vor Veröffentlichung selbst prüfen.

## Eigene HTTP-API (für Skripte oder das Skizzen-Tool)
```bash
curl -F "datei=@auto.glb" localhost:8000/api/upload                    # → {"session": "...", "teile": [...]}
curl -F "auftrag=Felgen weiß" -F "ausgewaehlt=" localhost:8000/api/<session>/edit
curl -F "auftrag=Horn wie auf dem Bild" -F "bild=@referenz.png" localhost:8000/api/<session>/edit
curl -F "datei=@auto.glb" -F "auftrag=Felgen weiß" localhost:8000/api/edit-glb   # Einmal-Änderung ohne Sitzung vorab
# Fortsetzung nach einer Rückfrage (Antwort im Verlauf, optional Maße anderer Modelle):
curl -F "auftrag=mach alles weiß" -F 'verlauf=[{"rolle":"agent","text":"Auch Räder und Scheiben?"},{"rolle":"nutzer","text":"Nur Karosserie","teile":"karosserie*"}]' localhost:8000/api/<session>/edit
curl -F "datei=@modell.obj" localhost:8000/api/convert -o modell.glb              # OBJ/USD → GLB
curl localhost:8000/api/log?limit=20                                             # Anfrage-Log (nur lokal)
curl -X POST localhost:8000/api/<session>/undo
curl -o modell.usda localhost:8000/api/<session>/export.usda
```

## Tests
```bash
python -m pytest -q tests      # HTTP- und Werkzeugtests laufen ohne Schlüssel
```

## Sicherheit
KI-geschriebener CAD-Code wird statisch geprüft (nur `cadquery`/`math`, keine Datei-/System-Zugriffe) und in einem
eigenen Prozess mit Zeitlimit ausgeführt (`app/cad_sandbox.py`). Für Produktion zusätzlich: Container ohne Netzwerk, Speicherlimit.
Den API-Schlüssel nur in `.env` bzw. Umgebungsvariablen, nie ins Repo.

- `bun run prompt-server` bindet das Backend an `127.0.0.1`. Der Vite-Dev-Server läuft mit `--host` (für das iPad im LAN);
  `/prompt-api` nimmt dort aber nur Anfragen vom eigenen Rechner an. Weitere Geräte freigeben:
  `PROMPT_ALLOW="192.168.1.23,100." bun run dev` (IP-Präfixe) oder `PROMPT_ALLOW="*"`.
- Ratenlimit pro Client: `RATE_LIMIT_PER_MIN` (Standard 30, 0 = aus). Größenlimits: Modell 200 MB, Bild 12 MB,
  höchstens 6 Ansichten; das Frontend prüft Modell- und Bildgröße vor dem Senden.

## Offen
- Generator für organische Teile anbinden (Schnittstelle in `apply_calls`, Zweig `art == "organisch"`)
- Freies Retexturing auf Basis eines Referenzbildes sowie Texturen im USD-Export
- PartField oder SAM auf gerenderten Ansichten für Bereiche, die sich nicht über Texturfarben trennen lassen
- Bild-zu-3D-Generator für Filmqualität (TRELLIS.2 auf eigener GPU oder Cloud-API; Lizenzen vorher prüfen)
- Nutzer/Sitzungen dauerhaft speichern (derzeit Dateien in `data/`)
