"""Linien aus Mesh + Render-Puffern: Außenkontur (aus Maske), Innen-Silhouetten,
Faltkanten (Crease), verdeckte Kanten. Ergebnis: 2D-Polylinien in Pixeln mit Typ."""
import numpy as np
import trimesh
from scipy import ndimage as ndi
from skimage import measure

from .render import project


class MeshEdges:
    """Einmal pro Objekt: Kantentopologie für schnelle Pro-Ansicht-Auswertung."""

    def __init__(self, V, F, crease_deg=35.0, max_crease=6000):
        m = trimesh.Trimesh(V, F, process=True)  # verschmilzt Vertices nach Position
        m.remove_unreferenced_vertices()
        self.V = np.asarray(m.vertices, float)
        self.F = np.asarray(m.faces, np.int64)
        self.fn = np.asarray(m.face_normals, float)
        self.fc = np.asarray(m.triangles_center, float)
        adj = m.face_adjacency
        self.adj = adj
        self.adj_e = m.face_adjacency_edges
        ang = np.degrees(m.face_adjacency_angles)
        # Schwelle so anheben, dass verrauschte Hochpoly-Meshes nicht überall Kanten liefern
        thr = crease_deg
        if (ang > thr).sum() > max_crease:
            thr = max(thr, float(np.quantile(ang, 1 - max_crease / len(ang))))
        self.crease_thr = thr
        self.is_crease = ang > thr
        es = m.edges_sorted
        g = trimesh.grouping.group_rows(es, require_count=1)
        self.bnd_e = es[g] if len(g) else np.zeros((0, 2), np.int64)
        self.mesh = m


def _runs(state, edge_id):
    """Grenzen zusammenhängender Läufe gleichen Zustands innerhalb einer Kante."""
    n = len(state)
    brk = np.ones(n, bool)
    brk[1:] = (state[1:] != state[:-1]) | (edge_id[1:] != edge_id[:-1])
    starts = np.flatnonzero(brk)
    ends = np.r_[starts[1:], n]
    return starts, ends


def _smooth(P, sigma, closed=False):
    if len(P) < 5 or sigma <= 0:
        return P
    mode = "wrap" if closed else "nearest"
    Q = np.stack([ndi.gaussian_filter1d(P[:, i], sigma, mode=mode) for i in range(2)], 1)
    if not closed:
        Q[0], Q[-1] = P[0], P[-1]
    return Q


def _length(P):
    return float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum()) if len(P) > 1 else 0.0


def resample(P, step):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    if d[-1] < 1e-9:
        return P[:1]
    n = max(2, int(np.ceil(d[-1] / step)) + 1)
    s = np.linspace(0, d[-1], n)
    return np.stack([np.interp(s, d, P[:, i]) for i in range(P.shape[1])], 1)


def split_at_corners(P, closed, angle_deg=55, win=4.0):
    """Polylinie an Knicken teilen (Zeichner setzen dort neu an)."""
    Q = resample(P, 1.0)
    if len(Q) < 8:
        return [P]
    k = int(win)
    prev = np.roll(Q, k, 0) if closed else np.r_[np.repeat(Q[:1], k, 0), Q[:-k]]
    nxt = np.roll(Q, -k, 0) if closed else np.r_[Q[k:], np.repeat(Q[-1:], k, 0)]
    v1, v2 = Q - prev, nxt - Q
    cos = (v1 * v2).sum(1) / (np.linalg.norm(v1, axis=1) * np.linalg.norm(v2, axis=1) + 1e-9)
    turn = np.degrees(np.arccos(np.clip(cos, -1, 1)))
    if not closed:
        turn[:k] = 0; turn[-k:] = 0
    cand = np.flatnonzero(turn > angle_deg)
    cuts = []
    for i in cand[np.argsort(-turn[cand])]:          # lokale Maxima, Abstand >= 2*win
        if all(abs(i - j) > 2 * k for j in cuts):
            cuts.append(i)
    cuts.sort()
    if closed:
        if not cuts:
            return [np.r_[Q, Q[:1]]]
        Q2 = np.r_[Q[cuts[0]:], Q[:cuts[0] + 1]]
        cuts = [c - cuts[0] for c in cuts[1:]] + [len(Q2) - 1]
        out, s = [], 0
        for c in cuts:
            out.append(Q2[s:c + 1]); s = c
        return out
    out, s = [], 0
    for c in cuts + [len(Q) - 1]:
        if c - s >= 2:
            out.append(Q[s:c + 1])
        s = c
    return out


def outer_contours(mask, min_len=12):
    m = np.pad(mask.astype(float), 2)
    m = ndi.gaussian_filter(m, 0.9)
    out = []
    for c in measure.find_contours(m, 0.5):
        P = c[:, ::-1] - 2.0                      # (row,col) -> (x,y)
        closed = np.allclose(P[0], P[-1])
        if _length(P) < min_len:
            continue
        P = _smooth(resample(P, 1.0), 1.5, closed)
        out.append((P, closed))
    return out


