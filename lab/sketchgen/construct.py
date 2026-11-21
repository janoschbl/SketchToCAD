"""Konstruktionslinien für Meshes ohne CAD-Historie (Objaverse etc.).

Abgeleitet: senkrecht ausgerichteter Hüllquader (Gier per PCA), Mittelachse,
Mittellinien auf Deck-/Bodenfläche, Ellipsen bei rotationsähnlichen Formen,
Hüllquader großer Teile."""
import numpy as np
import trimesh

from .procad import box_edges, _circle, _seg


def _yaw_frame(P):
    xy = P[:, :2] - P[:, :2].mean(0)
    w, U = np.linalg.eigh(np.cov(xy.T))
    a = U[:, -1]
    ang = np.arctan2(a[1], a[0])
    c, s = np.cos(ang), np.sin(ang)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])   # Spalten = Achsen


def _obb_lines(P, Rf, kind="scaffold"):
    L = P @ Rf
    lo, hi = L.min(0), L.max(0)
    lines = box_edges(lo, hi, kind)
    for ln in lines:
        ln["pts"] = ln["pts"] @ Rf.T
    return lines, lo, hi


def mesh_construction(V, F, rng, max_parts=4):
    m = trimesh.Trimesh(V, F, process=False)
    P = m.sample(3000) if m.area > 0 else V
    Rf = _yaw_frame(P)
    out, lo, hi = _obb_lines(P, Rf)
    ctr = (lo + hi) / 2
    ext = hi - lo
    to_w = lambda p: np.asarray(p, float) @ Rf.T
    out.append(_seg(to_w([ctr[0], ctr[1], lo[2] - 0.08 * ext[2]]), to_w([ctr[0], ctr[1], hi[2] + 0.08 * ext[2]]), "axis"))
    for z in (lo[2], hi[2]):
        out.append(_seg(to_w([lo[0], ctr[1], z]), to_w([hi[0], ctr[1], z]), "axis"))
        out.append(_seg(to_w([ctr[0], lo[1], z]), to_w([ctr[0], hi[1], z]), "axis"))
    # Rotationsähnlich? Radius pro Höhenscheibe nahezu konstant
    L = P @ Rf
    r = np.linalg.norm(L[:, :2] - ctr[:2], axis=1)
    zb = np.clip(((L[:, 2] - lo[2]) / max(ext[2], 1e-6) * 8).astype(int), 0, 7)
    rad = np.array([np.quantile(r[zb == i], 0.95) if (zb == i).sum() > 20 else np.nan for i in range(8)])
    spread = np.nanmean([np.std(r[zb == i]) / (rad[i] + 1e-6) for i in range(8) if (zb == i).sum() > 20] or [1])
    roundish = min(ext[0], ext[1]) / max(ext[0], ext[1]) > 0.8 and spread < 0.25
    ex, ey = Rf[:, 0], Rf[:, 1]
    if roundish:
        zs = [lo[2], hi[2]]
        if np.isfinite(rad).any():
            zs.append(lo[2] + (np.nanargmax(rad) + 0.5) / 8 * ext[2])
        for z in zs:
            i = int(np.clip((z - lo[2]) / max(ext[2], 1e-6) * 8, 0, 7))
            rr = rad[i] if np.isfinite(rad[i]) else ext[:2].max() / 2
            out.append(dict(pts=_circle(to_w([ctr[0], ctr[1], z]), ex, ey, rr), kind="ellipse", closed=True))
    # große Teile
    try:
        parts = m.split(only_watertight=False)
    except Exception:
        parts = []
    if 1 < len(parts) <= 200:
        diag = np.linalg.norm(ext)
        big = sorted(parts, key=lambda p: -np.linalg.norm(np.ptp(p.vertices, 0)))
        for p in big[:max_parts]:
            if np.linalg.norm(np.ptp(p.vertices @ Rf, 0)) < 0.3 * diag:
                break
            ln, _, _ = _obb_lines(np.asarray(p.vertices), Rf, "scaffold")
            out += ln
    return out, dict(roundish=bool(roundish))
