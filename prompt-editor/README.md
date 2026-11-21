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
1. GLB/GLTF/OBJ/USD in den Viewer ziehen (ein Modell aus einem Stück wird automatisch nach Verbundenheit zerlegt).
2. Optional ein Teil anklicken (wird an die KI als „ausgewählt“ übergeben).
3. Auftrag schreiben, optional Bild anhängen, Modell wählen (Sol 6.1/Sol 6.2/Astra/Terra), „Ändern“.
4. Ergebnis, Werkzeug-Aufrufe, Rückfragen und Kosten erscheinen rechts; Versionen anklickbar; USD-Export.

## Wie der KI-Aufruf funktioniert (`app/planner.py`)
`POST https://api.openai.com/v1/responses` mit
- `model`: `gpt-6.1-sol` (Standard), `gpt-6.2-sol`, `gpt-6.2-astra` (stärkstes) oder `gpt-6.1-terra` (günstigstes), per `OPENAI_MODEL` oder Auswahl im UI;
  für den CAD-Code neuer Teile optional ein eigenes Modell per `OPENAI_CAD_MODEL` (z. B. `gpt-6.2-astra`)
- `instructions`: Regeln (nie neu erstellen, nur ganze Teile, links/rechts aus Objektsicht …)
- `input`: Teileliste (Name, Farbe, Mitte, Größe) + Auftrag + ausgewähltes Teil + optional Bild (`input_image`, Base64)
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
| frage_nach | Rückfrage statt Raten; erzeugt keine Version |

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
python -m pytest -q tests      # 10 Tests, laufen ohne Schlüssel (Mock)
```

## Sicherheit
KI-geschriebener CAD-Code wird statisch geprüft (nur `cadquery`/`math`, keine Datei-/System-Zugriffe) und in einem
eigenen Prozess mit Zeitlimit ausgeführt (`app/cad_sandbox.py`). Für Produktion zusätzlich: Container ohne Netzwerk, Speicherlimit.
Den API-Schlüssel nur in `.env` bzw. Umgebungsvariablen, nie ins Repo.

## Offen
- Generator für organische Teile anbinden (Schnittstelle in `apply_calls`, Zweig `art == "organisch"`)
- `neue_textur` (Meshy Retexture)
- Benennung unbenannter Teile per Bild-KI; PartField für echte Klumpen
- Nutzer/Sitzungen dauerhaft speichern (derzeit Dateien in `data/`)
