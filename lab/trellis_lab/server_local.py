"""Testseite Skizze → Bild → 3D, lokal auf dem Heim-PC (RTX 2070, 8 GB), ohne Cloud.

  Skizze → Bild:  SD 1.5 + ControlNet Scribble (lllyasviel/control_v11p_sd15_scribble), Img2Img für Farben
  Bild → 3D:      TripoSR (stabilityai/TripoSR, MIT), Hintergrund mit rembg, Mesh mit Vertexfarben

Farben: Dunkle Striche = Form (gehen ins ControlNet), farbige Striche = Farbe (gehen als farbiges Startbild in
Img2Img + Farbnamen in den Prompt; ihr Rand geht zusätzlich als Form ins ControlNet). TripoSR übernimmt die
Farben des Bildes als Vertexfarben → die Skizzenfarben landen im 3D-Modell.

Erweiterbar (Projekte): Nach dem ersten 3D-Modell ist der Lauf ein Projekt aus Teilen (project.json). Neue Striche
werden einem Teil zugeordnet (/plan) und nur dieses Teil wird erzeugt oder geändert (/edit); alle anderen Teile bleiben
Byte für Byte gleich (Prüfsumme). Geometrie siehe parts_geo.py.

Gleiche HTTP-API wie server.py (HF-Variante) plus /project, /plan, /edit, /undo, /part_delete. Start auf dem Heim-PC:
  cd /mnt/storage/sketch3d && HF_HOME=/mnt/storage/hf-cache .venv/bin/uvicorn server_local:app --host 0.0.0.0 --port 8790
"""
import io, json, os, shutil, sys, threading, time, uuid

import trimesh

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image

import parts_geo as G

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "TripoSR"))
RUNS = os.path.join(HERE, "runs"); os.makedirs(RUNS, exist_ok=True)
INP_ID = "stable-diffusion-v1-5/stable-diffusion-inpainting"
SD_ID, CN_ID, TSR_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5", "lllyasviel/control_v11p_sd15_scribble", "stabilityai/TripoSR"
PROMPT = "{x}, {c}3d model, full body, single object, centered, plain white background, soft studio lighting, high quality"
NEG = "lowres, blurry, cropped, multiple objects, text, watermark, frame, cluttered background, deformed"
NEG_SKETCH = NEG + ", sketch, drawing, outline, lineart"
# ControlNet nur in den ersten 60 % der Schritte: Umriss, Richtung und Streifen kommen aus der Skizze, die Details frei
# vom Modell. Ohne das gab es nur zwei schlechte Extreme (Fisch-Test 2026-11-21): 0.8 = Bild sieht aus wie die Skizze
# (roter Rahmen statt roter Fisch), 0.1 = hübsch, aber Skizze ignoriert (gespiegelt, Streifen weg).
CN_END = 0.6

# Motiv-Hinweise: in welcher Ansicht wird das Tier typischerweise gezeichnet? (Schmetterling: von oben, Flügel offen)
# Pro Motiv: (Positivhinweis, zusätzlicher Negativ-Prompt). Die Negativliste hält die Form rein (kein Slop: keine
# Beine/Fühler-Wirrwarr, keine zweiten Tiere, keine falsche Ansicht), der Hinweis legt Ansicht und Merkmale fest.
HINTS = {("butterfly", "moth"): (", wings spread open, symmetrical, top view, detailed wing pattern", ""),
         ("dragonfly", "bee", "bird", "eagle", "bat"): (", wings spread open", ""),
         ("ladybug", "ladybird", "lady bug"): (
             ", seen from above, top view, dorsal view, round dome-shaped shell, glossy red elytra with black spots, "
             "black head and pronotum with two white spots, symmetrical, six short legs under the body, two short antennae",
             ", side view, flying, open wings, butterfly, bee, many spots overlapping, extra legs, fly"),
         ("starfish", "sea star", "seastar"): (
             ", seen from above, top view, exactly five arms, radially symmetrical star shape, rough bumpy texture, "
             "orange and red, tube-feet groove along each arm",
             ", four arms, six arms, seven arms, side view, fish, flower, starry sky, hand, text, ocean background")}


def subject_hint(subject, neg=False):
    t = subject.lower()
    h = next((v for keys, v in HINTS.items() if any(k in t for k in keys)), ("", ""))
    return h[1] if neg else h[0]


app = FastAPI()
app.mount("/files", StaticFiles(directory=RUNS), name="files")
gpu = threading.Lock()
plock = threading.Lock()
_sd, _tsr, _rembg, _inp, _sam, _clip = None, None, None, None, None, None


# ---------------------------------------------------------------- Farben
NAMES = {"red": (220, 30, 30), "orange": (240, 140, 20), "yellow": (240, 220, 40), "green": (40, 160, 50),
         "blue": (30, 80, 220), "light blue": (110, 190, 240), "purple": (130, 50, 180), "pink": (240, 120, 180),
         "brown": (120, 70, 30), "gray": (128, 128, 128), "white": (245, 245, 245), "black": (20, 20, 20)}


def color_name(rgb):
    return min(NAMES, key=lambda k: sum((a - b) ** 2 for a, b in zip(NAMES[k], rgb)))


def split_sketch(img):
    """RGB-Skizze (weißer Grund) → (Linien-Maske, Farb-Maske, Farbliste)."""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    hsv = cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_RGB2HSV)
    ink = (255 - a).sum(-1) > 60
    sat, val = hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    colored = ink & (sat > 60) & (val > 50)
    dark = ink & ~colored
    names = {}
    if colored.any():
        px = a[colored]
        q = (px // 32).astype(int)
        keys, cnt = np.unique(q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2], return_counts=True)
        for k, c in sorted(zip(keys, cnt), key=lambda x: -x[1]):
            if c < 0.03 * colored.sum():
                continue
            sel = (q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]) == k
            n = color_name(px[sel].mean(0))
            names[n] = names.get(n, 0) + int(c)
    return dark, colored, [n for n, _ in sorted(names.items(), key=lambda x: -x[1])][:3]


