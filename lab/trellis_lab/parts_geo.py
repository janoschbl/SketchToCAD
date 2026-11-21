"""Geometrie für erweiterbare Modelle: Teile im gemeinsamen Bild-Koordinatensystem.

Gemeinsames Weltsystem (Y oben, wie glTF): Kamera der Skizze schaut von +X auf den Ursprung.
Bildpixel (u nach rechts, v nach unten, 512²) ↔ Welt:  Z = -(u - 256) / S,  Y = -(v - 256) / S,  X = Tiefe (zur Kamera hin +).
Jedes Teil wird so abgelegt, dass seine Projektion auf seine 2D-Maske im Bild fällt. Dadurch passen alle Teile
zueinander, ohne dass ein bestehendes Teil je neu berechnet oder verschoben werden muss.

TripoSR-Rohausgabe (geprüft per Silhouetten-Abgleich, IoU 0,89): Kamera auf +x, Bild-u ∝ +y, Bild-v ∝ -z.
"""
import hashlib

import cv2
import numpy as np
import trimesh

S = 256.0  # Pixel pro Welteinheit
K3 = np.ones((3, 3), np.uint8)


def disk(r):
    r = max(1, int(r))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def world_to_px(V):
    return 256 - V[:, 2] * S, 256 - V[:, 1] * S  # u, v


# ------------------------------------------------------------------ Masken
def stroke_region(alpha):
    """Neue Striche (Alpha > 0) → Fläche inkl. umschlossener Innenbereiche (Flügel-Umriss → ganzer Flügel)."""
    m = (alpha > 0).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(4))
    inv = (1 - m).copy()
    h, w = m.shape
    ff = np.zeros((h + 2, w + 2), np.uint8)
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if inv[y, x]:
            cv2.floodFill(inv, ff, (x, y), 0)
    return (m | inv).astype(bool)


def is_thin(region, px=10):
    if not region.any():
        return False
    return float(cv2.distanceTransform(region.astype(np.uint8), cv2.DIST_L2, 5).max()) < px


# ------------------------------------------------------------------ TripoSR-Mesh einpassen
def clean(mesh, keep=0.03):
    parts = mesh.split(only_watertight=False)
    if len(parts) <= 1:
        return mesh
    n = max(len(p.faces) for p in parts)
    return trimesh.util.concatenate([p for p in parts if len(p.faces) >= keep * n])


def place_tsr(raw, mask, depth=0.0):
    """TripoSR-Rohmesh so skalieren/verschieben, dass die Projektion die Bildmaske trifft (Bounding-Box-Abgleich)."""
    V = np.asarray(raw.vertices, dtype=np.float64)
    a, b, x = V[:, 1], -V[:, 2], V[:, 0]
    ys, xs = np.nonzero(mask)
    s = np.sqrt((np.ptp(xs) + 1) / max(np.ptp(a), 1e-6) * (np.ptp(ys) + 1) / max(np.ptp(b), 1e-6))
    u = (a - (a.min() + a.max()) / 2) * s + (xs.min() + xs.max()) / 2
    v = (b - (b.min() + b.max()) / 2) * s + (ys.min() + ys.max()) / 2
    X = (x - (x.min() + x.max()) / 2) * s / S + depth
    m = raw.copy()
    m.vertices = np.stack([X, -(v - 256) / S, -(u - 256) / S], 1)
    return m


# ------------------------------------------------------------------ Schnell: Aufblasen ohne KI
def inflate(mask, depth=0.0, rgb=None, color=None, step=2):
    """2D-Maske → rundlicher Körper (Querschnitt kreisförmig über die Distanz zum Rand), Farbe aus Bild oder fest."""
    from skimage.measure import marching_cubes
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = max(ys.min() - 4, 0), min(ys.max() + 5, mask.shape[0]), max(xs.min() - 4, 0), min(xs.max() + 5, mask.shape[1])
    sub = mask[y0:y1, x0:x1].astype(np.uint8)
    dt = cv2.distanceTransform(sub, cv2.DIST_L2, 5)
    R = max(float(dt.max()), 1.0)
    h = np.sqrt(np.clip(dt * (2 * R - dt), 0, None))  # halbe Dicke in Pixeln
    h = cv2.GaussianBlur(h, (0, 0), 1.2)[::step, ::step]
    nz = int(np.ceil(h.max() / step)) + 2
    zs = np.arange(-nz, nz + 1) * step
    vol = h[None] - np.abs(zs)[:, None, None]
    vol = np.pad(vol, 1, constant_values=-1.0)
    verts, faces, _, _ = marching_cubes(vol, 0.0)
    zpx = (verts[:, 0] - 1 - nz) * step
    vpx = (verts[:, 1] - 1) * step + y0
    upx = (verts[:, 2] - 1) * step + x0
    V = np.stack([zpx / S + depth, -(vpx - 256) / S, -(upx - 256) / S], 1)
    if rgb is not None:
        cu = np.clip(upx.round().astype(int), 0, rgb.shape[1] - 1)
        cv_ = np.clip(vpx.round().astype(int), 0, rgb.shape[0] - 1)
        cols = rgb[cv_, cu]
    else:
        cols = np.tile(np.array(color if color is not None else (180, 180, 180)), (len(V), 1))
    m = trimesh.Trimesh(V, faces[:, ::-1], vertex_colors=np.c_[cols, np.full(len(V), 255)].astype(np.uint8), process=True)
    if m.volume < 0:
        m.invert()
    trimesh.smoothing.filter_taubin(m, iterations=6)
    return m


