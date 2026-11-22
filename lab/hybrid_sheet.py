"""Kontaktbogen: Skizze | Vorhersage (Voxel) | Fit (CAD) | Ziel, gleiche Ansicht (az 35, el 25)."""
import json, math, numpy as np, trimesh
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from sketchgen import render as rnd
from hybrid_fit import clean, N
meta = json.load(open("data_real/ood/meta.json")); rep = json.load(open("out/hybrid/fit/report.json"))
P = np.load("out/hybrid/pred_world.npy").astype(np.float32); T = np.load("out/hybrid/gt_world.npy"); X = np.load("data_real/ood/sketch128.npy")
S = 256; R_ = rnd.Renderer(S, S)
a, e = math.radians(35), math.radians(25); C = 3.6 * np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
f = -C / np.linalg.norm(C); r = np.cross(f, [0, 0, 1.]); r /= np.linalg.norm(r); d = np.cross(f, r)
Rm = np.stack([r, d, f]); t = -Rm @ C; K = np.array([[S * 2.2, 0, S / 2], [0, S * 2.2, S / 2], [0, 0, 1.]])
def shade(M):
    V = np.asarray(M.vertices, float); F = np.asarray(M.faces)
    R_.set_mesh(V, F); o = R_.render(K, Rm, t); n = o["normal"]; m = o["mask"]
    L = np.array([.4, -.5, .75]); L /= np.linalg.norm(L)
    s = np.clip(np.abs(n @ (Rm @ L)) * .75 + .25, 0, 1) if False else np.clip(np.abs(n @ L) * .7 + .3, 0, 1)
    img = np.full((S, S, 3), 245, np.uint8); img[m] = (s[m, None] * np.array([120, 150, 200])).astype(np.uint8) + 30
    return img
def vmesh(occ):
    g = np.pad(ndi.gaussian_filter(occ.astype(np.float32), .7), 1)
    v, fc, _, _ = marching_cubes(g, .5); v = (v - 1 + .5) / N * 2 - 1
    return trimesh.Trimesh(v, fc[:, ::-1], process=False)
rows = []
for i, m in enumerate(meta):
    sk = np.asarray(Image.fromarray(255 - X[i]).resize((S, S), Image.BICUBIC).convert("RGB"))
    fit = trimesh.load(f"out/hybrid/fit/{i:02d}.obj", force="mesh")
    cells = [sk, shade(vmesh(clean(P[i]))), shade(fit), shade(vmesh(T[i]))]
    row = np.concatenate(cells, 1); im = Image.fromarray(row); dr = ImageDraw.Draw(im)
    dr.text((6, 4), f"{m['name']}", fill=(0, 0, 0)); dr.text((S + 6, 4), "Vorhersage mix_v1 (Voxel)", fill=(0, 0, 0))
    dr.text((2 * S + 6, 4), f"CAD-Fit: {rep[i]['mode']}, {rep[i]['n_prims']} Teile", fill=(0, 0, 0)); dr.text((3 * S + 6, 4), "Ziel", fill=(0, 0, 0))
    rows.append(np.asarray(im))
for k in range(0, len(rows), 6):
    Image.fromarray(np.concatenate(rows[k:k + 6], 0)).save(f"out/hybrid/sheet_{k // 6}.png")
print("ok")
