"""Schritt 2: blickausgerichtete Vorhersage -> Weltgitter (N^3 in [-1,1]^3, Z oben), zusammen mit Ziel-Voxeln zum Vergleich."""
import json, numpy as np
from scipy import ndimage as ndi
from sketchgen import generate as gen, render as rnd
from realdata.build import solid_voxels, MARGIN, G, OBJ_RES
N = 96
meta = json.load(open("data_real/ood/meta.json")); lg = np.load("out/hybrid/pred_logits.npy")
R_ = rnd.Renderer(512, 512)
ax = (np.arange(N) + .5) / N * 2 - 1
Xw = np.stack(np.meshgrid(ax, ax, ax, indexing="ij"), -1).reshape(-1, 3)
P, T = [], []
for i, m in enumerate(meta):
    d = json.load(open(m["file"])); K, R, t = (np.array(d["camera"][k]) for k in ("K", "R", "t"))
    V, F, _, _ = gen.make_item(("procad", m["seed"]), np.random.default_rng(0))
    R_.set_mesh(V, F); mask = R_.render(K, R, t)["mask"]
    ys, xs = np.nonzero(mask); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    s = MARGIN * max(x1 - x0, y1 - y0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    zc = float(np.linalg.norm(t)); dz = s * zc / K[0, 0]
    Xc = Xw @ R.T + t
    u = Xc[:, 0] / Xc[:, 2] * K[0, 0] + K[0, 2]; v = Xc[:, 1] / Xc[:, 2] * K[1, 1] + K[1, 2]
    col = (u - (cx - s / 2)) / s * G - .5; row = (v - (cy - s / 2)) / s * G - .5; dep = ((Xc[:, 2] - zc) / dz + .5) * G - .5
    f = ndi.map_coordinates(lg[i], np.stack([dep, row, col]), order=1, mode="constant", cval=-5).reshape(N, N, N)
    P.append(f.astype(np.float16))
    g = ndi.map_coordinates(solid_voxels(V, F).astype(np.float32), ((Xw + 1) / 2 * OBJ_RES - .5).T, order=1, cval=0).reshape(N, N, N) > .5
    T.append(g)
    print(i, m["name"], "Welt-IoU %.2f" % (((f > 0) & g).sum() / ((f > 0) | g).sum()), "az %.0f el %.0f" % (d["camera"]["az"], d["camera"]["el"]), flush=True)
np.save("out/hybrid/pred_world.npy", np.stack(P)); np.save("out/hybrid/gt_world.npy", np.stack(T))
