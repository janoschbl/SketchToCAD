"""Hybrid-System, Schritt 3: grobe Voxel-Vorhersage (mix_v1) -> echte CAD-Primitive (Box, Giebelprisma, Kegelstumpf).

Eingabe: `out/hybrid/pred_world.npy` (Logits im Weltgitter 96^3, Z oben) + `gt_world.npy` (nur zur Bewertung).
Ablauf pro Objekt:
  1. Vorhersage säubern (größte Komponente, Löcher füllen).
  2. Ausrichtung: Grundriss -> Drehwinkel (Rechteck mit kleinster Fläche), auf 0/90° einrasten.
  3. Greedy-Anpassung: Kandidaten (Box, Giebelprisma in 2 Richtungen, Kegelstumpf) aus dem Rest, der noch nicht
     abgedeckt ist; angenommen wird, was die IoU zur Vorhersage am meisten erhöht. Danach Koordinatenabstieg
     (Grenzen +-1 Voxel) und Rundung der Maße.
  4. Zweiter Weg für Drehkörper (Dose/Vase): Radius-Profil pro Höhe -> gestapelte Kegelstümpfe.
  5. Bester Weg nach IoU zur Vorhersage. Ausgabe: Parameter-JSON + wasserdichtes Mesh (manifold3d-Vereinigung).
"""
import json, os, sys
import numpy as np
import trimesh
from scipy import ndimage as ndi

N = 96
H = 2.0 / N
AX = (np.arange(N) + .5) / N * 2 - 1
GX, GY, GZ = np.meshgrid(AX, AX, AX, indexing="ij")


# ---------- Primitive: Belegung auf dem Gitter ----------
def occ_prim(p, th):
    c, s = np.cos(th), np.sin(th)
    qx = c * GX + s * GY; qy = -s * GX + c * GY
    t = p["t"]
    if t in ("box", "prism"):
        x0, x1, y0, y1, z0, z1 = p["b"]
        m = (qx >= x0) & (qx <= x1) & (qy >= y0) & (qy <= y1) & (GZ >= z0) & (GZ <= z1)
        if t == "prism":
            f = np.clip((z1 - GZ) / max(z1 - z0, 1e-6), 0, 1)
            if p["ridge"] == "x":
                m &= np.abs(qy - (y0 + y1) / 2) <= f * (y1 - y0) / 2
            else:
                m &= np.abs(qx - (x0 + x1) / 2) <= f * (x1 - x0) / 2
        return m
    cx, cy, r0, r1, z0, z1 = p["b"]
    r = r0 + (r1 - r0) * np.clip((GZ - z0) / max(z1 - z0, 1e-6), 0, 1)
    return ((qx - cx) ** 2 + (qy - cy) ** 2 <= r ** 2) & (GZ >= z0) & (GZ <= z1)


def occ_all(ps, th):
    m = np.zeros((N, N, N), bool)
    for p in ps:
        m |= occ_prim(p, th)
    return m


def iou(a, b):
    return (a & b).sum() / max((a | b).sum(), 1)


# ---------- Vorverarbeitung ----------
def clean(lg):
    p = lg > 0
    lab, n = ndi.label(p, ndi.generate_binary_structure(3, 3))
    if n > 1:
        sz = np.bincount(lab.ravel())[1:]
        p = np.isin(lab, 1 + np.nonzero(sz >= .15 * sz.max())[0])
    return ndi.binary_fill_holes(p)


def find_yaw(occ):
    """Drehwinkel (rad) des Grundrisses: Rechteck mit kleinster Fläche, auf 0/90° einrasten (+-6°)."""
    ys, xs = np.nonzero(occ.any(2))
    P = np.stack([AX[ys], AX[xs]], 1) if False else np.stack([AX[ys], AX[xs]], 1)
    best = (1e9, 0)
    for deg in range(0, 90):
        t = np.radians(deg); c, s = np.cos(t), np.sin(t)
        u = P[:, 0] * c + P[:, 1] * s; v = -P[:, 0] * s + P[:, 1] * c
        a = np.ptp(u) * np.ptp(v)
        if a < best[0] - 1e-9:
            best = (a, deg)
    d = best[1]
    if d <= 6 or d >= 84:
        d = 0
    return np.radians(d)


