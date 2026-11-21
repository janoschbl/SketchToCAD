"""Inferenz-Server für LiftNet (blickausgerichtet), gleiche API wie serve.py (Port 8781).

Die Vorhersage liegt im Kamerasystem [Tiefe, Zeile, Spalte]; für die Anzeige wird sie mit dem gewählten
Blickwinkel (az, el; Z oben, Kamera bei (cos az cos el, sin az cos el, sin el)) in Weltkoordinaten gedreht.
  RUN=runs/real_v1 uvicorn serve_v2:app --port 8781
"""
import base64, io, json, math, os, time, numpy as np, torch
from fastapi import FastAPI, File, Form, UploadFile
from PIL import Image
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from model_v2 import LiftNet

HERE = os.path.dirname(os.path.abspath(__file__)); RUN = os.environ.get("RUN", "runs/real_v1"); DATA = os.environ.get("DATA", "data_real")
dev = "cuda" if torch.cuda.is_available() else "cpu"
net = LiftNet().to(dev); CKPT = os.environ.get("CKPT", "best.pt")
net.load_state_dict({k: v.float() for k, v in torch.load(f"{HERE}/{RUN}/{CKPT}", map_location=dev).items()}); net.eval()
meta = [m for m in json.load(open(f"{HERE}/{DATA}/meta.json")) if "error" not in m]
test = [m for m in meta if m["split"] == "test" and m["iou"] >= 0.85]
X = np.load(f"{HERE}/{DATA}/sketch128.npy", mmap_mode="r"); VP = np.load(f"{HERE}/{DATA}/vox64_packed.npy", mmap_mode="r")
app = FastAPI()


def crop_ink(ink, n=128, margin=1.2, thr=0.08):
    ys, xs = np.nonzero(ink > thr)
    if len(xs) < 5:
        return np.zeros((n, n), np.float32)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    s = margin * max(x1 - x0, y1 - y0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; P = int(s)
    big = np.pad(ink.astype(np.float32), P)
    if s / n > 1.5:
        big = ndi.maximum_filter(big, size=int(round(s / n * 0.6)) | 1)
    a = np.asarray(Image.fromarray(big, "F").resize((n, n), Image.BOX, box=(cx - s / 2 + P, cy - s / 2 + P, cx + s / 2 + P, cy + s / 2 + P)))
    return np.clip(a / max(a.max(), 1e-6), 0, 1).astype(np.float32)


def forward(ink128):
    x = torch.from_numpy(ink128).float().to(dev)[None, None]
    t = time.time()
    with torch.no_grad(), torch.autocast(dev, torch.float16, enabled=dev == "cuda"):
        lg = net(x)
    return lg[0, 0].float().cpu().numpy(), (time.time() - t) * 1000


BALL = ndi.generate_binary_structure(3, 1)


def solidify(lg, keep_frac=0.15, close_iter=1):
    """Feste Struktur ohne Training: Krümel weg, Löcher zu, Hohlräume füllen.
    1. Schließen (1 Voxel): kleine Löcher in Wänden schließen
    2. Zusammenhangskomponenten: nur Teile >= keep_frac x größtes Teil behalten (keine schwebenden Klumpen)
    3. Innere Hohlräume füllen (Körper werden massiv, wie im Training)
    Gibt ein Logit-Feld zurück, damit marching cubes weiter glatt bleibt."""
    p = lg > 0
    if not p.any():
        return lg
    pc = ndi.binary_closing(np.pad(p, 2), BALL, iterations=close_iter)[2:-2, 2:-2, 2:-2] | p
    lab, n = ndi.label(pc, ndi.generate_binary_structure(3, 3))
    if n > 1:
        sz = np.bincount(lab.ravel())[1:]
        pc = np.isin(lab, 1 + np.nonzero(sz >= keep_frac * sz.max())[0])
    pc = ndi.binary_fill_holes(pc)
    out = lg.copy()
    out[pc & (lg <= 0)] = 0.5                            # geschlossene Löcher / Hohlräume -> knapp innen
    out[~pc & (lg > 0)] = -0.5                           # entfernte Krümel -> knapp außen
    return out


def basis(az, el):
    a, e = math.radians(az), math.radians(el)
    C = np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
    f = -C; r = np.cross(f, [0, 0, 1.0])
    if np.linalg.norm(r) < 1e-6: r = np.cross(f, [0, 1.0, 0])
    r /= np.linalg.norm(r); d = np.cross(f, r)
    return r, d, f


def mesh(field, level, sigma, az, el):
    f = ndi.gaussian_filter(field.astype(np.float32), sigma) if sigma else field.astype(np.float32)
    f = np.pad(f, 1, constant_values=f.min() - 1 if level == 0 else 0)
    if f.max() <= level or f.min() >= level:
        return dict(v="", f="", n=0)
    v, fc, _, _ = marching_cubes(f, level)
    v = (v - 1 + 0.5) / 64 * 2 - 1                      # -> [-1,1]: (Tiefe, Zeile, Spalte)
    r, d, fw = basis(az, el)
    w = v[:, 2:3] * r + v[:, 1:2] * d + v[:, 0:1] * fw   # Spalte = rechts, Zeile = unten, Tiefe = vorwärts
    fc = fc[:, ::-1].copy()                              # Umlaufsinn nach Achsentausch korrigieren
    return dict(v=base64.b64encode(w.astype(np.float32).tobytes()).decode(), f=base64.b64encode(fc.astype(np.int32).tobytes()).decode(), n=len(fc))


@app.get("/health")
def health():
    return dict(ok=True, run=RUN, model="LiftNet (blickausgerichtet)", gpu=torch.cuda.get_device_name(0) if dev == "cuda" else "cpu", test_sketches=len(test))


@app.post("/predict")
async def predict(image: UploadFile = File(...), az: float = Form(35), el: float = Form(25), solid: int = Form(1)):
    t0 = time.time()
    im = Image.open(io.BytesIO(await image.read())).convert("L")
    ink = 1 - np.asarray(im, np.float32) / 255
    lg, ms = forward(crop_ink(ink))
    if solid: lg = solidify(lg)
    return dict(mesh=mesh(lg, 0, 0.6, az, el), ms_model=ms, ms_total=(time.time() - t0) * 1000, fill=float((lg > 0).mean()))


@app.get("/sample")
def sample(seed: int = 0, solid: int = 1):
    m = test[int(np.random.default_rng(seed).integers(len(test)))]
    lg, ms = forward(np.asarray(X[m["i"]], np.float32) / 255)
    gt = np.unpackbits(np.asarray(VP[m["v"]])).reshape(64, 64, 64) > 0
    if solid: lg = solidify(lg)
    p = lg > 0; iou = float((p & gt).sum() / max((p | gt).sum(), 1))
    buf = io.BytesIO(); Image.fromarray(255 - np.asarray(X[m["i"]])).resize((256, 256), Image.BICUBIC).save(buf, "PNG")
    az, el = m["az"], m["el"]
    return dict(name=f"{m['obj']} · {m['tag']}", category=m["src"], az=round(az), el=round(el), iou=iou, ms_model=ms,
                sketch="data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                mesh=mesh(lg, 0, 0.6, round(az), round(el)), gt=mesh(gt, 0.5, 0.7, round(az), round(el)))
