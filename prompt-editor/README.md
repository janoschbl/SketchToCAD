# SketchToCAD – Prompt-Editor (Web-App)

Ein bestehendes 3D-Modell per Text (und optional Referenzbild) gezielt ändern, ohne es neu zu erzeugen.
Die KI (z. B. GPT-6.1 Sol über die OpenAI-API) plant nur Werkzeug-Aufrufe; Python führt sie aus.
Alles, was kein Aufruf anfasst, bleibt unverändert. Jede Änderung ist eine neue Version (Rückgängig möglich).

## Starten
```bash
pip install -r requirements.txt
cp .env.example .env            # Schlüssel eintragen, dann:
export $(grep -v '^#' .env | xargs)
uvicorn app.server:app --port 8000
# Browser: http://localhost:8000
```
Ohne Schlüssel läuft die App im Testmodus (`LLM_MODE=mock`, einfache Regeln statt KI).

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
- `input`: Teiletabelle, Auftrag, Auswahl und optional ein Referenzbild. `OPENAI_IMAGE_DETAIL` ist standardmäßig `low` und kann für feinere Bilddetails auf `high` gesetzt werden.
- `tools`: der Werkzeugkasten als Function-Schemas (`app/tools.py`)
- `reasoning.effort`: `low` (per `OPENAI_EFFORT` änderbar)

Antwort: `function_call`-Einträge → werden in `app/server.py:apply_calls` ausgeführt.

## Werkzeuge
| Werkzeug | Zweck |
|---|---|
| faerbe | Farbe ganzer Teile |
| skaliere | getrennte Faktoren x/y/z, Anker `mitte`/`boden`/`basis` (Räder bleiben am Boden, Horn bleibt am Kopf) |
| verschiebe, drehe, loesche | Position, Rotation, Entfernen |
| ersetze | neue Form: `art=technisch` → zweiter KI-Aufruf schreibt CadQuery-Code → Ausführung in Sandbox → einmal erzeugt, für die Gegenseite gespiegelt, passend eingesetzt. `art=organisch` → Platzhalter (eigenes Modell / Meshy / TRELLIS.2 anbinden) |
| baue | Fügt Boxen, Keile, Kugeln, Zylinder, Kegel, extrudierte XY-Profile oder Kopien vorhandener Segmente hinzu. Position und Größe sind relativ zum gewählten Teil oder Modell. Mehrere Positionen ergeben einzeln benannte Teile. |
| lackiere | PBR-Lack mit Metallanteil und Rauheit, Streifen, Karos, Punkte oder ein eigenes Polygonmuster sowie Bild- oder Textsticker auf einer gewählten Seite. Sticker lassen sich auf einem vorhandenen Editor-Muster ergänzen. Sticker auf importierten Texturen brauchen eine neue Grundfarbe. |
| frage_nach | Zeigt eine konkrete Rückfrage an. |

## Eigene HTTP-API (für Skripte oder das Skizzen-Tool)
```bash
curl -F "datei=@auto.glb" localhost:8000/api/upload                    # → {"session": "...", "teile": [...]}
curl -F "auftrag=Felgen weiß" -F "ausgewaehlt=" localhost:8000/api/<session>/edit
curl -F "auftrag=Horn wie auf dem Bild" -F "bild=@referenz.png" localhost:8000/api/<session>/edit
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

## Offen
- Generator für organische Teile anbinden (Schnittstelle in `apply_calls`, Zweig `art == "organisch"`)
- Freies Retexturing auf Basis eines Referenzbildes sowie Texturen im USD-Export
- Benennung unbenannter Teile per Bild-KI; PartField für echte Klumpen
- Nutzer/Sitzungen dauerhaft speichern (derzeit Dateien in `data/`)
