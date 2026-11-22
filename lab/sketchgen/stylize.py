"""Handzeichnungs-Stil für saubere 2D-Linien (cairo).

Pro Skizze wird ein "Zeichner" gezogen (Können 0=Novize .. 1=Profi). Pro Strich:
Zielfehler an den Enden (aim), Überschwung (overshoot), Bogen, niederfrequentes Wackeln,
Druckverlauf (Breite), Deckkraft nach Linientyp, gelegentliche Doppelstriche.
Konstruktionslinien blass und dünn, finale Kanten dunkel (CAD2Sketch, Abschnitt Stil).
"""
import numpy as np
import cairo

from .lines import resample, split_at_corners

FINAL = ("contour", "sil", "crease")
CONSTR = ("scaffold", "axis", "profile", "projection", "ellipse")
ORDER = {"axis": 0, "scaffold": 1, "profile": 2, "projection": 3, "ellipse": 4,
         "contour": 5, "sil": 6, "crease": 7, "hidden": 8}


def sample_style(rng, img=512):
    s = float(rng.uniform(0, 1))            # Können
    sc = img / 512
    lerp = lambda a, b: a + (b - a) * s
    return dict(
        skill=s,
        width=float(rng.uniform(0.9, 2.0) * sc),
        aim=float(lerp(3.5, 0.8) * sc),
        wobble=float(lerp(1.0, 0.3) * sc),
        bow=float(lerp(0.012, 0.004)),
        overshoot_final=float(lerp(0.01, 0.05)),
        overshoot_constr=float(lerp(0.04, 0.2)),
        restroke=float(lerp(0.35, 0.08)),
        split_len=float(lerp(90, 400) * sc),
        construct=float(np.clip(rng.normal(lerp(0.15, 0.85), 0.2), 0, 1)),
        hidden=bool(rng.random() < 0.3),
        a_final=float(rng.uniform(0.75, 1.0)),
        a_constr=float(rng.uniform(0.12, 0.4)),
        a_hidden=float(rng.uniform(0.15, 0.35)),
        contour_boost=float(rng.uniform(1.0, 1.6)),
        grain=float(rng.uniform(0.0, 0.5)),
        jitter=float(rng.uniform(0.05, 0.25) * sc),
    )


def _tangent(P, end, k=5):
    if end == 0:
        d = P[0] - P[min(k, len(P) - 1)]
    else:
        d = P[-1] - P[max(0, len(P) - 1 - k)]
    n = np.linalg.norm(d)
    return d / n if n > 1e-9 else np.zeros(2)


def _perp_noise(rng, n, L, amp):
    s = np.linspace(0, 1, n)
    y = np.zeros(n)
    for f in rng.uniform(0.5, 3.0, 3):
        y += rng.normal(0, 1) * np.sin(2 * np.pi * (f * s + rng.random()))
    return y * amp / 1.7 * min(1.0, np.sqrt(L / 100))


def deform(P, kind, st, rng):
    """Ein sauberer Strich -> verformter Strich (Punkte) + Druck pro Punkt."""
    P = resample(P, 2.0)
    if len(P) < 2:
        return None, None
    L = float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())
    constr = kind in CONSTR
    # Überschwung entlang der Endtangenten
    o = st["overshoot_constr"] if constr else st["overshoot_final"]
    if kind != "ellipse":
        e0, e1 = rng.uniform(0, o, 2) * max(L, 20)
        t0, t1 = _tangent(P, 0), _tangent(P, 1)
        P = np.r_[[P[0] + t0 * e0], P, [P[-1] + t1 * e1]]
        P = resample(P, 2.0)
    n = len(P)
    t = np.linspace(0, 1, n)
    d = np.diff(P, axis=0, prepend=P[:1]); d[0] = d[1] if n > 1 else d[0]
    nrm = np.stack([-d[:, 1], d[:, 0]], 1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    # Zielfehler: Enden verschoben, linear überblendet
    a0, a1 = rng.normal(0, st["aim"], (2, 2))
    P = P + (1 - t)[:, None] * a0 + t[:, None] * a1
    # Bogen + Wackeln + Zittern senkrecht zum Strich
    off = rng.normal(0, st["bow"]) * L * np.sin(np.pi * t)
    off += _perp_noise(rng, n, L, st["wobble"])
    off += rng.normal(0, st["jitter"], n)
    P = P + nrm * off[:, None]
    # Druck: Ein-/Auslauf + langsames Rauschen
    ramp = rng.uniform(0.05, 0.2)
    p = np.minimum(1, np.minimum(t / ramp, (1 - t) / ramp) * 0.7 + 0.3)
    p = p * rng.uniform(0.75, 1.0) * (1 + 0.15 * _perp_noise(rng, n, 100, 1.0))
    return P, np.clip(p, 0.15, 1.0)


def _split_long(P, maxlen, rng):
    L = float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())
    if L <= maxlen:
        return [P]
    k = int(np.ceil(L / maxlen))
    Q = resample(P, 1.0)
    cuts = np.linspace(0, len(Q) - 1, k + 1).astype(int)
    out = []
    for i in range(k):
        a = max(0, cuts[i] - int(rng.uniform(-3, 6)))       # kleine Lücken / Überlappungen
        b = min(len(Q), cuts[i + 1] + 1)
        if b - a > 2:
            out.append(Q[a:b])
    return out


