"""Schärft weiche Meshes (z. B. Marching-Cubes-Ausgabe des Modells) an Kanten und Ecken.

Verfahren (Variational Shape Approximation, Cohen-Steiner 2004, vereinfacht):
1. Dreiecke in k Ebenen-Proxys gruppieren (Lloyd-Iteration; Kosten = Fläche·(Normalenabweichung² +
   Abstand zur Ebene²)), neue Proxys dort einfügen, wo der Fehler am größten ist, bis der Fehler klein genug ist.
2. Nicht zusammenhängende Gruppen trennen, fast gleiche Ebenen benachbarter Gruppen verschmelzen.
3. Jeden Vertex auf den Schnitt der Ebenen seiner Nachbardreiecke setzen (kleinste Quadrate,
   leicht zur Ausgangslage regularisiert): 3 Ebenen = Ecke, 2 = Kante, 1 = Projektion.
Ergebnis: scharfe Kanten/Ecken; die Proxys sind zugleich die Flächen-Segmente.
"""
from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.sparse.csgraph import connected_components

from .segmentation import _weld, _adjacency, face_data


def _fit(N, C, A, members):
    w = A[members]; n = (N[members] * w[:, None]).sum(0); n /= max(np.linalg.norm(n), 1e-18)
    c = (C[members] * w[:, None]).sum(0) / w.sum()
    return n, n @ c


def sharpen(V, F, max_planes=14, tol=0.02, iters=12, merge_deg=12.0, max_move=0.12, reg=0.03, scale=None, min_area=0.02):
    """V (n,3), F (m,3) -> (V_scharf, F_verschweißt, Labels pro Dreieck). tol: Fehlerschwelle relativ."""
    V = np.asarray(V, float)
    inv, Vw = _weld(V); Fw = inv[np.asarray(F)]
    N, A = face_data(Vw, Fw); C = Vw[Fw].mean(1)
    good = A > 1e-14
    size = scale or np.linalg.norm(Vw.max(0) - Vw.min(0))
    Cs = C / size; An = A / A.sum()
    # Start: ein Proxy; füge Proxys beim schlechtesten Dreieck ein
    lab = np.zeros(len(F), int); planes = [_fit(N, Cs, An, np.arange(len(F)))]
    def cost(P):
        n = np.array([p[0] for p in P]); d = np.array([p[1] for p in P])
        return (N @ n.T - 0) * 0 + ((1 - N @ n.T) * 2 + 40 * (Cs @ n.T - d) ** 2)  # |dn|² = 2-2cos
    for _ in range(iters * 4):
        for _ in range(iters):
            K = cost(planes); new = K.argmin(1)
            if (new == lab).all(): break
            lab = new
            planes = [_fit(N, Cs, An, np.nonzero(lab == k)[0]) if (lab == k).any() else planes[k] for k in range(len(planes))]
        K = cost(planes); err = An * K[np.arange(len(F)), lab]
        # Fehler pro Proxy; Gesamtfehler
        if err.sum() < tol or len(planes) >= max_planes: break
        per = np.bincount(lab, weights=err, minlength=len(planes)); k = int(per.argmax())
        mem = np.nonzero(lab == k)[0]; worst = mem[err[mem].argmax()]
        planes.append((N[worst], N[worst] @ Cs[worst])); 
        # neue Ebene durch das schlechteste Dreieck; die schlechtesten ~Hälfte des Proxys wechselt dorthin
        lab[mem[err[mem] > np.median(err[mem])]] = len(planes) - 1
        planes[-1] = _fit(N, Cs, An, np.nonzero(lab == len(planes) - 1)[0])
    # Zusammenhangskomponenten je Proxy trennen
    fa, fb, _ = _adjacency(Fw)
    same = lab[fa] == lab[fb]
    g = sparse.coo_matrix((np.ones(same.sum()), (fa[same], fb[same])), shape=(len(F),) * 2)
    _, comp = connected_components(g, directed=False)
    lab = comp
    # Splitter (< min_area) an den Nachbarn mit der längsten Grenze kleben
    for _ in range(200):
        area = np.bincount(lab, weights=An); small = [k for k in np.argsort(area) if 0 < area[k] < min_area]
        if not small: break
        k = small[0]; m = (lab[fa] == k) ^ (lab[fb] == k)
        if not m.any(): area[k] = 1; lab[lab == k] = lab[lab != k][0] if (lab != k).any() else k; break
        other = np.where(lab[fa[m]] == k, lab[fb[m]], lab[fa[m]])
        lab[lab == k] = np.bincount(other, weights=np.ones(len(other))).argmax()
    # kleine/fast gleiche Nachbarn verschmelzen
    def refit():
        return {k: _fit(N, Cs, An, np.nonzero(lab == k)[0]) for k in np.unique(lab)}
    cm = np.cos(np.radians(merge_deg)); changed = True
    while changed:
        changed = False; P = refit()
        pairs = {(min(a, b), max(a, b)) for a, b in zip(lab[fa], lab[fb]) if a != b}
        for a, b in sorted(pairs):
            (na, da), (nb, db) = P[a], P[b]
            if na @ nb > cm and abs(da - db) < 0.02 + 0 * 1:
                lab[lab == b] = a; changed = True; break
    _, lab = np.unique(lab, return_inverse=True)
    lab = lab.astype(int)
    P = [_fit(N, Cs, An, np.nonzero(lab == k)[0]) for k in range(lab.max() + 1)]
    pn = np.array([p[0] for p in P]); pd = np.array([p[1] for p in P]) * size  # Ebene in Originaleinheiten: n·x = d
    pd = np.array([pn[k] @ (C[lab == k] * A[lab == k, None]).sum(0) / A[lab == k].sum() for k in range(len(P))])

    # Vertex-Snapping
    out = Vw.copy(); nv = len(Vw)
    vp = [set() for _ in range(nv)]
    for t in range(len(F)):
        for v in Fw[t]: vp[v].add(lab[t])
    for v in range(nv):
        ks = sorted(vp[v], key=lambda k: -A[lab == k].sum())[:4]
        n = pn[ks]; d = pd[ks]
        H = n.T @ n + reg * np.eye(3); b = n.T @ d + reg * Vw[v]
        x = np.linalg.solve(H, b)
        dv = x - Vw[v]; m = np.linalg.norm(dv)
        out[v] = Vw[v] + dv * min(1.0, max_move * size / max(m, 1e-18))
    return out, Fw, lab
