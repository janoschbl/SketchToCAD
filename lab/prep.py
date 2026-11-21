"""Voxelisiert alle USDC-Modelle (64^3) und packt Skizzen (128x128) + Einfachheits-Scores in schnelle Arrays."""
import sys, os as _o; sys.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
import json, os, sys, time, numpy as np
from multiprocessing import Pool
from PIL import Image
from scipy import ndimage as ndi
from usd_probe_lib import load_mesh

ROOT = os.environ.get("DS", "/run/media/janosch/Seagate HDD/testcreate/handdrawn_dataset")
OUT = os.path.join(os.path.dirname(__file__), "data")
R = 64; LIM = 1.02; SK = 128

def voxelize(asset):
    V, F = load_mesh(f"{ROOT}/model/{asset}.usdc")
    tri = V[F]
    area = np.linalg.norm(np.cross(tri[:,1]-tri[:,0], tri[:,2]-tri[:,0]), axis=1) / 2
    n = 400_000
    idx = np.random.default_rng(0).choice(len(F), n, p=area/area.sum())
    u, v = np.random.default_rng(1).random((2, n)); s = u+v > 1; u[s], v[s] = 1-u[s], 1-v[s]
    t = tri[idx]; P = t[:,0] + u[:,None]*(t[:,1]-t[:,0]) + v[:,None]*(t[:,2]-t[:,0])
    g = np.clip(((P + LIM) / (2*LIM) * R).astype(int), 0, R-1)
    vox = np.zeros((R,R,R), bool); vox[g[:,0], g[:,1], g[:,2]] = True
    st = np.ones((3,3,3), bool)
    d = ndi.binary_dilation(vox, st)                 # Huelle dichtmachen (6er-Nachbarschaft leckt sonst)
    filled = ndi.binary_erosion(ndi.binary_fill_holes(d), st) | vox
    return asset, filled.astype(np.uint8), float(vox.sum()), float(filled.sum())

def sketch(path):
    a = np.asarray(Image.open(f"{ROOT}/{path}").convert("L"), dtype=np.float32)
    ink = a < 128
    filled = ndi.binary_fill_holes(ink)
    A = float(filled.sum())
    ys, xs = np.nonzero(filled)
    if A < 20:
        return None, dict(area=A, ellipse=0, circ=0, lines=float(ink.sum()), comps=0)
    cov = np.cov(np.c_[xs, ys].T)
    ell = A / (4*np.pi*np.sqrt(max(np.linalg.det(cov), 1e-9)))     # 1.0 = perfekte Ellipse
    P = float(ink.sum())                                            # ~Konturlaenge in px
    circ = 4*np.pi*A / (P*P)                                        # ~1 = Kreis
    comps = int(ndi.label(filled)[1])
    img = Image.fromarray(((1 - a/255) * 255).astype(np.uint8)).resize((SK, SK), Image.BOX)
    return np.asarray(img), dict(area=A, ellipse=float(ell), circ=float(circ), lines=P, comps=comps)

def sk_job(args):
    i, path = args
    img, m = sketch(path); return i, img, m

if __name__ == "__main__":
    pairs = json.load(open(f"{ROOT}/metadata/pairs.json"))
    assets = sorted({r["asset_id"] for r in pairs})
    t0 = time.time()
    with Pool(16) as pool:
        vox = {}; stats = {}
        for a, v, raw, fil in pool.imap_unordered(voxelize, assets):
            vox[a] = v; stats[a] = (raw, fil)
        print(f"voxel fertig {len(vox)} in {time.time()-t0:.0f}s", flush=True)
        imgs = np.zeros((len(pairs), SK, SK), np.uint8); metrics = [None]*len(pairs)
        for k, (i, img, m) in enumerate(pool.imap_unordered(sk_job, enumerate(r["sketch"] for r in pairs), chunksize=64)):
            if img is not None: imgs[i] = img
            metrics[i] = m
            if k % 2000 == 0: print(k, f"{time.time()-t0:.0f}s", flush=True)
    order = {a: i for i, a in enumerate(assets)}
    np.savez_compressed(f"{OUT}/voxels64.npz", assets=np.array(assets), vox=np.stack([vox[a] for a in assets]))
    np.save(f"{OUT}/sketch128.npy", imgs)
    meta = [dict(id=r["id"], asset=r["asset_id"], asset_idx=order[r["asset_id"]], split=r["object_split"],
                 az=r["camera"]["azimuth_deg"], el=r["camera"]["elevation_deg"], category=r["category"].split("/")[0],
                 **metrics[i]) for i, r in enumerate(pairs)]
    json.dump(meta, open(f"{OUT}/meta.json", "w"))
    json.dump({a: dict(raw=stats[a][0], filled=stats[a][1]) for a in assets}, open(f"{OUT}/vox_stats.json", "w"))
    print("fertig", f"{time.time()-t0:.0f}s")
