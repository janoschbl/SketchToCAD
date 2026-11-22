"""Testseite Skizze → Bild → TRELLIS (Zero-Shot, ohne eigenes Training).

Rechnet nicht lokal, sondern ruft zwei Hugging-Face-Spaces (ZeroGPU) auf:
  Skizze → Bild:  ByteDance/Hyper-SD15-Scribble   (SD 1.5 + Scribble-ControlNet, 1–8 Schritte)
  Bild → 3D:      trellis-community/TRELLIS       (TrellisImageTo3DPipeline, TRELLIS-image-large)
Jeder Lauf wird unter runs/<id>/ abgelegt (Skizze, Bilder, GLB, Video, meta.json) für die spätere Auswertung.

  HF_TOKEN=... ../.venv/bin/uvicorn server:app --port 8790     (im Ordner lab/trellis_lab)
"""
import json, os, shutil, threading, time, uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from gradio_client import Client, handle_file

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs"); os.makedirs(RUNS, exist_ok=True)
TOKEN = os.environ.get("HF_TOKEN") or None
SD_SPACE, TRELLIS_SPACE = "ByteDance/Hyper-SD15-Scribble", "trellis-community/TRELLIS"
PROMPT = "{x}, 3d model, full body, single object, centered, plain white background, soft studio lighting"

app = FastAPI()
app.mount("/files", StaticFiles(directory=RUNS), name="files")
_clients, _lock = {}, threading.Lock()


def client(space):
    if space not in _clients:
        _clients[space] = Client(space, token=TOKEN, verbose=False, download_files=os.path.join(HERE, ".gradio"))
    return _clients[space]


def gradio_error(e):
    msg = str(e)
    if "quota" in msg.lower():
        return HTTPException(429, "GPU-Kontingent bei Hugging Face aufgebraucht: " + msg)
    return HTTPException(502, f"{type(e).__name__}: {msg}")


def save_meta(rid, **kw):
    p = os.path.join(RUNS, rid, "meta.json")
    m = json.load(open(p)) if os.path.exists(p) else {}
    m.update(kw); json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
    return m


@app.get("/classes")
def classes():
    return json.load(open(os.path.join(HERE, "classes.json")))


@app.get("/status")
def status():
    return dict(token=bool(TOKEN), sd=SD_SPACE, trellis=TRELLIS_SPACE)


@app.post("/sketch2img")
async def sketch2img(sketch: UploadFile = File(...), subject: str = Form(...), cls: str = Form(""),
                     seed: int = Form(42), scale: float = Form(0.8), steps: int = Form(1), n: int = Form(4),
                     prompt: str = Form("")):
    rid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    d = os.path.join(RUNS, rid); os.makedirs(d)
    sp = os.path.join(d, "sketch.png")
    with open(sp, "wb") as f:
        f.write(await sketch.read())
    full = prompt.strip() or PROMPT.format(x=f"a {subject.strip()}")
    t = time.time()
    try:
        r = client(SD_SPACE).predict(steps, full, scale, 1.0, seed,
                                     dict(background=handle_file(sp), layers=[], composite=handle_file(sp), id=None),
                                     n, api_name="/process_image")
    except Exception as e:
        save_meta(rid, cls=cls, subject=subject, prompt=full, error=str(e)); raise gradio_error(e)
    imgs = []
    for i, it in enumerate(r):
        src = it["image"] if isinstance(it["image"], str) else it["image"]["path"]
        shutil.copy(src, os.path.join(d, f"img{i}.png")); imgs.append(f"img{i}.png")
    save_meta(rid, cls=cls, subject=subject, prompt=full, seed=seed, scale=scale, steps=steps, images=imgs,
              sd_seconds=round(time.time() - t, 1))
    return dict(id=rid, prompt=full, seconds=round(time.time() - t, 1), images=[f"files/{rid}/{x}" for x in imgs])


@app.post("/img2three")
def img2three(id: str = Form(...), image: int = Form(0), seed: int = Form(0)):
    d = os.path.join(RUNS, os.path.basename(id))
    src = os.path.join(d, f"img{image}.png")
    if not os.path.exists(src):
        raise HTTPException(404, "Bild nicht gefunden")
    t = time.time()
    with _lock:  # TRELLIS-Space hält Zustand pro Sitzung (Vorverarbeitung → Erzeugung)
        try:
            c = client(TRELLIS_SPACE)
            c.predict(api_name="/start_session")
            pre = c.predict(handle_file(src), api_name="/preprocess_image")
            out = c.predict(handle_file(pre), [], seed, 7.5, 12, 3.0, 12, "stochastic", 0.95, 1024,
                            api_name="/generate_and_extract_glb")
        except Exception as e:
            save_meta(id, trellis_error=str(e)); raise gradio_error(e)
    tag = f"img{image}_s{seed}"
    shutil.copy(pre, os.path.join(d, f"{tag}_pre.png"))
    vid = out[0]["video"] if isinstance(out[0], dict) else out[0]
    shutil.copy(vid, os.path.join(d, f"{tag}.mp4"))
    shutil.copy(out[1], os.path.join(d, f"{tag}.glb"))
    m = save_meta(id, **{f"trellis_{tag}": dict(seconds=round(time.time() - t, 1))})
    return dict(id=id, seconds=round(time.time() - t, 1), pre=f"files/{id}/{tag}_pre.png",
                video=f"files/{id}/{tag}.mp4", glb=f"files/{id}/{tag}.glb")


@app.post("/rate")
def rate(id: str = Form(...), key: str = Form(...), score: int = Form(...), note: str = Form("")):
    p = os.path.join(RUNS, os.path.basename(id), "meta.json")
    m = json.load(open(p)); m.setdefault("ratings", {})[key] = dict(score=score, note=note)
    json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
    return dict(ok=True)


@app.get("/history")
def history():
    out = []
    for rid in sorted(os.listdir(RUNS), reverse=True)[:60]:
        p = os.path.join(RUNS, rid, "meta.json")
        if os.path.exists(p):
            m = json.load(open(p)); m["id"] = rid; out.append(m)
    return out