# ------------------------------------------------------------------ Andocken
def contact_depth(parent, region, parent_mask):
    """Tiefe, an der das neue Teil am Elternteil ansetzt: Median-Tiefe der Elternpunkte im Kontaktbereich."""
    V = np.asarray(parent.vertices)
    u, v = world_to_px(V)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    zone = cv2.dilate(region.astype(np.uint8), disk(12)).astype(bool) & cv2.dilate(parent_mask.astype(np.uint8), disk(2)).astype(bool)
    sel = zone[vi, ui]
    if sel.sum() < 5:
        return float(np.median(V[:, 0])), 0
    return float(np.median(V[sel, 0])), int(sel.sum())


def recolor(mesh, region, rgb):
    """Nur Farbe: vordere Punkte des Teils im Bereich bekommen die Farbe der neuen Striche (Geometrie bleibt)."""
    V = np.asarray(mesh.vertices)
    u, v = world_to_px(V)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    sel = region[vi, ui]
    if sel.sum() == 0:
        return mesh, 0
    front = V[:, 0] >= np.median(V[sel, 0])  # zur Kamera (+X) gewandte Hälfte
    sel &= front
    cols = np.asarray(mesh.visual.vertex_colors).copy()
    cols[sel, :3] = rgb[vi[sel], ui[sel]]
    m = mesh.copy()
    m.visual.vertex_colors = cols
    return m, int(sel.sum())


def part_color_near(rgb, mask, region):
    """Farbe des Elternteils nahe dem Kontakt (für schnelle Teile ohne eigene Farbe)."""
    zone = cv2.dilate(region.astype(np.uint8), disk(14)).astype(bool) & mask
    px = rgb[zone] if zone.sum() > 20 else rgb[mask]
    return np.median(px, 0).astype(int) if len(px) else np.array([180, 180, 180])