# ---------- Kandidaten ----------
def local_bounds(m, th, lo=0.0):
    """Achsenparallele Grenzen (lokal) einer Voxelmenge: x0,x1,y0,y1,z0,z1."""
    ix, iy, iz = np.nonzero(m)
    x, y, z = AX[ix], AX[iy], AX[iz]
    c, s = np.cos(th), np.sin(th)
    qx = c * x + s * y; qy = -s * x + c * y
    return [qx.min() - H / 2, qx.max() + H / 2, qy.min() - H / 2, qy.max() + H / 2, z.min() - H / 2, z.max() + H / 2]


def candidates(res, th, whole):
    b = local_bounds(res, th)
    out = []
    for t in ("box", "prism_x", "prism_y"):
        if t == "box":
            out.append(dict(t="box", b=list(b)))
        else:
            out.append(dict(t="prism", b=list(b), ridge=t[-1]))
    cx, cy = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
    r = (b[1] - b[0] + b[3] - b[2]) / 4
    out.append(dict(t="cyl", b=[cx, cy, r, r, b[4], b[5]]))
    if whole:  # Körper ohne Dach: Oberkante an Stufen des Grundriss-Flächenprofils
        for zt in np.linspace(b[4] + .25 * (b[5] - b[4]), b[5], 7):
            for t in ("box",):
                out.append(dict(t=t, b=[b[0], b[1], b[2], b[3], b[4], float(zt)]))
    return out


def fit_greedy(tgt, th, max_prims=6):
    ps = []; cur = np.zeros_like(tgt); score = 0.0
    for step in range(max_prims):
        res = tgt & ~cur
        res = ndi.binary_opening(res, iterations=1) if res.sum() > 200 else res
        lab, n = ndi.label(res)
        if n == 0:
            break
        sz = np.bincount(lab.ravel())[1:]
        comps = [np.argmax(sz) + 1] + [i + 1 for i in np.argsort(-sz)[1:3] if sz[i] > 0.12 * sz.max()]
        best = (score + .004, None)
        for ci in ([None] if step == 0 else comps):
            m = tgt if ci is None else (lab == ci)
            if step == 0:
                cands = candidates(m, th, True)
            else:
                cands = candidates(m, th, False)
            for cd in cands:
                sc = iou(cur | occ_prim(cd, th), tgt)
                if sc > best[0]:
                    best = (sc, cd)
        if best[1] is None:
            break
        ps.append(best[1]); cur = cur | occ_prim(best[1], th); score = best[0]
    return ps, score


def refine(ps, tgt, th, passes=2):
    for _ in range(passes):
        changed = False
        for k, p in enumerate(ps):
            others = occ_all(ps[:k] + ps[k + 1:], th)
            base = iou(others | occ_prim(p, th), tgt)
            for j in range(6):
                for d in (-2 * H, -H, H, 2 * H):
                    q = dict(p); q["b"] = list(p["b"]); q["b"][j] += d
                    if q["t"] != "cyl" and (q["b"][1] <= q["b"][0] or q["b"][3] <= q["b"][2] or q["b"][5] <= q["b"][4]):
                        continue
                    if q["t"] == "cyl" and (q["b"][2] <= 0 or q["b"][3] < 0 or q["b"][5] <= q["b"][4]):
                        continue
                    sc = iou(others | occ_prim(q, th), tgt)
                    if sc > base + 1e-4:
                        base, p = sc, q; changed = True
            ps[k] = p
        if not changed:
            break
    return ps


# ---------- Drehkörper ----------
def fit_lathe(tgt, tol=0.035):
    area = tgt.sum((0, 1)) * H * H
    zs = np.nonzero(area > 0)[0]
    if len(zs) < 4:
        return [], 0.0
    cx = (AX[:, None, None] * tgt).sum() / tgt.sum(); cy = (AX[None, :, None] * tgt).sum() / tgt.sum()
    z0, z1 = zs[0], zs[-1]
    r = np.sqrt(area / np.pi)[z0:z1 + 1]
    r = ndi.uniform_filter1d(r, 3, mode="nearest")
    z = AX[z0:z1 + 1]
    # Polylinie vereinfachen (Douglas-Peucker)
    def dp(i, j):
        if j <= i + 1:
            return [i, j]
        t = (z[i + 1:j] - z[i]) / (z[j] - z[i]); e = np.abs(r[i + 1:j] - (r[i] + t * (r[j] - r[i])))
        k = int(np.argmax(e))
        return dp(i, i + 1 + k)[:-1] + dp(i + 1 + k, j) if e[k] > tol else [i, j]
    idx = dp(0, len(z) - 1)
    ps = [dict(t="cyl", b=[float(cx), float(cy), float(r[a]), float(r[b]), float(z[a] - H / 2 if a == 0 else z[a]), float(z[b] + H / 2 if b == len(z) - 1 else z[b])]) for a, b in zip(idx[:-1], idx[1:])]
    return ps, iou(occ_all(ps, 0.0), tgt)


