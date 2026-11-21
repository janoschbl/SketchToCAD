"""Inferenz-Server fuer das Skizze->3D-Lab (Port 8781). POST /predict, GET /sample, GET /health."""
import base64, io, json, math, os, time, numpy as np, torch
from fastapi import FastAPI, File, Form, UploadFile
from PIL import Image
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from model import Net

R, LIM, S = 64, 1.02, 2 * 1.02 / 64
HERE = os.path.dirname(os.path.abspath(__file__)); RUN = os.environ.get("RUN", "runs/base"); dev = "cuda"
net = Net(32).to(dev); net.load_state_dict(torch.load(f"{HERE}/{RUN}/best.pt", map_location=dev)); net.eval()
meta = json.load(open(f"{HERE}/data/meta.json")); sk = np.load(f"{HERE}/data/sketch128.npy", mmap_mode="r")
vox = np.load(f"{HERE}/data/voxels64.npz")["vox"]; test_idx = [i for i, m in enumerate(meta) if m["split"] == "test"]
app = FastAPI()

def forward(ink128, az, el):                                  # ink128: 128x128 float, Tinte = 1
    r = math.radians(az); v = torch.tensor([math.sin(r), math.cos(r), (el - 25) / 10], device=dev)
    x = torch.cat([torch.from_numpy(ink128).float().to(dev)[None, None], v.view(1, 3, 1, 1).expand(-1, -1, 128, 128)], 1)
    t = time.time()
    with torch.no_grad(), torch.autocast("cuda", torch.float16): lg = net(x)
    lg = lg[0, 0].float().cpu().numpy(); return lg, (time.time() - t) * 1000

def mesh(field, level, sigma):
    f = ndi.gaussian_filter(field.astype(np.float32), sigma) if sigma else field.astype(np.float32)
    f = np.pad(f, 1, constant_values=f.min() - 1 if level == 0 else 0)
    if f.max() <= level or f.min() >= level: return dict(v="", f="", n=0)
    v, fc, _, _ = marching_cubes(f, level, spacing=(S, S, S))
    v = (v - 0.5 * S - LIM).astype(np.float32); fc = fc.astype(np.int32)
    return dict(v=base64.b64encode(v.tobytes()).decode(), f=base64.b64encode(fc.tobytes()).decode(), n=len(fc))

def ink_from_png(data):
    im = Image.open(io.BytesIO(data)).convert("L").resize((256, 256), Image.BOX)
    return np.asarray(Image.fromarray(255 - np.asarray(im)).resize((128, 128), Image.BOX), dtype=np.float32) / 255

@app.get("/health")
def health(): return dict(ok=True, run=RUN, gpu=torch.cuda.get_device_name(0), test_sketches=len(test_idx))

@app.post("/predict")
async def predict(image: UploadFile = File(...), az: float = Form(...), el: float = Form(...)):
    t0 = time.time(); lg, ms = forward(ink_from_png(await image.read()), az, el)
    return dict(mesh=mesh(lg, 0, 0.6), ms_model=ms, ms_total=(time.time() - t0) * 1000, fill=float((lg > 0).mean()))

@app.get("/sample")
def sample(seed: int = 0):
    i = test_idx[int(np.random.default_rng(seed).integers(len(test_idx)))]; m = meta[i]
    lg, ms = forward(np.asarray(sk[i], dtype=np.float32) / 255, m["az"], m["el"])
    gt = vox[m["asset_idx"]] > 0; p = lg > 0; iou = float((p & gt).sum() / max((p | gt).sum(), 1))
    buf = io.BytesIO(); Image.fromarray(255 - np.asarray(sk[i])).resize((256, 256), Image.BICUBIC).save(buf, "PNG")
    return dict(name=m["asset"], category=m["category"], az=m["az"], el=m["el"], iou=iou, ms_model=ms,
                sketch="data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                mesh=mesh(lg, 0, 0.6), gt=mesh(gt, 0.5, 0.7))