def recolor_from_image(mesh, region, img, tol=0.035):
    """Vertexfarben der sichtbaren Vorderseite im Bereich aus dem (neu generierten) Bild übernehmen.
    Sichtbar = pro 6-px-Zelle die vordersten Punkte (größtes X, Kamera auf +X)."""
    V = np.asarray(mesh.vertices)
    u, v = world_to_px(V)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    cell = (vi // 6) * 100 + (ui // 6)
    front = np.zeros(len(V), bool)
    order = np.argsort(cell)
    cs, start = np.unique(cell[order], return_index=True)
    xs = V[order, 0]
    for k in range(len(cs)):
        a = start[k]; b = start[k + 1] if k + 1 < len(cs) else len(order)
        seg = order[a:b]
        front[seg] = xs[a:b] >= xs[a:b].max() - tol
    sel = front & region[vi, ui]
    if sel.sum() == 0:
        return mesh, 0
    cols = np.asarray(mesh.visual.vertex_colors).copy()
    cols[sel, :3] = img[vi[sel], ui[sel]]
    m = mesh.copy()
    m.visual.vertex_colors = cols
    return m, int(sel.sum())


def keep_components(mask, min_px):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    return np.isin(lab, [i for i in range(1, n) if st[i, 4] >= min_px])


def hull(mask):
    pts = cv2.findNonZero(mask.astype(np.uint8))
    out = np.zeros(mask.shape, np.uint8)
    if pts is not None:
        cv2.fillConvexPoly(out, cv2.convexHull(pts), 1)
    return out.astype(bool)


def cut_by_mask(mesh, seg):
    """Teilt ein Mesh in (Rest, herausgeschnittenes Teil) nach Projektion der Flächenmitten auf die Segmentmaske.
    Der Rest besteht aus genau den alten Flächen/Punkten (nichts wird verschoben oder neu berechnet)."""
    C = np.asarray(mesh.triangles_center)
    u, v = world_to_px(C)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    inside = seg[vi, ui]
    if inside.sum() == 0:
        return mesh, None
    rest = mesh.submesh([np.nonzero(~inside)[0]], append=True)
    part = mesh.submesh([np.nonzero(inside)[0]], append=True)
    return rest, part


def stroke_points(alpha, within, n=8):
    """Bis zu n gut verteilte Punkte (x, y) der neuen Striche, die auf dem bestehenden Objekt liegen."""
    ys, xs = np.nonzero(alpha & within)
    if len(xs) == 0:
        return []
    idx = np.linspace(0, len(xs) - 1, min(n, len(xs))).astype(int)
    order = np.lexsort((xs, ys))
    return [[int(xs[order[i]]), int(ys[order[i]])] for i in idx]


def stroke_groups(alpha, gap=18, min_px=30):
    """Räumlich getrennte Strichgruppen (z. B. Mähne und Schweif) → Liste von Masken (nur Strichpixel)."""
    n, lab = cv2.connectedComponents(cv2.dilate(alpha.astype(np.uint8), disk(gap)))
    out = [alpha & (lab == i) for i in range(1, n)]
    return [g for g in out if g.sum() >= min_px]


def partition(masks, fg, min_frac=0.02, max_parts=9):
    """SAM-Masken → Zerlegung der Figur: kleinere Masken überschreiben größere (Flosse über Rumpf).
    Label 0 = Rest („Rumpf“). Gibt Labelbild (−1 außerhalb) und Liste der Label zurück."""
    fga = max(int(fg.sum()), 1)
    cands = [m & fg for m in masks]
    cands = [m for m in cands if 0.015 * fga < m.sum() < 0.6 * fga]
    cands.sort(key=lambda m: -m.sum())
    lab = np.zeros(fg.shape, np.int32)
    for k, m in enumerate(cands, 1):
        lab[m] = k
    ids, cnt = np.unique(lab[fg], return_counts=True)
    keep = sorted([(c, i) for i, c in zip(ids, cnt) if i != 0 and c >= min_frac * fga], reverse=True)[:max_parts]
    keep = [i for _, i in keep]
    out = np.full(fg.shape, -1, np.int32)
    out[fg] = 0
    for n, i in enumerate(keep, 1):
        out[(lab == i) & fg] = n
    return out, list(range(len(keep) + 1))


def fill_nearest(lab):
    """Labels außerhalb der Figur (−1) mit dem nächsten Label füllen (für Flächen am Rand)."""
    from scipy import ndimage
    inv = lab < 0
    if not inv.any():
        return lab
    _, (iy, ix) = ndimage.distance_transform_edt(inv, return_indices=True)
    return lab[iy, ix]


def split_by_labels(mesh, lab):
    """Mesh nach projiziertem Segment-Label der Flächenmitten zerlegen → {label: Teilmesh}."""
    full = fill_nearest(lab)
    C = np.asarray(mesh.triangles_center)
    u, v = world_to_px(C)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    fl = full[vi, ui]
    out = {}
    for L in np.unique(fl):
        idx = np.nonzero(fl == L)[0]
        if len(idx) >= 20:
            out[int(L)] = mesh.submesh([idx], append=True)
    return out


# ------------------------------------------------------------------ Studio: Radieren, Umfärben, Maske aus Mesh
def recolor_through(mesh, region, img):
    """Alle Punkte, deren Projektion in region fällt (Vorder- UND Rückseite), bekommen die Bildfarbe an dieser Stelle.
    Für „Farbe tauschen“: ein blauer Flügel soll auch von hinten blau sein."""
    V = np.asarray(mesh.vertices)
    u, v = world_to_px(V)
    ui, vi = np.clip(u.round().astype(int), 0, 511), np.clip(v.round().astype(int), 0, 511)
    sel = region[vi, ui]
    if sel.sum() == 0:
        return mesh, 0
    cols = np.asarray(mesh.visual.vertex_colors).copy()
    cols[sel, :3] = img[vi[sel], ui[sel]]
    m = mesh.copy()
    m.visual.vertex_colors = cols
    return m, int(sel.sum())


def mask_from_mesh(mesh, close=3):
    """Projektion (Kamera auf +X) aller Dreiecke → 512²-Maske."""
    out = np.zeros((512, 512), np.uint8)
    T = np.asarray(mesh.triangles)
    if len(T) == 0:
        return out.astype(bool)
    u, v = world_to_px(T.reshape(-1, 3))
    pts = np.stack([u, v], 1).reshape(-1, 3, 2).round().astype(np.int32)
    cv2.fillPoly(out, list(pts), 1)
    if close:
        out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, disk(close))
    return out.astype(bool)


def keep_faces(mesh, keep):
    """Teilmesh aus den Flächen mit keep=True, kleine abgetrennte Krümel weg. None, wenn (fast) nichts bleibt."""
    idx = np.nonzero(keep)[0]
    if len(idx) < 8:
        return None
    if len(idx) == len(mesh.faces):
        return mesh
    m = mesh.submesh([idx], append=True)
    return clean(m, 0.02)


def faces_in_spheres(mesh, centers, radius):
    """Flächen, deren Mitte in einer der Kugeln (Radierer im 3D-Fenster) liegt."""
    C = np.asarray(mesh.triangles_center)
    hit = np.zeros(len(C), bool)
    for c in np.asarray(centers, dtype=np.float64).reshape(-1, 3):
        hit |= ((C - c) ** 2).sum(1) <= radius * radius
    return hit
