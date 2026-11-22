"""Segmentierbarkeit der Modellausgabe: Kann man aus der Vorhersage per Kanten/Ecken dieselben Teile schneiden wie aus dem Ziel?

Pro OOD-Skizze (Ziel = Voxel-Form, nicht im Training):
  iou_raw    IoU Vorhersage-Voxel vs. Ziel
  iou_sharp  IoU nach Schärfen (sharpen) vs. Ziel
  ari        Adjusted-Rand-Index zwischen Ziel-Segmentierung und Vorhersage-Segmentierung (Oberflächenpunkte)
  planar     Anteil der Oberfläche, der nach dem Schärfen auf <= 1,5 % Diagonale an der Ebene liegt
  ok         iou_sharp >= 0.6 und ari >= 0.5   (grobe Abnahmeschwelle, siehe README)
  python seg_eval.py runs_home/mix_v2/best.pt [--json out.json]
"""
import json, os, sys, numpy as np, torch, trimesh
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.measure import marching_cubes
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, HERE + "/../prompt-editor")
from app.sharpen import sharpen
from app.segmentation import segment_faces

OK_IOU, OK_ARI = 0.6, 0.5


def to_mesh(p, sigma=0.8):
    p = ndi.binary_fill_holes(p)
    lab, n = ndi.label(p)
    if n > 1: p = lab == 1 + np.bincount(lab.ravel())[1:].argmax()
    f = ndi.gaussian_filter(p.astype(np.float32), sigma)
    if f.max() <= .5: return None
    v, fc, _, _ = marching_cubes(np.pad(f, 1), 0.5)
    return (v - 1 + .5) / 64 * 2 - 1, fc[:, ::-1].copy()


def ari(a, b):
    from math import comb
    _, a = np.unique(a, return_inverse=True); _, b = np.unique(b, return_inverse=True)
    t = np.zeros((a.max() + 1, b.max() + 1)); np.add.at(t, (a, b), 1)
    s = sum(comb(int(x), 2) for x in t.ravel()); sa = sum(comb(int(x), 2) for x in t.sum(1)); sb = sum(comb(int(x), 2) for x in t.sum(0))
    e = sa * sb / comb(len(a), 2); m = (sa + sb) / 2
    return float((s - e) / (m - e)) if m != e else 1.0


def surf_labels(V, F, lab, pts):
    m = trimesh.Trimesh(V, F, process=False)
    _, idx = cKDTree(V[F].mean(1)).query(pts)
    return lab[idx]


def evaluate(pred, gt, seed=0):
    out = dict(iou_raw=float((pred & gt).sum() / max((pred | gt).sum(), 1)))
    G = to_mesh(gt); P = to_mesh(pred)
    if G is None or P is None: return dict(out, iou_sharp=0, ari=0, planar=0, ok=False, planes=0, planes_gt=0)
    Vs, Fs, lp = sharpen(*P); Vg, Fg, lg = sharpen(*G)
    # IoU nach Schärfen: Punkte im Gitter, innerhalb des geschärften Meshes
    g = (np.arange(64) + .5) / 64 * 2 - 1; pts = np.stack(np.meshgrid(g, g, g, indexing="ij"), -1).reshape(-1, 3)
    ms = trimesh.Trimesh(Vs, Fs, process=False)
    inside = ms.contains(pts).reshape(64, 64, 64) if ms.is_watertight else np.zeros((64, 64, 64), bool)
    if not inside.any():  # nicht wasserdicht (Snapping-Zacken): Voxel-Fallback über nächste Dreiecke
        inside = ndi.binary_fill_holes(cKDTree(Vs[Fs].mean(1)).query(pts)[0].reshape(64, 64, 64) < 1.0 / 64)
    out["iou_sharp"] = float((inside & gt).sum() / max((inside | gt).sum(), 1))
    rng = np.random.default_rng(seed); sp, _ = trimesh.sample.sample_surface(trimesh.Trimesh(Vg, Fg, process=False), 4000, seed=seed)
    out["ari"] = ari(surf_labels(Vg, Fg, lg, sp), surf_labels(Vs, Fs, lp, sp))
    # Ebenheit der Vorhersage-Segmente nach dem Schärfen
    N = ms.face_normals; A = ms.area_faces; size = np.linalg.norm(Vs.max(0) - Vs.min(0)); res = 0.0
    for k in range(lp.max() + 1):
        mm = lp == k
        if mm.sum() < 2: continue
        c = ms.triangles_center[mm]; nn = (N[mm] * A[mm, None]).sum(0); nn /= max(np.linalg.norm(nn), 1e-12)
        d = np.abs((c - c.mean(0)) @ nn); res += A[mm][d < 0.015 * size].sum()
    out["planar"] = float(res / A.sum()); out["planes"] = int(lp.max() + 1); out["planes_gt"] = int(lg.max() + 1)
    out["ok"] = bool(out["iou_sharp"] >= OK_IOU and out["ari"] >= OK_ARI)
    return out


def run(ckpt, ood="data_real/ood"):
    from model_v2 import LiftNet
    net = LiftNet(); net.load_state_dict({k: v.float() for k, v in torch.load(f"{HERE}/{ckpt}", map_location="cpu").items()}); net.eval()
    X = np.load(f"{HERE}/{ood}/sketch128.npy"); GT = np.load(f"{HERE}/{ood}/vox64.npy") > 0; meta = json.load(open(f"{HERE}/{ood}/meta.json"))
    with torch.no_grad(): lg = net(torch.from_numpy(X.astype(np.float32) / (255 if X.dtype == np.uint8 else 1))[:, None])[:, 0].numpy()
    rows = []
    for i, m in enumerate(meta):
        r = evaluate(lg[i] > 0, GT[i]); r.update(name=m["name"], shape=m["shape"]); rows.append(r)
        print(f"{i:2d} {m['name']:22s} iou {r['iou_raw']:.2f}->{r['iou_sharp']:.2f} ari {r['ari']:.2f} eben {r['planar']:.2f} Ebenen {r['planes']}/{r['planes_gt']} {'OK' if r['ok'] else '--'}", flush=True)
    summ = {k: float(np.mean([r[k] for r in rows])) for k in ("iou_raw", "iou_sharp", "ari", "planar", "ok")}
    for sh in sorted({r["shape"] for r in rows}): summ[f"ok_{sh}"] = float(np.mean([r["ok"] for r in rows if r["shape"] == sh]))
    print("SUMME", {k: round(v, 3) for k, v in summ.items()}); return rows, summ


if __name__ == "__main__":
    rows, summ = run(sys.argv[1])
    if "--json" in sys.argv: json.dump(dict(rows=rows, summary=summ), open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
