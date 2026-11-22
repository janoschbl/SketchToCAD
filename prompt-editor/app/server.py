"""SketchTo3D Prompt-Editor – Backend (FastAPI).

Ablauf pro Änderung:
  Prompt (+ Bild, + ausgewähltes Teil) → KI plant Werkzeug-Aufrufe → Python führt aus → neue Version
Start: uvicorn app.server:app --reload   (im Ordner sketchtocad_app)
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import cad_sandbox, demo, geometry, logos, model_io, planner, studio_agent, surfaces, tools

ROOT = Path(__file__).resolve().parent.parent

try:  # .env im Ordner prompt-editor/ automatisch laden; echte Umgebungsvariablen haben Vorrang
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)
except ImportError:  # python-dotenv fehlt: dann wie bisher `export $(grep -v '^#' .env | xargs)`
    pass

DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)
ERLAUBT = {".glb", ".gltf", ".obj", ".usd", ".usda", ".usdc"}
MAX_MB = 200
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIEWS = 6
MAX_JSON_CHARS = 200_000
# Schutzgrenze für Umbauten: so viele neue Teile darf ein Auftrag höchstens anlegen.
MAX_NEUE_TEILE = int(os.environ.get("MAX_NEUE_TEILE", "12"))
# Ratenlimit für KI-Aufträge pro Client und Minute (0 = aus).
RATE_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "30"))
LOG_FILE = DATA / "log" / "anfragen.jsonl"
LOG_LOCK = Lock()
RATE_LOCK = Lock()
_hits: dict[str, deque] = defaultdict(deque)
# Einmal-Sitzungen der Hauptapp (/api/edit-glb) räumen sich nach dieser Zeit selbst auf.
ADHOC_TTL_S = float(os.environ.get("ADHOC_TTL_MIN", "60")) * 60
ADHOC_MARKER = ".adhoc"
SESSION_LOCKS = tuple(Lock() for _ in range(64))

app = FastAPI(title="SketchTo3D Prompt-Editor")


# ------------------------------------------------------------------ Sitzungen / Versionen
def session_lock(sid):
    return SESSION_LOCKS[hash(sid) % len(SESSION_LOCKS)]


def sdir(sid: str) -> Path:
    if not sid.isalnum():
        raise HTTPException(400, "Ungültige Sitzung")
    d = DATA / sid
    if not d.exists():
        raise HTTPException(404, "Sitzung nicht gefunden")
    return d


def history(sid: str) -> list:
    return json.loads((sdir(sid) / "history.json").read_text())


def save_history(sid: str, h: list):
    path = sdir(sid) / "history.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(h, ensure_ascii=False, indent=1))
    tmp.replace(path)


def current(sid: str) -> int:
    return history(sid)[-1]["version"]


def load_version(sid: str, v: int):
    return model_io.load_model(str(sdir(sid) / f"v{v}.glb"))


def write_version(sid: str, scene, eintrag: dict) -> int:
    h = history(sid)
    v = h[-1]["version"] + 1 if h else 1
    path = sdir(sid) / f"v{v}.glb"
    tmp = path.with_suffix(".tmp.glb")
    try:
        model_io.save_glb(scene, str(tmp))
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
    h.append({"version": v, "zeit": time.strftime("%H:%M:%S"), **eintrag})
    save_history(sid, h)
    return v


def state(sid: str, scene=None) -> dict:
    entries = history(sid)
    v = entries[-1]["version"]
    if scene is None:
        scene = load_version(sid, v)
    return {"session": sid, "version": v, "glb_url": f"/api/{sid}/v/{v}.glb",
            "teile": model_io.parts_list(scene), "verlauf": entries}


# ------------------------------------------------------------------ Ausführen
def apply_calls(scene, calls: list[dict], model: str | None, usage, raw_image=None, kontext=None):
    """Führt geplante Werkzeuge in Reihenfolge aus und protokolliert das Ergebnis.
    Enthält der Plan eine Rückfrage, wird nur sie zurückgegeben und nichts geändert (erst fragen, dann handeln)."""
    kontext = kontext or {}
    fragen_calls = [c for c in calls if c["name"] == "frage_nach"]
    if fragen_calls:
        args = dict(fragen_calls[0].get("arguments") or {})
        return [{"werkzeug": "frage_nach", "argumente": args, "ergebnis": "Rückfrage"}], [args]
    log = []
    sticker_image = None
    neue_teile = 0
    for call in calls:
        name, args = call["name"], dict(call.get("arguments") or {})
        try:
            if name in tools.SIMPLE_TOOLS:
                betroffen = tools.SIMPLE_TOOLS[name](scene, **args)
            elif name == "gleiche_an":
                betroffen = tools.gleiche_an(scene, **args, modelle=kontext.get("modelle") or [])
            elif name == "faerbe_bereich":
                names = tools.match(scene, args["teil"])
                texel = 0
                for n in names:
                    if model_io.texture_of(scene.geometry[n]) is None:
                        continue
                    scene.geometry[n], k = surfaces.recolor_region(
                        scene.geometry[n], args["quellfarben"], args["toleranz"], args.get("bild_bereich"),
                        args.get("ziel_rgb"))
                    texel += k
                if not texel:
                    raise tools.ToolError("Keines der Teile hat eine Textur mit diesen Farben.")
                betroffen = names
            elif name == "baue":
                anzahl = sum(len(t.get("positionen") or [1]) for t in args.get("teile") or [])
                if neue_teile + anzahl > MAX_NEUE_TEILE:
                    raise tools.ToolError(f"Zu großer Umbau: höchstens {MAX_NEUE_TEILE} neue Teile pro Auftrag.")
                betroffen = geometry.add_parts(scene, **args)
                neue_teile += len(betroffen)
            elif name == "lackiere":
                names = tools.match(scene, args["teil"])
                paint_args = {k: v for k, v in args.items() if k != "teil"}
                sticker = args["sticker"]
                if sticker is not None and sticker["text"] is None and sticker_image is None:
                    sticker_image = surfaces.read_image(raw_image)
                replacements = {
                    n: surfaces.paint_mesh(scene.geometry[n], **paint_args, image=sticker_image) for n in names
                }
                scene.geometry.update(replacements)
                betroffen = names
            elif name == "klebe_logo":
                betroffen, info = klebe_logo(scene, args, raw_image, kontext)
                args.update(info)
            elif name == "ersetze":
                ziel = tools.match(scene, args["teil"])
                if args.get("art") == "organisch":
                    raise tools.ToolError("Organische Teile: Generator noch nicht angebunden "
                                          "(vorgesehen: eigenes Modell, Platzhalter Meshy/TRELLIS.2).")
                groesse = scene.geometry[ziel[0]].extents
                code, extra_usage = planner.generate_cad_code(args["beschreibung"], groesse, model)
                for key, value in extra_usage.items():
                    usage[key] = usage.get(key, 0) + value
                neu = cad_sandbox.code_zu_mesh(code)       # einmal erzeugen …
                betroffen = tools.ersetze_mit_mesh(scene, args["teil"], neu)  # … für alle Seiten einsetzen
                args["cad_code"] = code
            else:
                raise tools.ToolError(f"Unbekanntes Werkzeug: {name}")
            log.append({"werkzeug": name, "argumente": args, "ergebnis": betroffen})
        except (tools.ToolError, cad_sandbox.CadError, logos.LogoError, TypeError, KeyError, ValueError, OverflowError) as e:
            log.append({"werkzeug": name, "argumente": args, "fehler": str(e)})
    return log, []


def klebe_logo(scene, args, raw_image, kontext):
    """Logo holen (Netz, Anhang oder Text) und als eigenes Teil `logo_<name>` an Pin, Texturposition oder Seite legen."""
    pin = None
    if args.get("pin") is not None:
        pin = next((p for p in kontext.get("pins") or [] if str(p.get("n")) == str(args["pin"])), None)
        if pin is None:
            raise tools.ToolError(f"Pin {args['pin']} gibt es nicht.")
    teil = args["teil"]
    if pin and pin.get("teil") and pin["teil"] in scene.geometry:
        teil = pin["teil"]
    names = tools.match(scene, teil)
    quelle = args.get("quelle")
    nur_symbol = bool(args.get("nur_symbol"))
    info = {}
    if quelle == "web":
        logo, url = logos.fetch(args.get("marke"), args.get("domain"), symbol_first=nur_symbol)
        info["logo_quelle"] = url
        label = args.get("marke") or args.get("domain") or "logo"
    elif quelle == "anhang":
        if not raw_image:
            raise tools.ToolError("Für ein Logo aus dem Anhang bitte ein Bild anhängen.")
        logo = logos.strip_background(logos._open_image(raw_image))
        label = "anhang"
    else:
        logo = surfaces.text_image(args.get("text"), args.get("rgb"))
        label = args.get("text") or "text"
    if nur_symbol:
        logo = logos.symbol_only(logo)
    uv_punkt = (pin or {}).get("bild") or args.get("bild_position")
    # Logos liegen auf der Oberfläche, nicht auf anderen Logos oder Anbauteilen.
    names = [n for n in names if not n.lower().startswith("logo_")] or names
    if len(names) > 1 and uv_punkt is not None:
        names = names[:1]  # eine Texturposition gehört zu genau einem Teil
    neu = []
    for n in names:
        deco, ort = surfaces.decal_part(
            scene.geometry[n], logo, args["breite_m"], uv_punkt=uv_punkt, seite=args.get("seite"),
            position=args.get("position"), drehung=args.get("drehung") or 0)
        base = model_io._safe("logo_" + model_io.ascii_name(label).lower()).lower()
        name, k = base, 2
        while name in scene.geometry:
            name = f"{base}_{k}"; k += 1
        scene.add_geometry(deco, node_name=name, geom_name=name)
        neu.append(name)
        info.setdefault("orte", []).append({"teil": n, "logo": name, **ort})
    return neu, info


# ------------------------------------------------------------------ Protokoll und Schutz
def write_log(entry: dict):
    """Eine JSON-Zeile pro Anfrage (auch ohne neue Version). Keine Schlüssel, keine Bilddaten."""
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False, default=str)
        with LOG_LOCK, LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def client_ip(request: Request | None) -> str:
    if request is None or request.client is None:
        return "?"
    return request.client.host


def check_rate(request: Request | None):
    if RATE_PER_MIN <= 0:
        return
    now, ip = time.time(), client_ip(request)
    with RATE_LOCK:
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_PER_MIN:
            raise HTTPException(429, f"Zu viele Aufträge (höchstens {RATE_PER_MIN} pro Minute). Bitte kurz warten.")
        q.append(now)


def is_loopback(request: Request) -> bool:
    return client_ip(request) in ("127.0.0.1", "::1", "localhost", "testclient")


# ------------------------------------------------------------------ API
@app.get("/api/config")
def config():
    return {"modus": planner.mode(), "modell": planner.model_name(),
            "modelle": ["gpt-6.2-sol", "gpt-6.1-sol", "gpt-6.2-astra", "gpt-6.1-terra"],
            "cad_modell": planner.cad_model_name()}


def initial_state(sid, scene, description, aufrufe=None):
    (sdir(sid) / "history.json").write_text("[]")
    write_version(sid, scene, {"auftrag": description, "aufrufe": aufrufe or []})
    return state(sid, scene)


def prune_adhoc_sessions():
    """Löscht abgelaufene Einmal-Sitzungen (nur Ordner mit Marker, eigene Sitzungen bleiben unberührt)."""
    now = time.time()
    for d in DATA.iterdir():
        marker = d / ADHOC_MARKER
        try:
            if d.is_dir() and d.name.isalnum() and marker.exists() and now - marker.stat().st_mtime > ADHOC_TTL_S:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


def new_session(adhoc=False) -> str:
    sid = uuid.uuid4().hex[:12]
    d = DATA / sid
    d.mkdir()
    if adhoc:
        (d / ADHOC_MARKER).touch()
    return sid


def read_image(bild: UploadFile | None):
    """Referenzbild lesen → (Rohdaten, data-URL) oder (None, None)."""
    if bild is None or not bild.filename:
        return None, None
    raw = bild.file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Bild größer als 12 MB")
    mime = bild.content_type or "image/png"
    return raw, f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def read_views(files: list[UploadFile] | None) -> tuple[list[str], int]:
    """Gerenderte Modellansichten aus dem Canvas → data-URLs (höchstens MAX_VIEWS)."""
    urls, total = [], 0
    for f in (files or [])[:MAX_VIEWS]:
        raw, url = read_image(f)
        if url:
            urls.append(url)
            total += len(raw)
    return urls, total


def read_json(text: str, name: str, default):
    if not text:
        return default
    if len(text) > MAX_JSON_CHARS:
        raise HTTPException(413, f"{name} ist zu groß.")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"{name} ist kein gültiges JSON.") from e
    if not isinstance(value, type(default)):
        raise HTTPException(400, f"{name} hat das falsche Format.")
    return value


def read_kontext(verlauf: str, modelle: str, pins: str, marken: str, views: list[str]) -> dict:
    return {"verlauf": read_json(verlauf, "verlauf", [])[-12:], "modelle": read_json(modelle, "modelle", [])[:40],
            "pins": read_json(pins, "pins", [])[:20], "marken": read_json(marken, "marken", {}), "ansichten": views}


def read_model_upload(datei: UploadFile) -> tuple[str, bytes]:
    suffix = Path(datei.filename or "").suffix.lower()
    if suffix not in ERLAUBT:
        raise HTTPException(400, f"Format {suffix or '?'} nicht unterstützt. Erlaubt: {', '.join(sorted(ERLAUBT))}")
    data = datei.file.read(MAX_MB * 1024 * 1024 + 1)
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"Datei größer als {MAX_MB} MB")
    return suffix, data


def import_model(sid: str, suffix: str, data: bytes, description: str):
    d = DATA / sid
    src = d / f"original{suffix}"
    src.write_bytes(data)
    try:
        scene = model_io.load_model(str(src), split=True)
    except Exception as e:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, f"Modell konnte nicht gelesen werden: {e}")
    return initial_state(sid, scene, description)


@app.post("/api/demo")
def load_demo():
    scene = demo.make_testauto()
    sid = uuid.uuid4().hex[:12]
    (DATA / sid).mkdir()
    return initial_state(sid, scene, "Testauto geladen")


@app.post("/api/upload")
def upload(datei: UploadFile = File(...)):
    suffix, data = read_model_upload(datei)
    return import_model(new_session(), suffix, data, f"Hochgeladen: {datei.filename}")


def enrich(scene, kontext: dict):
    """Maße des Modells und Texturfarbe unter jedem Pin ergänzen (die KI sieht so, was am Pin liegt)."""
    lo, hi = scene.bounds
    kontext["masse"] = tools.masse(hi - lo)
    for pin in kontext.get("pins") or []:
        mesh = scene.geometry.get(str(pin.get("teil") or ""))
        bild = pin.get("bild")
        if mesh is not None and isinstance(bild, list) and len(bild) == 2:
            try:
                pin["farbe"] = surfaces.sample_texture(mesh, float(bild[0]), float(bild[1]))
                pin["umgebung"] = surfaces.texture_neighborhood(mesh, float(bild[0]), float(bild[1]))
            except (TypeError, ValueError):
                pass


def run_edit(sid: str, auftrag: str, ausgewaehlt: str, modell: str, raw, image_url, kontext=None, meta=None):
    kontext = kontext or {}
    t0 = time.perf_counter()
    eintrag = {"zeit": time.strftime("%Y-%m-%d %H:%M:%S"), "sitzung": sid, "auftrag": auftrag,
               "auswahl": ausgewaehlt or None, "modus": planner.mode(), "ki_modell": modell or planner.model_name(),
               **(meta or {}), "verlauf": kontext.get("verlauf"), "pins": kontext.get("pins"),
               "andere_modelle": len([m for m in kontext.get("modelle") or [] if not m.get("selbst")]),
               "ansichten": len(kontext.get("ansichten") or []), "bild_bytes": len(raw) if raw else 0}
    try:
        with session_lock(sid):
            scene = load_version(sid, current(sid))
            enrich(scene, kontext)
            eintrag["masse"] = kontext["masse"]
            try:
                result = planner.plan(model_io.parts_list(scene), auftrag, ausgewaehlt or None, image_url,
                                      modell or None, kontext)
            except Exception as e:
                raise HTTPException(502, f"KI-Aufruf fehlgeschlagen: {e}") from e
            log, fragen = apply_calls(scene, result["calls"], modell or None, result["usage"], raw, kontext)
            geaendert = any("ergebnis" in l and l["werkzeug"] != "frage_nach" for l in log)
            if geaendert:
                write_version(sid, scene, {"auftrag": auftrag, "aufrufe": log})
            out = {**state(sid, scene), "aufrufe": log, "rueckfragen": fragen, "ki_text": result["text"],
                   "nutzung": result["usage"], "dauer_s": round(time.perf_counter() - t0, 3),
                   "neue_version": geaendert}
            eintrag.update(aufrufe=[{k: v for k, v in l.items() if k != "argumente" or l["werkzeug"] != "ersetze"}
                                    for l in log], rueckfragen=fragen, ki_text=result["text"],
                           nutzung=result["usage"], neue_version=geaendert, version=out["version"],
                           fehler=[l["fehler"] for l in log if "fehler" in l] or None)
            return out
    except HTTPException as e:
        eintrag.update(fehler=[str(e.detail)], status=e.status_code, neue_version=False)
        raise
    except Exception as e:
        eintrag.update(fehler=[f"{type(e).__name__}: {e}"], status=500, neue_version=False)
        raise
    finally:
        eintrag["dauer_s"] = round(time.perf_counter() - t0, 3)
        write_log(eintrag)


@app.post("/api/{sid}/edit")
def edit(request: Request, sid: str, auftrag: str = Form(...), ausgewaehlt: str = Form(""), modell: str = Form(""),
         verlauf: str = Form(""), modelle: str = Form(""), pins: str = Form(""), marken: str = Form(""),
         modellname: str = Form(""), bild: UploadFile | None = File(None),
         ansichten: list[UploadFile] | None = File(None)):
    """Auftrag auf eine bestehende Sitzung (auch: Fortsetzung nach einer Rückfrage, ohne erneuten Upload)."""
    check_rate(request)
    sdir(sid)
    raw, image_url = read_image(bild)
    views, view_bytes = read_views(ansichten)
    kontext = read_kontext(verlauf, modelle, pins, marken, views)
    return run_edit(sid, auftrag, ausgewaehlt, modell, raw, image_url, kontext,
                    {"modellname": modellname or None, "ansicht_bytes": view_bytes, "fortsetzung": True})


@app.post("/api/edit-glb")
def edit_glb(request: Request, datei: UploadFile = File(...), auftrag: str = Form(...), ausgewaehlt: str = Form(""),
             modell: str = Form(""), verlauf: str = Form(""), modelle: str = Form(""), pins: str = Form(""),
             marken: str = Form(""), modellname: str = Form(""), bild: UploadFile | None = File(None),
             ansichten: list[UploadFile] | None = File(None)):
    """Hauptapp: ein Modell mitschicken, Auftrag ausführen lassen, geändertes GLB abholen (glb_url).
    Das Modell wird wie beim Hochladen in Teile zerlegt; die Sitzung ist eine Einmal-Sitzung."""
    check_rate(request)
    prune_adhoc_sessions()
    raw, image_url = read_image(bild)
    views, view_bytes = read_views(ansichten)
    kontext = read_kontext(verlauf, modelle, pins, marken, views)
    suffix, data = read_model_upload(datei)
    sid = new_session(adhoc=True)
    import_model(sid, suffix, data, f"Hauptapp: {auftrag[:60]}")
    return run_edit(sid, auftrag, ausgewaehlt, modell, raw, image_url, kontext,
                    {"modellname": modellname or None, "glb_bytes": len(data), "ansicht_bytes": view_bytes})


@app.post("/api/studio/plan")
async def studio_plan(request: Request):
    """KI-Studio: Wunsch in Worten → Bearbeitungsschritte (palette | restyle | replace | delete) für den Heim-PC."""
    check_rate(request)
    body = await request.json()
    if not (body.get("prompt") or "").strip():
        raise HTTPException(400, "Describe what should change.")
    if not body.get("parts"):
        raise HTTPException(400, "No model yet.")
    for key in ("image", "labeled"):
        if body.get(key) and (not str(body[key]).startswith("data:image/") or len(body[key]) > 8_000_000):
            raise HTTPException(400, "Invalid image.")
    try:
        out = studio_agent.plan(body, body.get("model") or None)
    except Exception as e:  # noqa: BLE001 – Fehler des KI-Anbieters lesbar zurückgeben
        raise HTTPException(502, f"AI planning failed: {e}")
    out["modus"] = planner.mode()
    return out


@app.post("/api/convert")
def convert(request: Request, datei: UploadFile = File(...)):
    """Hauptapp: OBJ/USD/glTF → GLB für den Canvas (Teile und Lage bleiben, nichts wird zerlegt)."""
    check_rate(request)
    suffix, data = read_model_upload(datei)
    d = DATA / f"conv{uuid.uuid4().hex[:12]}"
    d.mkdir()
    try:
        src = d / f"original{suffix}"
        src.write_bytes(data)
        try:
            scene = model_io.load_model(str(src))
        except Exception as e:
            raise HTTPException(400, f"Modell konnte nicht gelesen werden: {e}") from e
        buf = io.BytesIO()
        scene.export(file_obj=buf, file_type="glb")
        return Response(buf.getvalue(), media_type="model/gltf-binary")
    finally:
        shutil.rmtree(d, ignore_errors=True)


@app.get("/api/log")
def get_log(request: Request, limit: int = 50):
    """Letzte Einträge des Anfrage-Logs – nur vom eigenen Rechner aus."""
    if not is_loopback(request):
        raise HTTPException(403, "Das Log ist nur lokal abrufbar.")
    if not LOG_FILE.exists():
        return []
    lines = LOG_FILE.read_text(encoding="utf-8").splitlines()[-max(1, min(limit, 500)):]
    return [json.loads(l) for l in lines if l.strip()]


@app.post("/api/{sid}/undo")
def undo(sid: str):
    with session_lock(sid):
        h = history(sid)
        if len(h) <= 1:
            raise HTTPException(400, "Nichts rückgängig zu machen")
        save_history(sid, h[:-1])
        (sdir(sid) / f"v{h[-1]['version']}.glb").unlink(missing_ok=True)
        return state(sid)


@app.get("/api/{sid}")
def get_state(sid: str):
    with session_lock(sid):
        return state(sid)


@app.get("/api/{sid}/v/{v}.glb")
def get_glb(sid: str, v: int):
    p = sdir(sid) / f"v{v}.glb"
    if not p.exists():
        raise HTTPException(404, "Version nicht gefunden")
    return FileResponse(p, media_type="model/gltf-binary")


@app.get("/api/{sid}/export.usda")
def export_usd(sid: str):
    v = current(sid)
    p = sdir(sid) / f"v{v}.usda"
    model_io.save_usd(load_version(sid, v), str(p))
    return FileResponse(p, media_type="text/plain", filename=f"modell_v{v}.usda")


@app.exception_handler(HTTPException)
async def http_err(_, exc: HTTPException):
    return JSONResponse({"fehler": exc.detail}, status_code=exc.status_code)


prune_adhoc_sessions()  # beim Start abgelaufene Einmal-Sitzungen entfernen
app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