def plan_strokes(lines, st, rng):
    """Saubere Linien -> Reihenfolge + Auswahl + Aufteilung in Einzelstriche."""
    strokes = []
    for ln in lines:
        kind = ln["kind"]
        if kind in CONSTR and rng.random() > st["construct"]:
            continue
        if kind == "hidden" and not st["hidden"]:
            continue
        P = ln["pts"]
        if kind == "ellipse":
            pieces = [P]
        else:
            pieces = split_at_corners(P, ln.get("closed", False)) if kind in FINAL else [P]
            pieces = [q for p in pieces for q in _split_long(p, st["split_len"], rng)]
        for q in pieces:
            if len(q) >= 2:
                strokes.append(dict(kind=kind, pts=q))
    # grob nach Typ, innerhalb des Typs leicht gemischt
    strokes.sort(key=lambda s: ORDER[s["kind"]] + rng.uniform(0, 0.8))
    return strokes


def render(strokes, st, rng, W=512, H=512, clean=False):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    cr = cairo.Context(surf)
    cr.set_source_rgb(1, 1, 1); cr.paint()
    cr.set_line_cap(cairo.LINE_CAP_ROUND); cr.set_line_join(cairo.LINE_JOIN_ROUND)
    drawn = []
    for s in strokes:
        kind = s["kind"]
        constr = kind in CONSTR
        mult = {"contour": st["contour_boost"], "sil": 1.1, "crease": 0.9, "hidden": 0.6}.get(kind, 0.6)
        alpha = st["a_constr"] if constr else st["a_hidden"] if kind == "hidden" else st["a_final"]
        passes = 1
        if not clean:
            if rng.random() < st["restroke"] * (1.5 if kind == "ellipse" else 1.0):
                passes = 2
        first = None
        for ps in range(passes):
            if ps and first is not None:      # Nachziehen: nah am ersten Strich, leicht versetzt
                P0, p0 = first
                n = len(P0); t = np.linspace(0, 1, n)
                sh = rng.normal(0, 0.8 * W / 512, 2) * np.sin(np.pi * t)[:, None] + _perp_noise(rng, n, 100, 0.6)[:, None]
                P, p = P0 + sh, p0 * rng.uniform(0.7, 1.0)
                w = st["width"] * mult * (0.45 + 0.55 * p)
                a = float(np.clip(alpha * 0.6, 0.05, 1))
            elif clean:
                P, p = resample(s["pts"], 2.0), None
                w = np.full(len(P), 1.2 * (W / 512))
                a = 1.0 if not constr else 0.35
            else:
                P, p = deform(s["pts"], kind, st, rng)
                if P is None:
                    continue
                w = st["width"] * mult * (0.45 + 0.55 * p)
                a = float(np.clip(alpha * rng.uniform(0.85, 1.15), 0.05, 1))
                first = (P, p)
            cr.push_group()
            cr.set_source_rgb(0, 0, 0)
            for i in range(len(P) - 1):
                cr.set_line_width(float((w[i] + w[i + 1]) / 2))
                cr.move_to(*P[i]); cr.line_to(*P[i + 1]); cr.stroke()
            cr.pop_group_to_source()
            cr.paint_with_alpha(a)
            drawn.append(dict(kind=kind, pts=P, pressure=p, alpha=a))
    buf = np.ndarray((H, W, 4), np.uint8, surf.get_data())
    img = buf[..., 1].astype(np.float32) / 255
    if not clean and st["grain"] > 0:
        from scipy import ndimage as ndi
        g = ndi.gaussian_filter(rng.random((H, W)).astype(np.float32), 0.7)
        g = (g - g.mean()) / (g.std() + 1e-6)
        ink = 1 - img
        ink = ink * np.clip(1 + 0.35 * st["grain"] * g, 0, 1.5)
        img = 1 - np.clip(ink, 0, 1)
    return (np.clip(img, 0, 1) * 255).astype(np.uint8), drawn
