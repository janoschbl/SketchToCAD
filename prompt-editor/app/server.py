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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import cad_sandbox, model_io, planner, tools

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)
ERLAUBT = {".glb", ".gltf", ".obj", ".usd", ".usda", ".usdc"}
MAX_MB = 200

app = FastAPI(title="SketchToCAD Prompt-Editor")


# ------------------------------------------------------------------ Sitzungen / Versionen
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
    (sdir(sid) / "history.json").write_text(json.dumps(h, ensure_ascii=False, indent=1))


def current(sid: str) -> int:
    return history(sid)[-1]["version"]


def load_version(sid: str, v: int):
    return model_io.load_model(str(sdir(sid) / f"v{v}.glb"))


def write_version(sid: str, scene, eintrag: dict) -> int:
    h = history(sid)
    v = h[-1]["version"] + 1 if h else 1
    model_io.save_glb(scene, str(sdir(sid) / f"v{v}.glb"))
    h.append({"version": v, "zeit": time.strftime("%H:%M:%S"), **eintrag})
    save_history(sid, h)
    return v


def state(sid: str, v: int | None = None) -> dict:
    v = v or current(sid)
    scene = load_version(sid, v)
    return {"session": sid, "version": v, "glb_url": f"/api/{sid}/v/{v}.glb",
            "teile": model_io.parts_list(scene), "verlauf": history(sid)}


# ------------------------------------------------------------------ Ausführen
def apply_calls(scene, calls: list[dict], model: str | None):
    """Führt die Werkzeug-Aufrufe auf einer Kopie aus. Rückfragen werden gesammelt, nicht ausgeführt."""
    log, fragen = [], []
    for call in calls:
        name, args = call["name"], dict(call.get("arguments") or {})
        try:
            if name == "frage_nach":
                fragen.append(args.get("frage", ""))
                log.append({"werkzeug": name, "argumente": args, "ergebnis": "Rückfrage"})
                continue
            if name in tools.SIMPLE_TOOLS:
                betroffen = tools.SIMPLE_TOOLS[name](scene, **args)
            elif name == "ersetze":
                ziel = tools.match(scene, args["teil"])
                if args.get("art") == "organisch":
                    raise tools.ToolError("Organische Teile: Generator noch nicht angebunden "
                                          "(vorgesehen: eigenes Modell, Platzhalter Meshy/TRELLIS.2).")
                groesse = scene.geometry[ziel[0]].extents
                code = planner.generate_cad_code(args["beschreibung"], groesse, model)
                neu = cad_sandbox.code_zu_mesh(code)       # einmal erzeugen …
                betroffen = tools.ersetze_mit_mesh(scene, args["teil"], neu)  # … für alle Seiten einsetzen
                args["cad_code"] = code
            else:
                raise tools.ToolError(f"Unbekanntes Werkzeug: {name}")
            log.append({"werkzeug": name, "argumente": args, "ergebnis": betroffen})
        except (tools.ToolError, cad_sandbox.CadError, TypeError, KeyError) as e:
            log.append({"werkzeug": name, "argumente": args, "fehler": str(e)})
    return log, fragen


# ------------------------------------------------------------------ API
@app.get("/api/config")
def config():
    return {"modus": planner.mode(), "modell": planner.model_name(),
            "modelle": ["gpt-6.1-sol", "gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-terra"],
            "cad_modell": planner.cad_model_name()}


@app.post("/api/upload")
async def upload(datei: UploadFile = File(...)):
    suffix = Path(datei.filename or "").suffix.lower()
    if suffix not in ERLAUBT:
        raise HTTPException(400, f"Format {suffix or '?'} nicht unterstützt. Erlaubt: {', '.join(sorted(ERLAUBT))}")
    data = await datei.read()
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
    (d / "history.json").write_text("[]")
    write_version(sid, scene, {"auftrag": f"Hochgeladen: {datei.filename}", "aufrufe": []})
    return state(sid)


@app.post("/api/{sid}/edit")
async def edit(sid: str, auftrag: str = Form(...), ausgewaehlt: str = Form(""), modell: str = Form(""),
               bild: UploadFile | None = File(None)):
    scene = load_version(sid, current(sid))
    image_url = None
    if bild is not None and bild.filename:
        raw = await bild.read()
        mime = bild.content_type or "image/png"
        image_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    t0 = time.time()
    try:
        result = planner.plan(model_io.parts_list(scene), auftrag, ausgewaehlt or None, image_url, modell or None)
    except Exception as e:
        raise HTTPException(502, f"KI-Aufruf fehlgeschlagen: {e}")
    log, fragen = apply_calls(scene, result["calls"], modell or None)
    geaendert = any("ergebnis" in l and l["werkzeug"] != "frage_nach" for l in log)
    out = {"aufrufe": log, "rueckfragen": fragen, "ki_text": result["text"], "nutzung": result["usage"],
           "dauer_s": round(time.time() - t0, 2)}
    if geaendert:
        write_version(sid, scene, {"auftrag": auftrag, "aufrufe": log})
    return {**state(sid), **out, "neue_version": geaendert}


@app.post("/api/{sid}/undo")
def undo(sid: str):
    h = history(sid)
    if len(h) <= 1:
        raise HTTPException(400, "Nichts rückgängig zu machen")
    (sdir(sid) / f"v{h[-1]['version']}.glb").unlink(missing_ok=True)
    save_history(sid, h[:-1])
    return state(sid)


@app.get("/api/{sid}")
def get_state(sid: str):
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