# ---------- Mesh ----------
def prim_mesh(p, th):
    if p["t"] in ("box", "prism"):
        x0, x1, y0, y1, z0, z1 = p["b"]
        pts = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        if p["t"] == "prism":
            xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
            if p["ridge"] == "x":
                pts = [(x0, y0, z0), (x1, y0, z0), (x0, y1, z0), (x1, y1, z0), (x0, ym, z1), (x1, ym, z1)]
            else:
                pts = [(x0, y0, z0), (x1, y0, z0), (x0, y1, z0), (x1, y1, z0), (xm, y0, z1), (xm, y1, z1)]
        m = trimesh.convex.convex_hull(np.array(pts, float))
    else:
        cx, cy, r0, r1, z0, z1 = p["b"]; a = np.linspace(0, 2 * np.pi, 49)[:-1]
        pts = [(cx + r * np.cos(t), cy + r * np.sin(t), z) for r, z in ((r0, z0), (r1, z1)) for t in a]
        m = trimesh.convex.convex_hull(np.array(pts, float))
    m.apply_transform(trimesh.transformations.rotation_matrix(th, [0, 0, 1]))
    return m


def build_mesh(ps, th):
    ms = [prim_mesh(p, th) for p in ps]
    return ms[0] if len(ms) == 1 else trimesh.boolean.union(ms, engine="manifold")


def describe(p):
    r = lambda v: round(float(v), 3)
    if p["t"] == "cyl":
        return dict(typ="kegelstumpf", mitte=[r(p["b"][0]), r(p["b"][1])], r_unten=r(p["b"][2]), r_oben=r(p["b"][3]), z=[r(p["b"][4]), r(p["b"][5])])
    d = dict(typ="giebelprisma" if p["t"] == "prism" else "quader", x=[r(p["b"][0]), r(p["b"][1])], y=[r(p["b"][2]), r(p["b"][3])], z=[r(p["b"][4]), r(p["b"][5])])
    if p["t"] == "prism":
        d["first"] = p["ridge"]
    return d


def fit_object(lg):
    tgt = clean(lg)
    th = find_yaw(tgt)
    ps, sc = fit_greedy(tgt, th)
    ps = refine(ps, tgt, th)
    sc = iou(occ_all(ps, th), tgt)
    mode = "greedy"
    lp, ls = fit_lathe(tgt)
    if ls > sc - 0.02:
        ps, sc, th, mode = lp, ls, 0.0, "drehkoerper"
    return dict(prims=ps, yaw=th, iou_pred=float(sc), mode=mode, tgt=tgt)


if __name__ == "__main__":
    P = np.load("out/hybrid/pred_world.npy").astype(np.float32); T = np.load("out/hybrid/gt_world.npy")
    meta = json.load(open("data_real/ood/meta.json")); os.makedirs("out/hybrid/fit", exist_ok=True)
    rows = []
    for i, m in enumerate(meta):
        r = fit_object(P[i]); fm = occ_all(r["prims"], r["yaw"])
        mesh = build_mesh(r["prims"], r["yaw"]); mesh.export(f"out/hybrid/fit/{i:02d}.obj")
        rec = dict(i=i, name=m["name"], mode=r["mode"], yaw_deg=round(float(np.degrees(r["yaw"])), 1), n_prims=len(r["prims"]),
                   iou_pred_raw=round(float(iou(P[i] > 0, T[i])), 3), iou_pred_clean=round(float(iou(r["tgt"], T[i])), 3),
                   iou_fit_vs_pred=round(float(r["iou_pred"]), 3), iou_fit_vs_gt=round(float(iou(fm, T[i])), 3),
                   watertight=bool(mesh.is_watertight), prims=[describe(p) for p in r["prims"]])
        rows.append(rec); np.save(f"out/hybrid/fit/{i:02d}_vox.npy", np.packbits(fm))
        print(i, rec["name"], rec["mode"], rec["n_prims"], "Vorhersage→Ziel %.2f | Fit→Ziel %.2f" % (rec["iou_pred_clean"], rec["iou_fit_vs_gt"]), flush=True)
    json.dump(rows, open("out/hybrid/fit/report.json", "w"), ensure_ascii=False, indent=1)