def extract(me: MeshEdges, cam, buf, hidden=True, min_len=6.0, band=2.0):
    """Gibt Liste von dict(pts, kind, closed) zurück. kind: contour|sil|crease|hidden."""
    K, R, t, C = cam["K"], cam["R"], cam["t"], cam["C"]
    H, W = buf["depth"].shape
    V = me.V
    front = ((C - me.fc) * me.fn).sum(1) > 0
    a, b = me.adj[:, 0], me.adj[:, 1]
    sil = front[a] != front[b]
    cand = sil | me.is_crease
    E = np.r_[me.adj_e[cand], me.bnd_e]
    is_sil = np.r_[sil[cand], np.zeros(len(me.bnd_e), bool)]
    if len(E) == 0:
        strokes = []
    else:
        uv0, _ = project(V[E[:, 0]], K, R, t)
        uv1, _ = project(V[E[:, 1]], K, R, t)
        L = np.linalg.norm(uv1 - uv0, axis=1)
        n = np.clip(np.ceil(L / 1.0).astype(int) + 1, 2, 600)
        eid = np.repeat(np.arange(len(E)), n)
        off = np.r_[0, np.cumsum(n)[:-1]]
        k = np.arange(len(eid)) - np.repeat(off, n)
        tt = k / (np.repeat(n, n) - 1)
        X = V[E[eid, 0]] * (1 - tt)[:, None] + V[E[eid, 1]] * tt[:, None]
        uv, z = project(X, K, R, t)
        ui = np.clip(np.round(uv[:, 0]).astype(int), 0, W - 1)
        vi = np.clip(np.round(uv[:, 1]).astype(int), 0, H - 1)
        inside = (uv[:, 0] >= 0) & (uv[:, 0] < W) & (uv[:, 1] >= 0) & (uv[:, 1] < H) & (z > 0)
        zmin = buf["zmin3"][vi, ui]
        vis = z <= zmin * 1.01 + 1e-3
        near_outer = buf["bdist"][vi, ui] < band
        # Zustand: 0 verdeckt, 1 sichtbar, 2 verworfen (Außenkontur / außerhalb)
        state = np.where(vis, 1, 0)
        state = np.where(vis & near_outer, 2, state)
        state = np.where(inside, state, 2)
        starts, ends = _runs(state, eid)
        # Stücke mit Vertex-Schlüsseln an vollen Kantenenden verketten
        pieces = []
        for s, e in zip(starts, ends):
            st = state[s]
            if st == 2 or (st == 0 and not hidden) or e - s < 2:
                continue
            ed = eid[s]
            ks = int(E[ed, 0]) if k[s] == 0 else None
            ke = int(E[ed, 1]) if k[e - 1] == n[ed] - 1 else None
            pieces.append([uv[s:e], ks, ke, st, bool(is_sil[ed])])
        strokes = _chain(pieces, min_len)
    out = []
    for P, st, s_any in strokes:
        kind = "hidden" if st == 0 else ("sil" if s_any else "crease")
        out.append(dict(pts=P, kind=kind, closed=False))
    for P, closed in outer_contours(buf["mask"]):
        out.append(dict(pts=P, kind="contour", closed=closed))
    return out


def _chain(pieces, min_len):
    from collections import defaultdict
    at = defaultdict(list)
    for i, (P, ks, ke, st, _) in enumerate(pieces):
        if ks is not None: at[(st, ks)].append(i)
        if ke is not None: at[(st, ke)].append(i)
    used = np.zeros(len(pieces), bool)

    def oriented(i, key_vertex):
        P, ks, ke, st, s = pieces[i]
        return P if ks == key_vertex else P[::-1]

    def other_end(i, v):
        P, ks, ke, *_ = pieces[i]
        return ke if ks == v else ks

    def walk(cur_pts, v, st):
        """Verlängert ab Vertex v, gibt Punktliste-Fortsetzung zurück."""
        segs, sil_any = [], False
        while v is not None:
            d0 = cur_pts[-1] - cur_pts[max(0, len(cur_pts) - 4)]
            best, bang = None, 1e9
            for j in at[(st, v)]:
                if used[j]:
                    continue
                Q = oriented(j, v)
                d1 = Q[min(3, len(Q) - 1)] - Q[0]
                n0, n1 = np.linalg.norm(d0), np.linalg.norm(d1)
                ang = 0.0 if n0 < 1e-6 or n1 < 1e-6 else np.degrees(np.arccos(np.clip(d0 @ d1 / (n0 * n1), -1, 1)))
                lim = 100 if (n0 < 4 or n1 < 4) else 40
                if ang < lim and ang < bang:
                    best, bang = j, ang
            if best is None:
                break
            used[best] = True
            Q = oriented(best, v)
            segs.append(Q[1:]); sil_any |= pieces[best][4]
            cur_pts = np.r_[cur_pts[-4:], Q[1:]]
            v = other_end(best, v)
        return segs, sil_any

    out = []
    for i in range(len(pieces)):
        if used[i]:
            continue
        used[i] = True
        P, ks, ke, st, s_any = pieces[i]
        fw, s1 = walk(P, ke, st)
        bw, s2 = walk(P[::-1], ks, st)
        parts = [Q[::-1] for Q in bw[::-1]] + [P] + fw
        C = np.concatenate(parts, 0)
        if _length(C) < min_len * (2 if st == 0 else 1):
            continue
        sil_any = s_any or s1 or s2
        C = resample(C, 1.0)
        if sil_any:
            C = _smooth(C, 1.5)
        out.append((C, st, sil_any))
    return out


def prep_buffers(buf):
    """Zusätzliche Puffer: 3x3-Minimum der Tiefe, Abstand zur Außenkontur."""
    d = buf["depth"]
    buf["zmin3"] = ndi.minimum_filter(np.where(np.isfinite(d), d, 1e9), 3)
    m = buf["mask"]
    edge = m ^ ndi.binary_erosion(m)
    edge |= ndi.binary_dilation(m) ^ m
    buf["bdist"] = ndi.distance_transform_edt(~edge)
    return buf