def control_image(dark, colored):
    """Scribble-ControlNet erwartet weiße Linien auf Schwarz."""
    ctl = dark.copy()
    if colored.any():
        m = cv2.dilate(colored.astype(np.uint8), np.ones((5, 5), np.uint8))
        ctl |= cv2.morphologyEx(m, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    ctl = cv2.dilate(ctl.astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
    return Image.fromarray(ctl).convert("RGB")


def color_init(img, colored):
    """Farbiges Startbild für Img2Img: Farbflächen weich verlaufen lassen, Rest weiß."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    m = cv2.dilate(colored.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
    w = cv2.GaussianBlur(m, (0, 0), 12)
    c = cv2.GaussianBlur(a * m[..., None], (0, 0), 12) / np.maximum(w[..., None], 1e-3)
    alpha = np.clip(w * 2.5, 0, 1)[..., None]
    out = c * alpha + 255 * (1 - alpha)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def fill_colored_outlines(img, colored, dark):
    """Von farbigen Strichen umschlossene Flächen mit der Farbe des nächstliegenden Strichs füllen (roter Umriss =
    roter Fisch, nicht roter Ring). Gefüllt wird nur, was farbige Striche allein umschließen; Farbflecke auf einem
    schwarzen Umriss bleiben Flecke. → (Bild, gefüllte Farbmaske)"""
    ink = cv2.dilate(colored.astype(np.uint8), np.ones((5, 5), np.uint8))
    _, lab = cv2.connectedComponents(1 - ink)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    inside = (~np.isin(lab, edge) & (ink == 0)) & ~dark
    if not inside.any():
        return img, colored
    a = np.asarray(img).copy()
    _, L = cv2.distanceTransformWithLabels((~colored).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(colored)
    lut = np.zeros((L.max() + 1, 3), np.uint8); lut[L[ys, xs]] = a[ys, xs]
    a[inside] = lut[L[inside]]
    return Image.fromarray(a), colored | inside


def bright_bg_mask(rgb, tol=38):
    """Vordergrund = alles, was nicht mit dem hellen Rand verbunden ist (None, wenn der Rand nicht hell ist)."""
    a = rgb.astype(np.int16); h, w, _ = a.shape
    bgc = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), 0)
    if bgc.mean() < 170:
        return None
    cand = (np.abs(a - bgc).max(-1) < tol).astype(np.uint8)
    _, lab = cv2.connectedComponents(cand)
    edge = [l for l in np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])) if l != 0]
    return ~np.isin(lab, edge)


def foreground(img, sess):
    """rembg + kräftig gefärbte/dunkle Teile, die rembg bei hellem Grund oft wegschneidet (z. B. dunkle Beine)."""
    import rembg
    rgb = np.asarray(img.convert("RGB"))
    m = np.asarray(rembg.remove(img.convert("RGB"), session=sess))[..., 3] > 127
    fg = bright_bg_mask(rgb)
    if fg is not None:
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        m |= fg & ((hsv[..., 1] > 110) | (hsv[..., 2] < 190))
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = [i for i in range(1, n) if st[i, 4] > 0.01 * m.size]
    alpha = (np.isin(lab, keep) * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


# ---------------------------------------------------------------- Modelle
def sd():
    global _sd
    if _sd is None:
        from diffusers import (ControlNetModel, StableDiffusionControlNetImg2ImgPipeline,
                               StableDiffusionControlNetPipeline, UniPCMultistepScheduler)
        cn = ControlNetModel.from_pretrained(CN_ID, torch_dtype=torch.float16, variant="fp16")
        t2i = StableDiffusionControlNetPipeline.from_pretrained(SD_ID, controlnet=cn, torch_dtype=torch.float16,
                                                                variant="fp16", safety_checker=None)
        t2i.scheduler = UniPCMultistepScheduler.from_config(t2i.scheduler.config)
        t2i.enable_model_cpu_offload()
        i2i = StableDiffusionControlNetImg2ImgPipeline(**t2i.components)
        i2i.enable_model_cpu_offload()
        _sd = (t2i, i2i)
    return _sd


def inpaint():
    """SD-1.5-Inpainting-UNet + dasselbe Scribble-ControlNet, VAE/Text-Encoder geteilt mit sd()."""
    global _inp
    if _inp is None:
        from diffusers import StableDiffusionControlNetInpaintPipeline, UNet2DConditionModel
        t2i, _ = sd()
        unet = UNet2DConditionModel.from_pretrained(INP_ID, subfolder="unet", torch_dtype=torch.float16, variant="fp16")
        c = t2i.components
        _inp = StableDiffusionControlNetInpaintPipeline(vae=c["vae"], text_encoder=c["text_encoder"], tokenizer=c["tokenizer"],
                                                        unet=unet, controlnet=c["controlnet"], scheduler=c["scheduler"],
                                                        safety_checker=None, feature_extractor=c["feature_extractor"],
                                                        requires_safety_checker=False)
        _inp.enable_model_cpu_offload()
    return _inp


def sam_segment(img, points):
    """SAM (facebook/sam-vit-base): Teil unter den Strich-Punkten im aktuellen Bild. Aufrufer hält den GPU-Lock."""
    global _sam
    from transformers import SamModel, SamProcessor
    if _sam is None:
        _sam = (SamModel.from_pretrained("facebook/sam-vit-base"), SamProcessor.from_pretrained("facebook/sam-vit-base"))
    model, proc = _sam
    model.to("cuda")
    try:
        inp = proc(Image.fromarray(img), input_points=[[points]], return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = model(**inp, multimask_output=True)
        masks = proc.image_processor.post_process_masks(out.pred_masks.cpu(), inp["original_sizes"].cpu(), inp["reshaped_input_sizes"].cpu())[0][0].numpy()
        scores = out.iou_scores[0, 0].cpu().numpy()
    finally:
        model.to("cpu"); free()
    return masks, scores


def auto_segments(img, fg):
    """SAM-Automatik (Punktgitter) auf dem Bild → Zerlegung der Figur (Labelbild, Labels). Aufrufer hält den GPU-Lock."""
    from transformers import pipeline
    gen = pipeline("mask-generation", model="facebook/sam-vit-base", device=0)
    try:
        out = gen(Image.fromarray(img), points_per_batch=64, pred_iou_thresh=0.86, stability_score_thresh=0.9)
        masks = [np.asarray(m).astype(bool) for m in out["masks"]]
    finally:
        del gen; free()
    return G.partition(masks, fg)


def tsr_raw(rgba, seed=0, resolution=256):
    """RGBA (Alpha = Objekt) → TripoSR-Rohmesh (aufgeräumt). Aufrufer hält den GPU-Lock."""
    from tsr.utils import resize_foreground
    model, _ = tsr()
    im = resize_foreground(rgba, 0.85)
    a = np.asarray(im).astype(np.float32) / 255.0
    a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
    pre = Image.fromarray((a * 255).astype(np.uint8))
    try:
        model.to("cuda")
        torch.manual_seed(seed)
        with torch.no_grad():
            codes = model([pre], device="cuda")
            mesh = model.extract_mesh(codes, True, resolution=max(64, min(int(resolution), 320)))[0]
    finally:
        model.to("cpu"); free()
    return G.clean(mesh), pre


def tsr():
    global _tsr, _rembg
    if _tsr is None:
        import rembg
        from tsr.system import TSR
        _tsr = TSR.from_pretrained(TSR_ID, config_name="config.yaml", weight_name="model.ckpt")
        _tsr.renderer.set_chunk_size(4096)
        _rembg = rembg.new_session("u2net", providers=["CPUExecutionProvider"])
    return _tsr, _rembg


def free():
    torch.cuda.empty_cache()


def save_meta(rid, **kw):
    p = os.path.join(RUNS, rid, "meta.json")
    m = json.load(open(p)) if os.path.exists(p) else {}
    m.update(kw); json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
    return m


# ---------------------------------------------------------------- API
@app.get("/classes")
def classes():
    return json.load(open(os.path.join(HERE, "classes.json")))


@app.get("/status")
def status():
    return dict(token=False, local=True, sd="SD 1.5 + ControlNet Scribble (lokal)", trellis="TripoSR (lokal)")


@app.post("/sketch2img")
async def sketch2img(sketch: UploadFile = File(...), subject: str = Form(...), cls: str = Form(""),
                     seed: int = Form(42), scale: float = Form(0.5), steps: int = Form(20), n: int = Form(4),
                     prompt: str = Form(""), strength: float = Form(0.85), strokes: str = Form(""),
                     cn_end: float = Form(CN_END)):
    rid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    d = os.path.join(RUNS, rid); os.makedirs(d)
    if strokes:
        open(os.path.join(d, "sketch.json"), "w").write(strokes)
    raw = await sketch.read()
    open(os.path.join(d, "sketch.png"), "wb").write(raw)
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    bg = Image.new("RGBA", img.size, "white"); bg.alpha_composite(img); img = bg.convert("RGB").resize((512, 512))
    dark, colored, cnames = split_sketch(img)
    ctl = control_image(dark, colored); ctl.save(os.path.join(d, "control.png"))
    ctext = (" and ".join(cnames) + " colored, ") if cnames else ""
    hint = subject_hint(subject)
    if cnames:  # eigene Farben der Skizze gewinnen gegen die Standardfarben des Motivs
        hint = hint.replace("glossy red elytra", "glossy elytra").replace("orange and red, ", "")
    full = prompt.strip() or PROMPT.format(x=f"a {subject.strip()}{hint}", c=ctext)
    cn_end = max(0.2, min(float(cn_end), 1.0)); scale = max(0.0, min(float(scale), 2.0))
    steps = max(4, min(int(steps), 40)); n = max(1, min(int(n), 4))
    t = time.time()
    with gpu:
        try:
            t2i, i2i = sd()
            g = [torch.Generator("cpu").manual_seed(seed + i) for i in range(n)]
            if colored.any():
                filled, fmask = fill_colored_outlines(img, colored, dark)
                init = color_init(filled, fmask); init.save(os.path.join(d, "init.png"))
                out = [i2i(full, image=init, control_image=ctl, strength=strength, num_inference_steps=steps,
                           controlnet_conditioning_scale=scale, control_guidance_end=cn_end, negative_prompt=NEG_SKETCH + subject_hint(subject, True),
                           generator=g[i], guidance_scale=7.0).images[0] for i in range(n)]
            else:
                out = [t2i(full, image=ctl, num_inference_steps=steps, controlnet_conditioning_scale=scale,
                           control_guidance_end=cn_end, negative_prompt=NEG_SKETCH + subject_hint(subject, True), generator=g[i],
                           guidance_scale=7.0).images[0] for i in range(n)]
        except torch.cuda.OutOfMemoryError as e:
            free(); save_meta(rid, error=str(e)); raise HTTPException(507, "GPU memory full (home PC). Lower the image count or stop MeshPad briefly.")
        finally:
            free()
    imgs = []
    for i, im in enumerate(out):
        im.save(os.path.join(d, f"img{i}.png")); imgs.append(f"img{i}.png")
    sec = round(time.time() - t, 1)
    save_meta(rid, cls=cls, subject=subject, prompt=full, colors=cnames, seed=seed, scale=scale, cn_end=cn_end, steps=steps,
              strength=strength if colored.any() else None, images=imgs, sd_seconds=sec, backend="local")
    return dict(id=rid, prompt=full, colors=cnames, seconds=sec, images=[f"files/{rid}/{x}" for x in imgs],
                control=f"files/{rid}/control.png", init=f"files/{rid}/init.png" if colored.any() else None)


@app.post("/img2three")
def img2three(id: str = Form(...), image: int = Form(0), seed: int = Form(0), resolution: int = Form(256)):
    """Erstes 3D-Modell = Teil p0 „Körper“ eines neuen Projekts (setzt ein bestehendes Projekt zurück)."""
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    src = os.path.join(d, f"img{image}.png")
    if not os.path.exists(src):
        raise HTTPException(404, "Image not found")
    tag = f"img{image}_s{seed}"
    t = time.time()
    with gpu:
        try:
            _, sess = tsr()
            fg = foreground(Image.open(src).convert("RGB").resize((512, 512)), sess)
            raw, pre = tsr_raw(fg, seed, resolution)
        except torch.cuda.OutOfMemoryError as e:
            save_meta(id, trellis_error=str(e)); raise HTTPException(507, "GPU memory full (home PC). Lower the resolution or stop MeshPad briefly.")
    pre.save(os.path.join(d, f"{tag}_pre.png"))
    mask = np.asarray(fg)[..., 3] > 127
    base = G.place_tsr(raw, mask, 0.0)
    base.export(os.path.join(d, f"{tag}.glb"))
    # Projekt: Figur sofort in Segmente zerlegen (2D: SAM automatisch, 3D: Flächen nach Projektion)
    pd = os.path.join(d, "parts")
    shutil.rmtree(pd, ignore_errors=True); os.makedirs(pd)
    for f in os.listdir(d):
        if f.startswith(("project_v", "cur_v", "zone_v")):
            os.remove(os.path.join(d, f))
    img512 = np.asarray(Image.open(src).convert("RGB").resize((512, 512)))
    Image.fromarray(img512).save(os.path.join(d, "cur_v0.png"))
    with gpu:
        lab, labels = auto_segments(img512, mask)
    pieces = G.split_by_labels(base, lab)
    parts = []
    for L in labels:
        if L not in pieces:
            continue
        pid = f"p{len(parts)}"
        mk = (lab == L)
        Image.fromarray(mk.astype(np.uint8) * 255).save(os.path.join(pd, f"{pid}_mask.png"))
        pieces[L].export(os.path.join(pd, f"{pid}_v0.glb"))
        parts.append(dict(id=pid, name="Body" if L == 0 else f"Segment {L}", kind="tsr", glb=f"parts/{pid}_v0.glb",
                          mask=f"parts/{pid}_mask.png", parent=None if L == 0 else "p0", version=0,
                          sha=G.sha(os.path.join(pd, f"{pid}_v0.glb"))))
    meta = json.load(open(os.path.join(d, "meta.json")))
    P = dict(subject=meta.get("subject", ""), version=0, image="cur_v0.png", base=tag, parts=parts,
             history=[dict(version=0, action="base", part="p0", seconds=round(time.time() - t, 1),
                           info=f"split into {len(parts)} segments")])
    save_project(id, P)
    sec = round(time.time() - t, 1)
    save_meta(id, **{f"trellis_{tag}": dict(seconds=sec, model="TripoSR", faces=int(len(base.faces)))}, project=True)
    return dict(id=id, seconds=sec, pre=f"files/{id}/{tag}_pre.png", video=None, glb=f"files/{id}/{tag}.glb",
                project=project_view(id, P))


# ---------------------------------------------------------------- Projekte (erweiterbar)
def save_project(id, P):
    d = os.path.join(RUNS, id)
    json.dump(P, open(os.path.join(d, "project.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(P, open(os.path.join(d, f"project_v{P['version']}.json"), "w"), indent=1, ensure_ascii=False)


def load_project(id):
    p = os.path.join(RUNS, os.path.basename(id), "project.json")
    if not os.path.exists(p):
        raise HTTPException(404, "No project – create a 3D model first.")
    return json.load(open(p))


def project_view(id, P, prev=None):
    """Teile mit URLs und Prüfsummen-Check: 'unverändert' = Datei identisch zur Vorversion."""
    d = os.path.join(RUNS, id)
    before = {q["id"]: q for q in (prev or {}).get("parts", [])}
    parts = []
    for q in P["parts"]:
        cur = G.sha(os.path.join(d, q["glb"]))
        b = before.get(q["id"])
        state = "neu" if prev is not None and b is None else ("unverändert" if b is None or (b["sha"] == cur and b["glb"] == q["glb"]) else "geändert")
        parts.append(dict(q, url=f"files/{id}/{q['glb']}", mask_url=f"files/{id}/{q['mask']}", sha_now=cur,
                          intact=cur == q["sha"], state=state))
    return dict(id=id, version=P["version"], subject=P["subject"], image=f"files/{id}/{P['image']}", parts=parts,
                history=P["history"], sketch=f"files/{id}/sketch.json" if os.path.exists(os.path.join(d, "sketch.json")) else None)


@app.get("/project/{id}")
def project(id: str):
    id = os.path.basename(id)
    return project_view(id, load_project(id))


def read_new_strokes(raw):
    """PNG nur mit den neuen Strichen (transparent) → (RGB, Strich-Maske, Fläche, nur-farbig?)."""
    im = Image.open(io.BytesIO(raw)).convert("RGBA").resize((512, 512))
    a = np.asarray(im)
    alpha = a[..., 3] > 20
    rgb = a[..., :3]
    region = G.stroke_region(alpha)
    hsv = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2HSV)
    colored = alpha & (hsv[..., 1] > 60) & (hsv[..., 2] > 50)
    colored_only = alpha.sum() > 0 and (alpha & ~colored).sum() < 0.05 * alpha.sum()
    return rgb, alpha, colored, region, bool(colored_only)


def masks_of(d, P):
    return {q["id"]: np.asarray(Image.open(os.path.join(d, q["mask"]))) > 127 for q in P["parts"]}


def classify(g, masks):
    """Strichgruppe → Modus und Zielsegment.
    surface: komplett innerhalb des Umrisses → nur Oberfläche dieses Segments neu generieren (Form bleibt)
    replace: auf einem Segment, aber über den Umriss hinaus → genau dieses Segment neu generieren und ersetzen
    add:     überwiegend außerhalb der Figur → neues Teil am berührten Segment"""
    fg = np.zeros(g.shape, bool)
    for m in masks.values():
        fg |= m
    inner = cv2.erode(fg.astype(np.uint8), G.disk(3)).astype(bool)
    n = max(int(g.sum()), 1)
    on = {k: int((g & m).sum()) for k, m in masks.items()}
    target = max(on, key=on.get)
    if (g & inner).sum() >= 0.9 * n:
        return "surface", target
    if (g & fg).sum() >= 0.35 * n:
        # Rumpf (Wurzelsegment p0) nie komplett neu: innen → Oberfläche, außen → neues Teil
        return ("mixed" if target == "p0" else "replace"), target
    zone = cv2.dilate(g.astype(np.uint8), G.disk(14)).astype(bool)
    touch = {k: int((zone & m).sum()) for k, m in masks.items()}
    parent = max(touch, key=touch.get)
    if touch[parent] == 0:
        dist = {k: cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 5)[g].min() for k, m in masks.items()}
        parent = min(dist, key=dist.get)
    return "add", parent


MODE_DE = {"mixed": "on “{n}”: regenerate the surface, the protruding bit is attached as a new part",
           "surface": "regenerate the surface (color/pattern) of “{n}”, shape stays",
           "replace": "regenerate and replace segment “{n}”",
           "add": "generate a new part and attach it to “{n}”"}


@app.post("/plan")
async def plan(id: str = Form(...), newstrokes: UploadFile = File(...), action: str = Form("auto"), target: str = Form("")):
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    P = load_project(id)
    _, alpha, _, _, _ = read_new_strokes(await newstrokes.read())
    if not alpha.any():
        return dict(action=None, text="No new strokes.")
    masks = masks_of(d, P); names = {q["id"]: q["name"] for q in P["parts"]}
    show = np.zeros(alpha.shape, bool); items = []
    for g in G.stroke_groups(alpha) or [alpha]:
        mode, tgt = classify(g, masks)
        if action in MODE_DE:
            mode = action
        if target in masks:
            tgt = target
        show |= masks[tgt] if mode != "add" else G.stroke_region(g)
        items.append(dict(mode=mode, target=tgt, text=MODE_DE[mode].format(n=names[tgt])))
    Image.fromarray(show.astype(np.uint8) * 255).save(os.path.join(d, "plan_seg.png"))
    return dict(action="generate", items=items, target=items[0]["target"], seg_url=f"files/{id}/plan_seg.png?t={time.time():.3f}",
                text=" · ".join(i["text"] for i in items) + ". All other segments stay unchanged.")


def inpaint_region(cur, sketch_rgb, new_rgb, colored, M, prompt, seed, steps=20, scale=0.8, negative=NEG, strength=None, sharp=None):
    """Nur innerhalb Maske M neu malen; außerhalb bleibt jedes Pixel exakt wie vorher."""
    dark, col_all, _ = split_sketch(Image.fromarray(sketch_rgb))
    ctl = control_image(dark, col_all)
    init = cur.copy()
    if colored.any():  # Farbhinweise der neuen Striche weich ins Startbild
        ci = np.asarray(color_init(Image.fromarray(new_rgb), colored)).astype(np.float32)
        w = cv2.GaussianBlur(cv2.dilate(colored.astype(np.uint8), G.disk(6)).astype(np.float32), (0, 0), 8)[..., None]
        init = (init * (1 - w) + ci * w).astype(np.uint8)
    if sharp is not None:  # Oberfläche: Strichfarben scharf ins Startbild, damit die Farbe bleibt
        init[sharp] = new_rgb[sharp]
    pipe = inpaint()
    out = pipe(prompt, image=Image.fromarray(init), mask_image=Image.fromarray(M.astype(np.uint8) * 255), control_image=ctl,
               strength=strength if strength is not None else (0.88 if colored.any() else 1.0), num_inference_steps=steps, controlnet_conditioning_scale=scale,
               negative_prompt=negative, generator=torch.Generator("cpu").manual_seed(seed), guidance_scale=7.0).images[0]
    out = np.asarray(out.resize((512, 512))).astype(np.float32)
    soft = cv2.GaussianBlur(M.astype(np.float32), (0, 0), 2) * M  # 0 außerhalb von M
    return (cur * (1 - soft[..., None]) + out * soft[..., None]).round().astype(np.uint8)


def stroke_color_map(new_rgb, colored, M):
    """Zielfarbe je Pixel in M: Farbe des nächstliegenden farbigen Strichs (mehrere Farben in einer Gruppe bleiben getrennt)."""
    _, lab = cv2.distanceTransformWithLabels((~colored).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(colored)
    lut = np.zeros((lab.max() + 1, 3), np.uint8)
    lut[lab[ys, xs]] = new_rgb[ys, xs]
    out = np.zeros_like(new_rgb)
    out[M] = lut[lab[M]]
    return out


def recolor_keep_detail(img, M, target_rgb):
    """In M die Farbe (a/b in LAB) durch die Strichfarbe ersetzen, die Helligkeitsstruktur des Bildes (Schattierung,
    Flossenstrahlen, Fellstruktur) aber behalten: L = Strich-Helligkeit + Abweichung vom Mittelwert im Bereich.
    So wird aus „blau übermalt“ eine blaue Flosse mit Struktur statt einer flachen blauen Fläche."""
    if not M.any():
        return img
    L = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    T = cv2.cvtColor(target_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    out = L.copy()
    out[M, 0] = np.clip(T[M, 0] + (L[M, 0] - L[M, 0].mean()), 0, 255)
    out[M, 1:] = T[M, 1:]
    res = cv2.cvtColor(out.round().astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    soft = (cv2.GaussianBlur(M.astype(np.float32), (0, 0), 1.5) * M)[..., None]
    return (img * (1 - soft) + res * soft).round().astype(np.uint8)


def part_prompt(P, q, cn, part_text):
    subj = P["subject"] or "animal"
    name = (part_text.strip() or (q["name"] if q and not q["name"].startswith(("Segment", "Teil", "Part")) else "")).strip()
    what = f"{name} of a {subj}" if name else f"part of a {subj}, seamless continuation"
    return f"{cn + ' colored ' if cn else ''}{what}, same style, 3d render", name


NEG_PART = NEG + ", full body, whole animal, second animal, duplicate animal, extra head, extra legs, extra body, scene"


def new_mesh(mask, img, depth, seed):
    """Teil-Mesh aus Bildbereich: TripoSR auf dem Ausschnitt, dünne Teile aufblasen (Farben aus dem Bild)."""
    if G.is_thin(mask, 9):
        return G.inflate(mask, depth, rgb=img), "inflate"
    rgba = Image.fromarray(np.dstack([img, mask.astype(np.uint8) * 255]), "RGBA")
    with gpu:
        raw, _ = tsr_raw(rgba, seed)
    return G.place_tsr(raw, mask, depth), "tsr"


def save_part(d, q, nv, mesh=None, mask=None):
    if mask is not None:  # versioniert, sonst stimmt nach „Änderung zurück“ die Maske nicht mehr
        q["mask"] = f"parts/{q['id']}_mask_v{nv}.png"
        Image.fromarray(mask.astype(np.uint8) * 255).save(os.path.join(d, q["mask"]))
    if mesh is not None:
        q["glb"] = f"parts/{q['id']}_v{nv}.glb"; mesh.export(os.path.join(d, q["glb"]))
        q["version"] = nv; q["sha"] = G.sha(os.path.join(d, q["glb"]))


def do_group(d, P, nv, cur, sketch_rgb, new_rgb, g, colored, mode, tgt, part_text, seed, method, scale=0.8):
    """Eine Strichgruppe anwenden. Ändert nur das Zielsegment (bzw. legt ein neues Teil an). Gibt (Bild, Teil-ID, Info)."""
    masks = masks_of(d, P); byid = {q["id"]: q for q in P["parts"]}
    if mode == "mixed":
        tm = masks[tgt]
        inner = cv2.erode(tm.astype(np.uint8), G.disk(3)).astype(bool)
        gi, go = g & inner, g & ~inner
        infos, pid = [], tgt
        if gi.sum() >= 30:
            cur, pid, inf = do_group(d, P, nv, cur, sketch_rgb, new_rgb, gi, colored & gi, "surface", tgt, "", seed, method, scale); infos.append(inf)
        if go.sum() >= 30:
            cur, pid, inf = do_group(d, P, nv, cur, sketch_rgb, new_rgb, go, colored & cv2.dilate(go.astype(np.uint8), G.disk(2)).astype(bool),
                                     "add", tgt, part_text, seed + 100, method, scale); infos.append(inf)
        return cur, pid, "; ".join(infos)
    q = byid[tgt]; tm = masks[tgt]
    cn = color_name(np.median(new_rgb[colored], 0)) if colored.any() else ""
    region = G.stroke_region(g)
    if mode == "surface":
        M = cv2.dilate(g.astype(np.uint8), G.disk(5)).astype(bool) & tm
        if colored.any():
            # Farbige Striche = „dieses Teil in dieser Farbe“, nicht „flache Farbfläche“. Früher wurde die Strichfarbe
            # scharf ins Startbild kopiert (Struktur darunter weg) und nur mit Stärke 0.55 entrauscht → flache Fläche.
            # Jetzt: 1) umfärben mit erhaltener Struktur, 2) Inpainting ergänzt Details/Glanz, 3) Farbton wieder auf
            # die Strichfarbe festnageln (Struktur aus Schritt 2 bleibt).
            tgt_rgb = stroke_color_map(new_rgb, colored, M)
            name = part_text.strip() or ("" if q["name"].startswith(("Segment", "Teil", "Rumpf", "Part", "Body")) else q["name"])
            prompt = f"{cn} {name or 'surface'} of a {P['subject'] or 'animal'}, detailed natural texture, same style, 3d render"
            init = recolor_keep_detail(cur, M, tgt_rgb)
            with gpu:
                new = inpaint_region(init, sketch_rgb, new_rgb, np.zeros_like(colored), M, prompt, seed,
                                     negative=NEG_PART + ", flat color, plain, flat shading, paint blob", strength=0.5)
            new = recolor_keep_detail(new, M, tgt_rgb)
        else:
            prompt, _ = part_prompt(P, q, cn, part_text or "pattern")
            with gpu:
                new = inpaint_region(cur, sketch_rgb, new_rgb, colored, M, prompt, seed, negative=NEG_PART, strength=0.55, scale=scale)
        m0 = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
        m1, n = G.recolor_from_image(m0, M, new)
        save_part(d, q, nv, mesh=m1)
        return new, tgt, f"Surface of “{q['name']}” regenerated ({n} points, shape unchanged)"
    others = np.zeros(tm.shape, bool)
    for k, m in masks.items():
        if k != tgt:
            others |= m
    if mode == "replace":
        M = cv2.dilate((tm | region).astype(np.uint8), G.disk(6)).astype(bool)
    else:
        M = cv2.dilate(region.astype(np.uint8), G.disk(8)).astype(bool) & ~cv2.erode((others | tm).astype(np.uint8), G.disk(2)).astype(bool)
    prompt, name = part_prompt(P, q if mode == "replace" else None, cn, part_text)
    if method == "fast":
        new = cur.copy()
        if colored.any():
            new[region & ~tm if mode == "add" else region] = np.median(new_rgb[colored], 0).astype(np.uint8)
        pm = region | (tm if mode == "replace" else False)
    else:
        with gpu:
            try:
                new = inpaint_region(cur, sketch_rgb, new_rgb, colored, M, prompt, seed, negative=NEG_PART, scale=scale)
                _, sess = tsr()
                fg_new = np.asarray(foreground(Image.fromarray(new), sess))[..., 3] > 127
            except torch.cuda.OutOfMemoryError:
                free(); raise HTTPException(507, "GPU memory full (home PC).")
        pm = G.keep_components(fg_new & M & ~cv2.erode(others.astype(np.uint8), G.disk(3)).astype(bool), 100)
        if mode == "add":
            pm &= ~tm
        if pm.sum() < 150:
            pm = (region | tm) if mode == "replace" else region
    if mode == "replace":
        old = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
        depth = float(np.median(np.asarray(old.vertices)[:, 0]))
        mesh, kind = new_mesh(pm, new, depth, seed)
        q["kind"] = kind
        save_part(d, q, nv, mesh=mesh, mask=pm)
        if part_text.strip():
            q["name"] = part_text.strip()
        return new, tgt, f"Segment “{q['name']}” regenerated and replaced ({'TripoSR' if kind == 'tsr' else 'inflated'}, depth {depth:+.2f})"
    pmesh = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
    depth, nc = G.contact_depth(pmesh, pm, tm)
    mesh, kind = new_mesh(pm, new, depth, seed)
    pid = f"p{max(int(x['id'][1:]) for x in P['parts']) + 1}"
    nq = dict(id=pid, name=name or f"Part {len(P['parts'])}", kind=kind, parent=tgt, mask=f"parts/{pid}_mask.png")
    save_part(d, nq, nv, mesh=mesh, mask=pm)
    P["parts"].append(nq)
    return new, pid, f"new part “{nq['name']}” on “{q['name']}” ({'TripoSR' if kind == 'tsr' else 'inflated'}, {nc} contact points)"


@app.post("/edit")
async def edit(id: str = Form(...), sketch: UploadFile = File(...), newstrokes: UploadFile = File(...),
               strokes: str = Form(""), action: str = Form("auto"), target: str = Form(""), method: str = Form("auto"),
               part_text: str = Form(""), seed: int = Form(7), scale: float = Form(0.8)):
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    await sketch.read()  # ganze Skizze nur noch zur Ablage (sketch.json); siehe unten
    new_rgb, alpha, colored, _, _ = read_new_strokes(await newstrokes.read())
    # ControlNet-Steuerbild beim Bearbeiten NUR aus den neuen Strichen. Die alten Striche passen oft nicht zum Projektbild
    # (KI hat Form/Richtung frei interpretiert) und zogen dann falsche Linien in den bearbeiteten Bereich. Die Form der
    # vorhandenen Figur steckt ohnehin im aktuellen Bild.
    sketch_rgb = np.where(alpha[..., None], new_rgb, 255).astype(np.uint8)
    if not alpha.any():
        raise HTTPException(400, "No new strokes.")
    t = time.time()
    with plock:
        P = load_project(id); prev = json.loads(json.dumps(P))
        cur = np.asarray(Image.open(os.path.join(d, P["image"])).convert("RGB")).copy()
        nv = P["version"] + 1
        groups = G.stroke_groups(alpha) or [alpha]
        infos, changed, plan_items = [], [], []
        for gi, g in enumerate(groups):
            mode, tgt = classify(g, masks_of(d, P))
            if action in MODE_DE:
                mode = action
            if target in {q["id"] for q in P["parts"]}:
                tgt = target
            col = colored & cv2.dilate(g.astype(np.uint8), G.disk(2)).astype(bool)
            cur, pid, inf = do_group(d, P, nv, cur, sketch_rgb, new_rgb, g, col, mode, tgt,
                                     part_text if len(groups) == 1 else "", seed + gi, method, scale)
            infos.append(inf); changed.append(pid); plan_items.append(dict(mode=mode, target=tgt))
        Image.fromarray(cur).save(os.path.join(d, f"cur_v{nv}.png"))
        P["image"] = f"cur_v{nv}.png"; P["version"] = nv
        sec = round(time.time() - t, 1); info = " | ".join(infos)
        P["history"].append(dict(version=nv, action="+".join(i["mode"] for i in plan_items), part=",".join(changed),
                                 method=method, seconds=sec, gpu=method != "fast", info=info))
        if strokes:
            open(os.path.join(d, "sketch.json"), "w").write(strokes)
        save_project(id, P)
    view = project_view(id, P, prev)
    return dict(view, plan=plan_items, changed=changed[-1], changed_all=changed, seconds=sec, info=info, gpu=method != "fast")


@app.post("/part_rename")
def part_rename(id: str = Form(...), part: str = Form(...), name: str = Form(...)):
    id = os.path.basename(id)
    with plock:
        P = load_project(id)
        for q in P["parts"]:
            if q["id"] == part:
                q["name"] = name.strip()[:40] or q["name"]
        json.dump(P, open(os.path.join(RUNS, id, "project.json"), "w"), indent=1, ensure_ascii=False)
    return project_view(id, P)


@app.post("/undo")
def undo(id: str = Form(...)):
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    with plock:
        P = load_project(id)
        if P["version"] == 0:
            raise HTTPException(400, "Nothing to undo.")
        Q = json.load(open(os.path.join(d, f"project_v{P['version'] - 1}.json")))
        json.dump(Q, open(os.path.join(d, "project.json"), "w"), indent=1, ensure_ascii=False)
    return project_view(id, Q)


@app.post("/part_delete")
def part_delete(id: str = Form(...), part: str = Form(...)):
    id = os.path.basename(id)
    with plock:
        P = load_project(id); prev = json.loads(json.dumps(P))
        if part == "p0":
            raise HTTPException(400, "The body cannot be deleted.")
        gone = next(q for q in P["parts"] if q["id"] == part)
        P["parts"] = [q for q in P["parts"] if q["id"] != part]
        for q in P["parts"]:
            if q["parent"] == part:
                q["parent"] = gone["parent"]
        P["version"] += 1
        P["history"].append(dict(version=P["version"], action="delete", part=part, seconds=0, gpu=False, info=gone["name"]))
        save_project(id, P)
    return project_view(id, P, prev)


# ---------------------------------------------------------------- Studio: Radieren, Bereiche, Segmente, Export
def read_mask(raw):
    """PNG (Alpha oder helle Pixel = Bereich) → 512²-Bool-Maske."""
    a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGBA").resize((512, 512), Image.NEAREST))
    m = a[..., 3] > 20
    if m.all():  # deckendes PNG: helle Pixel
        m = a[..., :3].mean(-1) > 127
    return m


def fg_of(masks):
    fg = np.zeros((512, 512), bool)
    for m in masks.values():
        fg |= m
    return fg


def remove_parts(P, gone):
    """Teile aus dem Projekt nehmen, Kinder an den Elternteil hängen."""
    byid = {q["id"]: q for q in P["parts"]}
    for pid in gone:
        for q in P["parts"]:
            if q["parent"] == pid:
                q["parent"] = byid[pid]["parent"]
    P["parts"] = [q for q in P["parts"] if q["id"] not in gone]


def erase_in(d, P, nv, cur, E):
    """Geometrie aller Teile, deren Projektion in E liegt, entfernen (ganze Tiefe), Bild dort weiß. → (Bild, Infos)"""
    masks = masks_of(d, P)
    gone, info = [], []
    for q in P["parts"]:
        m = masks[q["id"]]
        if not (m & E).any():
            continue
        mesh = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
        C = np.asarray(mesh.triangles_center)
        u, v = G.world_to_px(C)
        ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
        rest = G.keep_faces(mesh, ~E[vi, ui])
        nm = m & ~E
        if rest is None or nm.sum() < 40:
            gone.append(q["id"]); info.append(f"“{q['name']}” removed")
            continue
        if rest is not mesh:
            save_part(d, q, nv, mesh=rest, mask=nm)
            info.append(f"“{q['name']}” erased")
    cur = cur.copy()
    cur[E & fg_of(masks)] = 255
    remove_parts(P, gone)
    return cur, info


def commit(d, id, P, prev, nv, cur, action, part, info, t, gpu_used=False):
    if not P["parts"]:
        raise HTTPException(400, "Nothing would be left. “New” starts an empty sketch.")
    Image.fromarray(cur).save(os.path.join(d, f"cur_v{nv}.png"))
    P["image"] = f"cur_v{nv}.png"; P["version"] = nv
    sec = round(time.time() - t, 1)
    P["history"].append(dict(version=nv, action=action, part=part, seconds=sec, gpu=gpu_used, info=info))
    save_project(id, P)
    return dict(project_view(id, P, prev), seconds=sec, info=info, changed=part)


@app.post("/erase")
async def erase(id: str = Form(...), mask: UploadFile = File(...), strokes: str = Form("")):
    """Radierer im Bild = Radierer im Modell: alles, was in der Projektion unter dem Radierstrich liegt, verschwindet."""
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    E = read_mask(await mask.read())
    if E.sum() < 10:
        raise HTTPException(400, "Nothing erased.")
    t = time.time()
    with plock:
        P = load_project(id); prev = json.loads(json.dumps(P)); nv = P["version"] + 1
        cur = np.asarray(Image.open(os.path.join(d, P["image"])).convert("RGB"))
        cur, info = erase_in(d, P, nv, cur, E)
        if not info:
            raise HTTPException(400, "There is no model under the eraser.")
        if strokes:
            open(os.path.join(d, "sketch.json"), "w").write(strokes)
        return commit(d, id, P, prev, nv, cur, "erase", "", ", ".join(info), t)


@app.post("/erase3d")
def erase3d(id: str = Form(...), part: str = Form(...), points: str = Form(...), radius: float = Form(0.05)):
    """Radierer im 3D-Fenster: Flächen eines Teils in Kugeln um die getroffenen Punkte entfernen (von jeder Seite)."""
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    pts = json.loads(points)
    t = time.time()
    with plock:
        P = load_project(id); prev = json.loads(json.dumps(P)); nv = P["version"] + 1
        q = next((x for x in P["parts"] if x["id"] == part), None)
        if q is None or not pts:
            raise HTTPException(400, "Part not found.")
        mesh = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
        hit = G.faces_in_spheres(mesh, pts, max(0.005, min(radius, 0.5)))
        if not hit.any():
            raise HTTPException(400, "Nothing hit.")
        rest = G.keep_faces(mesh, ~hit)
        cur = np.asarray(Image.open(os.path.join(d, P["image"])).convert("RGB")).copy()
        old = np.asarray(Image.open(os.path.join(d, q["mask"]))) > 127
        if rest is None:
            remove_parts(P, [q["id"]]); nm = np.zeros_like(old); info = f"“{q['name']}” removed"
        else:
            nm = G.mask_from_mesh(rest) & cv2.dilate(old.astype(np.uint8), G.disk(2)).astype(bool)
            save_part(d, q, nv, mesh=rest, mask=nm); info = f"“{q['name']}”: {int(hit.sum())} faces erased"
        others = fg_of({k: m for k, m in masks_of(d, P).items() if k != q["id"]})
        cur[old & ~nm & ~others] = 255  # im Bild nur dort weiß, wo jetzt wirklich nichts mehr ist
        return commit(d, id, P, prev, nv, cur, "erase3d", q["id"] if rest is not None else "", info, t)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)


@app.post("/region")
async def region(id: str = Form(...), op: str = Form(...), mask: UploadFile | None = File(None), parts: str = Form(""),
                 color: str = Form(""), text: str = Form(""), seed: int = Form(11), scale: float = Form(0.8),
                 strength: float = Form(0.95), colors: str = Form("")):
    """Ausgewählter Bereich (Lasso-Maske und/oder Segmente) → recolor | restyle | replace | delete.
    recolor: Farbe tauschen, Struktur bleibt (ohne KI, < 1 s). restyle: Oberfläche per Prompt neu, Form bleibt.
    replace: Bereich per Prompt neu generieren und als eigenes Teil einsetzen. delete: wie Radieren."""
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    raw = await mask.read() if mask is not None else b""
    t = time.time()
    with plock:
        P = load_project(id); prev = json.loads(json.dumps(P)); nv = P["version"] + 1
        masks = masks_of(d, P); fg = fg_of(masks)
        M = read_mask(raw) if raw else np.zeros((512, 512), bool)
        sel = [p for p in parts.split(",") if p in masks]
        for p in sel:
            M |= masks[p]
        if M.sum() < 20:
            raise HTTPException(400, "Select an area first.")
        cur = np.asarray(Image.open(os.path.join(d, P["image"])).convert("RGB")).copy()
        subj = P["subject"] or "animal"
        hit = [q for q in P["parts"] if (masks[q["id"]] & M).any()]
        names = ", ".join(f"“{q['name']}”" for q in hit) or "area"
        if op == "delete":
            cur, info = erase_in(d, P, nv, cur, M)
            return commit(d, id, P, prev, nv, cur, "delete", "", ", ".join(info) or "nichts getroffen", t)
        if op in ("recolor", "restyle", "palette"):
            M2 = M & fg
            if op == "palette":
                try:
                    cols = [(hex_rgb(c["hex"]), float(c.get("share", 1))) for c in json.loads(colors or "[]")]
                except (ValueError, KeyError, TypeError):
                    raise HTTPException(400, "Invalid color list.")
                if not cols:
                    raise HTTPException(400, "Color list missing.")
                # Maskenränder sind leicht erodiert → 2 px nachfassen, sonst bleibt ein Saum in der alten Farbe
                M2 = cv2.dilate(M2.astype(np.uint8), G.disk(2)).astype(bool) & fg
                new = palette_recolor(cur, M2, cols, keep_dark=keep_dark(text))
                tot = sum(max(w, 0.01) for _, w in cols)
                info = f"{names}: " + ", ".join(f"#{bytes(int(v) for v in c).hex()} {round(100 * max(w, 0.01) / tot)}%" for c, w in cols) + " (pattern kept)"
            elif op == "recolor":
                if not color:
                    raise HTTPException(400, "Color missing.")
                new = G_recolor(cur, M2, hex_rgb(color))
                info = f"{names}: color {color} (structure kept)"
            else:
                if not text.strip():
                    raise HTTPException(400, "Describe how it should look.")
                blank = np.full_like(cur, 255)
                prompt = f"{text.strip()}, {subj}, detailed natural texture, same style, 3d render"
                # SD-Inpainting „heilt“ den Bereich gern zurück zur Umgebungsfarbe und ignoriert Farbwörter. Deshalb:
                # Farbe aus dem Prompt zuerst umfärben (Struktur bleibt), dann Muster per Inpainting, dann Farbton zur
                # Hälfte wieder festnageln (weiße Punkte o. ä. aus dem Inpainting bleiben dabei hell).
                rgb = prompt_color(text)
                init = G_recolor(cur, M2, rgb) if rgb is not None else cur
                with gpu:
                    new = inpaint_region(init, blank, blank, np.zeros(M2.shape, bool), M2, prompt, seed, negative=NEG_PART + ", flat color",
                                         strength=max(0.3, min(strength if rgb is None else 0.75, 1.0)), scale=0.0)
                if rgb is not None:
                    new = ((new.astype(np.float32) + G_recolor(new, M2, rgb).astype(np.float32)) / 2).round().astype(np.uint8)
                info = f"{names}: surface “{text.strip()}” (shape kept)"
            for q in hit:
                m0 = trimesh.load(os.path.join(d, q["glb"]), force="mesh")
                m1, n = G.recolor_through(m0, M2, new)
                if n:
                    save_part(d, q, nv, mesh=m1)
            return commit(d, id, P, prev, nv, new, op, ",".join(q["id"] for q in hit), info, t, op == "restyle")
        if op == "replace":
            if not text.strip():
                raise HTTPException(400, "Describe what should replace the area.")
            Md = cv2.dilate(M.astype(np.uint8), G.disk(6)).astype(bool)
            # Tiefe: wo saß die alte Geometrie?
            depth, n = 0.0, 0
            for q in hit:
                V = np.asarray(trimesh.load(os.path.join(d, q["glb"]), force="mesh").vertices)
                u, v = G.world_to_px(V)
                s_ = M[np.clip(v.round().astype(int), 0, 511), np.clip(u.round().astype(int), 0, 511)]
                if s_.any():
                    depth += float(np.median(V[s_, 0])) * s_.sum(); n += int(s_.sum())
            depth = depth / n if n else 0.0
            line = np.full_like(cur, 255)
            prompt = f"{text.strip()} of a {subj}, same style, 3d render"
            with gpu:
                try:
                    new = inpaint_region(cur, line, line, np.zeros(M.shape, bool), Md, prompt, seed, negative=NEG_PART,
                                         strength=1.0, scale=0.0)
                    _, sess = tsr()
                    fg_new = np.asarray(foreground(Image.fromarray(new), sess))[..., 3] > 127
                except torch.cuda.OutOfMemoryError:
                    free(); raise HTTPException(507, "GPU memory full (home PC).")
            pm = G.keep_components(fg_new & Md, 80)
            cur2, _ = erase_in(d, P, nv, cur, M)
            if pm.sum() < 80:
                return commit(d, id, P, prev, nv, cur2, "replace", "", f"{names} removed; the AI generated nothing there", t, True)
            new = np.where(Md[..., None], new, cur2)
            mesh, kind = new_mesh(pm, new, depth, seed)
            pid = f"p{max([int(x['id'][1:]) for x in P['parts']] + [-1]) + 1}"
            par = hit[0]["id"] if hit and any(x["id"] == hit[0]["id"] for x in P["parts"]) else (P["parts"][0]["id"] if P["parts"] else None)
            nq = dict(id=pid, name=text.strip()[:40], kind=kind, parent=par, mask=f"parts/{pid}_mask.png")
            save_part(d, nq, nv, mesh=mesh, mask=pm)
            P["parts"].append(nq)
            return commit(d, id, P, prev, nv, new, "replace", pid, f"{names} replaced by “{text.strip()}”", t, True)
        raise HTTPException(400, f"Unknown action {op}")


COLOR_WORDS = {"violet": "purple", "lila": "purple", "rot": "red", "blau": "blue", "grün": "green", "gelb": "yellow",
               "schwarz": "black", "weiß": "white", "rosa": "pink", "braun": "brown", "grau": "gray", "grey": "gray",
               "türkis": "light blue", "cyan": "light blue", "turquoise": "light blue", "golden": "yellow", "gold": "yellow"}


def prompt_color(text):
    """Erstes Farbwort im Prompt (englisch/deutsch) → RGB, sonst None. „white dots“ zählt nicht als Grundfarbe."""
    import re
    words = re.findall(r"[a-zäöüß]+(?: blue)?", text.lower())
    for i, w in enumerate(words):
        n = COLOR_WORDS.get(w, w)
        nxt = words[i + 1] if i + 1 < len(words) else ""
        if n in NAMES and nxt not in ("dots", "spots", "stripes", "dot", "spot", "stripe", "punkte", "streifen", "flecken"):
            return np.array(NAMES[n], np.uint8)
    return None


def keep_dark(text):
    """Dark veins/outlines stay dark unless the request explicitly asks to recolor them."""
    t = (text or "").lower()
    return not any(w in t for w in ("vein", "outline", "border", "edge", "black"))


def palette_recolor(cur, M, cols, keep_dark=True):
    """Recolor area M with several colors and shares (e.g. 70 % blue, 30 % green) while keeping the existing
    pattern: pixels are ordered by a smooth feature (main color axis of the current pattern + distance from the
    body axis), quantile bands of that order get the colors by share, band edges are blended softly, and the
    brightness structure (shading, veins, scales) is kept via recolor_keep_detail. Dark veins/edges stay dark."""
    if not M.any() or not cols:
        return cur
    lab = cv2.cvtColor(cur, cv2.COLOR_RGB2LAB).astype(np.float32)
    R = M & (lab[..., 0] > 60) if keep_dark else M.copy()
    if R.sum() < 50:
        R = M.copy()
    blur = cv2.GaussianBlur(lab, (0, 0), 4)
    F = blur[R]
    c = F - F.mean(0)
    _, _, vt = np.linalg.svd(c[:: max(1, len(c) // 20000)], full_matrices=False)
    ax = vt[0] if vt[0][0] >= 0 else -vt[0]          # bright side = high score (deterministic orientation)
    col_s = c @ ax
    col_s = (col_s - col_s.mean()) / (col_s.std() + 1e-6)
    ys, xs = np.nonzero(R)
    cx = np.nonzero(M.any(0))[0]; cx = (cx.min() + cx.max()) / 2 if len(cx) else 256
    rad = np.hypot(xs - cx, (ys - ys.mean()) * 0.6)
    rad = (rad - rad.mean()) / (rad.std() + 1e-6)
    score = 0.55 * col_s + 0.45 * rad
    shares = np.array([max(w, 0.01) for _, w in cols], np.float64); shares /= shares.sum()
    # dominant color on the inside (near the body), the others towards the edges/tips
    order = np.argsort(-shares)
    rank = np.empty(len(score), np.int64); rank[np.argsort(score, kind="stable")] = np.arange(len(score))
    q = rank / max(len(score) - 1, 1)
    edges = np.cumsum(shares[order])
    band = np.searchsorted(edges, q, side="left").clip(0, len(order) - 1)
    rgb = np.array([cols[i][0] for i in order], np.float32)
    tgt = np.zeros(cur.shape, np.float32); wsum = np.zeros(M.shape, np.float32)
    tgt[ys, xs] = rgb[band]; wsum[ys, xs] = 1
    # soft band transitions (only inside the area)
    k = 5
    tb = cv2.GaussianBlur(tgt, (0, 0), k); wb = cv2.GaussianBlur(wsum, (0, 0), k)
    full = np.where(wb[..., None] > 1e-3, tb / np.maximum(wb[..., None], 1e-3), tgt)
    full[~R] = tgt[~R]
    out = recolor_keep_detail(cur, R, full.round().clip(0, 255).astype(np.uint8))
    return out


def G_recolor(cur, M, rgb):
    return recolor_keep_detail(cur, M, np.broadcast_to(rgb, cur.shape).copy())


@app.post("/segment_at")
def segment_at(id: str = Form(...), x: int = Form(...), y: int = Form(...)):
    """Zauberstab: SAM-Segment unter dem Punkt im aktuellen Bild (nur innerhalb der Figur)."""
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    P = load_project(id)
    fg = fg_of(masks_of(d, P))
    cur = np.asarray(Image.open(os.path.join(d, P["image"])).convert("RGB"))
    with gpu:
        ms, sc = sam_segment(cur, [[int(x), int(y)]])
    best, bs = None, -1.0
    for m, s_ in zip(ms, sc):
        m = m & fg
        if 30 < m.sum() < 0.85 * max(fg.sum(), 1) and s_ > bs:
            best, bs = m, float(s_)
    if best is None:
        raise HTTPException(404, "No segment under the point.")
    name = f"sel_{int(time.time() * 1000)}.png"
    Image.fromarray(best.astype(np.uint8) * 255).save(os.path.join(d, name))
    return dict(mask=f"files/{id}/{name}", score=round(bs, 3), area=int(best.sum()))


def matte_glb(data):
    """GLB ohne Material wäre in three.js voll metallisch (dunkel) → mattes, beidseitiges Material eintragen."""
    import struct
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    js["materials"] = [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.85},
                        "doubleSided": True, "name": "matt"}]
    for m in js.get("meshes", []):
        for pr in m.get("primitives", []):
            pr["material"] = 0
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    rest = data[20 + n:]
    body = struct.pack("<II", len(j), 0x4E4F534A) + j + rest
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


@app.get("/export/{id}")
def export(id: str):
    """Alle Teile als ein GLB (für den Canvas / zum Herunterladen)."""
    from fastapi.responses import Response
    id = os.path.basename(id); d = os.path.join(RUNS, id)
    P = load_project(id)
    meshes = [trimesh.load(os.path.join(d, q["glb"]), force="mesh") for q in P["parts"]]
    out = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    data = matte_glb(out.export(file_type="glb"))
    return Response(data, media_type="model/gltf-binary",
                    headers={"Content-Disposition": f'attachment; filename="{(P["subject"] or "model").replace(" ", "_")}_v{P["version"]}.glb"'})


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
