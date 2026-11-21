"""Kantenbasierte Segmentierung beliebiger Dreiecks-Meshes (ohne Training, ohne Teil-Labels).

Idee: Flächen sind Gebiete, in denen sich die Normale kaum ändert; Knicke (Kanten) trennen sie.
1. Vertices verschmelzen, Dreiecks-Nachbarschaft über gemeinsame Kanten.
2. Region Growing, größte Dreiecke zuerst: ein Nachbar kommt dazu, wenn der Knick zur Nachbarkante
   < CREASE und die Abweichung zur Regions-Durchschnittsnormalen < DRIFT bleibt (verhindert
   „Wegdriften“ über sanfte Rundungen, z. B. bei Marching-Cubes-Ausgaben).
3. Kleine Regionen (< MIN_AREA des Ganzen) werden an den Nachbarn mit der längsten Grenze geklebt.
"""
from __future__ import annotations

import heapq

import numpy as np

CREASE = 28.0     # Grad, größter Knick zwischen zwei Nachbardreiecken innerhalb einer Fläche
DRIFT = 40.0      # Grad, größte Abweichung zur Durchschnittsnormalen der Fläche
MIN_AREA = 0.012  # Anteil der Gesamtfläche, darunter wird eine Region angeklebt


def _weld(V, eps=1e-6):
    _, first, inv = np.unique(np.round(V / eps).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), V[first]


def face_data(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    a = np.linalg.norm(n, axis=1)
    return n / np.maximum(a, 1e-18)[:, None], a / 2


def _adjacency(F):
    """Dreieckspaare mit gemeinsamer Kante: (a, b, Kantenindex-Schlüssel)."""
    e = np.sort(np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=1)
    fi = np.tile(np.arange(len(F)), 3)
    o = np.lexsort((e[:, 1], e[:, 0]))
    e, fi = e[o], fi[o]
    same = np.all(e[1:] == e[:-1], axis=1)
    return fi[:-1][same], fi[1:][same], e[:-1][same]


def segment_faces(V, F, crease=CREASE, drift=DRIFT, min_area=MIN_AREA):
    """Gibt (Labels pro Dreieck 0..k-1, Flächenanzahl) zurück; Labels nach Fläche absteigend sortiert."""
    V = np.asarray(V, float)
    inv, Vw = _weld(V)
    Fw = inv[np.asarray(F)]
    N, A = face_data(Vw, Fw)
    ok = A > 1e-14
    fa, fb, ed = _adjacency(Fw)
    keep = ok[fa] & ok[fb]
    fa, fb, ed = fa[keep], fb[keep], ed[keep]
    nb = [[] for _ in range(len(F))]
    for a, b in zip(fa, fb):
        nb[a].append(b); nb[b].append(a)

    cc, cd = np.cos(np.radians(crease)), np.cos(np.radians(drift))
    lab = -np.ones(len(F), int)
    k = 0
    for seed in np.argsort(-A):
        if lab[seed] >= 0 or not ok[seed]:
            continue
        acc = N[seed] * A[seed]
        lab[seed] = k
        stack = [seed]
        while stack:
            f = stack.pop()
            mean = acc / max(np.linalg.norm(acc), 1e-18)
            for g in nb[f]:
                if lab[g] < 0 and N[f] @ N[g] > cc and N[g] @ mean > cd:
                    lab[g] = k; acc += N[g] * A[g]; stack.append(g)
        k += 1
    lab[lab < 0] = 0  # entartete Dreiecke

    # Kleine Regionen ankleben (längste gemeinsame Grenze, wiederholen bis stabil)
    total = A.sum()
    for _ in range(20):
        area = np.bincount(lab, weights=A, minlength=lab.max() + 1)
        small = np.nonzero((area < min_area * total) & (area > 0))[0]
        if not len(small) or len(np.nonzero(area > 0)[0]) <= 1:
            break
        la, lb = lab[fa], lab[fb]
        diff = la != lb
        pa, pb = la[diff], lb[diff]
        d = ed[diff]
        length = np.linalg.norm(Vw[d[:, 0]] - Vw[d[:, 1]], axis=1)  # Kantenlänge als Gewicht
        changed = False
        for s in small[np.argsort(area[small])]:
            m = (pa == s) | (pb == s)
            if not m.any():
                continue
            other = np.where(pa[m] == s, pb[m], pa[m])
            w = np.bincount(other, weights=length[m])
            tgt = int(w.argmax())
            if tgt == s or area[tgt] == 0:
                continue
            lab[lab == s] = tgt; area[tgt] += area[s]; area[s] = 0
            pa[pa == s] = tgt; pb[pb == s] = tgt; changed = True
        if not changed:
            break
    _, lab = np.unique(lab, return_inverse=True)
    order = np.argsort(-np.bincount(lab, weights=A))
    rank = np.empty_like(order); rank[order] = np.arange(len(order))
    return rank[lab], int(lab.max() + 1)
