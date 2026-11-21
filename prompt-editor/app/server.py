"""SketchToCAD Prompt-Editor – Backend (FastAPI).

Ablauf pro Änderung:
  Prompt (+ Bild, + ausgewähltes Teil) → KI plant Werkzeug-Aufrufe → Python führt aus → neue Version
Start: uvicorn app.server:app --reload   (im Ordner sketchtocad_app)
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import cad_sandbox, demo, geometry, model_io, planner, surfaces, tools

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)
ERLAUBT = {".glb", ".gltf", ".obj", ".usd", ".usda", ".usdc"}
MAX_MB = 200
MAX_IMAGE_BYTES = 12 * 1024 * 1024
SESSION_LOCKS = tuple(Lock() for _ in range(64))

app = FastAPI(title="SketchToCAD Prompt-Editor")


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
def apply_calls(scene, calls: list[dict], model: str | None, usage, raw_image=None):
    """Führt geplante Werkzeuge in Reihenfolge aus und protokolliert das Ergebnis."""
    log, fragen = [], []
    sticker_image = None
    for call in calls:
        name, args = call["name"], dict(call.get("arguments") or {})
        try:
            if name == "frage_nach":
                fragen.append(args.get("frage", ""))
                log.append({"werkzeug": name, "argumente": args, "ergebnis": "Rückfrage"})
                continue
            if name in tools.SIMPLE_TOOLS:
                betroffen = tools.SIMPLE_TOOLS[name](scene, **args)
            elif name == "baue":
                betroffen = geometry.add_parts(scene, **args)
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
        except (tools.ToolError, cad_sandbox.CadError, TypeError, KeyError, ValueError, OverflowError) as e:
            log.append({"werkzeug": name, "argumente": args, "fehler": str(e)})
    return log, fragen


# ------------------------------------------------------------------ API
@app.get("/api/config")
def config():
    return {"modus": planner.mode(), "modell": planner.model_name(),
            "modelle": ["gpt-6.2-sol", "gpt-6.1-sol", "gpt-6.2-astra", "gpt-6.1-terra"],
            "cad_modell": planner.cad_model_name()}


def initial_state(sid, scene, description):
    (sdir(sid) / "history.json").write_text("[]")
    write_version(sid, scene, {"auftrag": description, "aufrufe": []})
    return state(sid, scene)


@app.post("/api/demo")
def load_demo():
    scene = demo.make_testauto()
    sid = uuid.uuid4().hex[:12]
    (DATA / sid).mkdir()
    return initial_state(sid, scene, "Testauto geladen")


@app.post("/api/upload")
def upload(datei: UploadFile = File(...)):
    suffix = Path(datei.filename or "").suffix.lower()
    if suffix not in ERLAUBT:
        raise HTTPException(400, f"Format {suffix or '?'} nicht unterstützt. Erlaubt: {', '.join(sorted(ERLAUBT))}")
    data = datei.file.read(MAX_MB * 1024 * 1024 + 1)
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"Datei größer als {MAX_MB} MB")
    sid = uuid.uuid4().hex[:12]
    d = DATA / sid; d.mkdir()
    src = d / f"original{suffix}"
    src.write_bytes(data)
    try:
        scene = model_io.load_model(str(src), split=True)
    except Exception as e:
        shutil.rmtree(d)
        raise HTTPException(400, f"Modell konnte nicht gelesen werden: {e}")
    return initial_state(sid, scene, f"Hochgeladen: {datei.filename}")


@app.post("/api/{sid}/edit")
def edit(sid: str, auftrag: str = Form(...), ausgewaehlt: str = Form(""), modell: str = Form(""),
         bild: UploadFile | None = File(None)):
    raw = image_url = None
    if bild is not None and bild.filename:
        raw = bild.file.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Bild größer als 12 MB")
        mime = bild.content_type or "image/png"
        image_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    with session_lock(sid):
        t0 = time.perf_counter()
        scene = load_version(sid, current(sid))
        try:
            result = planner.plan(model_io.parts_list(scene), auftrag, ausgewaehlt or None, image_url, modell or None)
        except Exception as e:
            raise HTTPException(502, f"KI-Aufruf fehlgeschlagen: {e}") from e
        log, fragen = apply_calls(scene, result["calls"], modell or None, result["usage"], raw)
        geaendert = any("ergebnis" in l and l["werkzeug"] != "frage_nach" for l in log)
        if geaendert:
            write_version(sid, scene, {"auftrag": auftrag, "aufrufe": log})
        return {**state(sid, scene), "aufrufe": log, "rueckfragen": fragen, "ki_text": result["text"],
                "nutzung": result["usage"], "dauer_s": round(time.perf_counter() - t0, 3),
                "neue_version": geaendert}


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


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
