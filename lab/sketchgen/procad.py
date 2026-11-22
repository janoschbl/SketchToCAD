"""Prozedurale CAD-artige Formen (manifold3d) inkl. Konstruktionslinien.

Jede Form liefert (V, F, constr, info). constr ist eine Liste von dicts
{pts: (N,3), kind: scaffold|profile|projection|axis|ellipse, closed: bool} im selben
Koordinatensystem wie das Mesh. Z ist oben, Boden auf z=0 (vor Normalisierung).

Grammatik grob nach CAD2Sketch (Supplemental): Quader -> Extrusionen (+/-, Rechteck/Kreis)
-> Fase/Verrundung, erweitert um Haus, Drehkörper und gestapelte Primitive.
"""
import numpy as np
import manifold3d as mf

SEG = 48  # Kreissegmente: 7,5° pro Facette, unter jeder Faltkanten-Schwelle


# ---------- Hilfen ----------
def _mesh(m):
    g = m.to_mesh()
    V = np.asarray(g.vert_properties, float)[:, :3]
    F = np.asarray(g.tri_verts, np.int64)
    return V, F


def _circle(c, u, v, r, n=SEG):
    a = np.linspace(0, 2 * np.pi, n + 1)
    return c + r * (np.cos(a)[:, None] * u + np.sin(a)[:, None] * v)


def _rect(c, u, v, hu, hv):
    return np.array([c - hu * u - hv * v, c + hu * u - hv * v, c + hu * u + hv * v, c - hu * u + hv * v, c - hu * u - hv * v])


def _seg(a, b, kind):
    return dict(pts=np.array([a, b], float), kind=kind, closed=False)


def box_edges(lo, hi, kind="scaffold"):
    x0, y0, z0 = lo; x1, y1, z1 = hi
    P = np.array([[x, y, z] for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)])
    E = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    return [_seg(P[a], P[b], kind) for a, b in E]


def _place(m, origin, u, v, n):
    """Lokales (u,v,n)-System -> Welt."""
    M = np.column_stack([u, v, n, origin])
    return m.transform(M.tolist())


def _rounded_rect(hx, hy, r):
    cs = mf.CrossSection.square([2 * hx, 2 * hy], center=True)
    if r > 0:
        cs = cs.offset(-r, mf.JoinType.Miter).offset(r, mf.JoinType.Round, circular_segments=SEG)
    return cs


# ---------- Formen ----------
FACES = {  # name: (normal, u, v)
    "top": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    "+x": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "-x": ((-1, 0, 0), (0, -1, 0), (0, 0, 1)),
    "+y": ((0, 1, 0), (-1, 0, 0), (0, 0, 1)),
    "-y": ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
}


def _face_frame(lo, hi, name):
    n, u, v = (np.array(a, float) for a in FACES[name])
    c = (lo + hi) / 2
    half = (hi - lo) / 2
    origin = c + n * (np.abs(n) @ half)
    hu, hv = np.abs(u) @ half, np.abs(v) @ half
    return origin, u, v, n, hu, hv


def block(rng):
    hx, hy, hz = rng.uniform(0.3, 0.8, 3)
    lo, hi = np.array([-hx, -hy, 0]), np.array([hx, hy, 2 * hz])
    constr = box_edges(lo, hi)
    fillet = rng.random() < 0.35
    r = rng.uniform(0.05, 0.35) * min(hx, hy) if fillet else 0
    m = mf.Manifold.extrude(_rounded_rect(hx, hy, r), 2 * hz).translate([0, 0, 0])
    constr.append(dict(pts=np.array([[0, 0, -0.1 * hz], [0, 0, 2.2 * hz]]), kind="axis", closed=False))
    mirror = rng.random() < 0.35
    ops = []
    for _ in range(rng.integers(1, 5)):
        face = rng.choice(list(FACES), p=[0.4, 0.15, 0.15, 0.15, 0.15])
        o, u, v, n, hu, hv = _face_frame(lo, hi, face)
        circ = rng.random() < 0.45
        add = rng.random() < 0.55
        grid = np.array([-0.5, -0.25, 0, 0.25, 0.5])
        if circ:
            rad = rng.uniform(0.15, 0.6) * min(hu, hv); su = sv = rad
        else:
            su, sv = rng.uniform(0.15, 0.75) * hu, rng.uniform(0.15, 0.75) * hv
        cu = rng.choice(grid) * 2 * (hu - su); cv = rng.choice(grid) * 2 * (hv - sv)
        thick = np.abs(n) @ (hi - lo)
        d = rng.uniform(0.15, 0.6) * (1 if add else min(1.0, thick))
        if not add and rng.random() < 0.25:
            d = thick + 0.02  # Durchgangsloch
        cs = mf.CrossSection.circle(rad, SEG) if circ else mf.CrossSection.square([2 * su, 2 * sv], center=True)
        s0, s1 = (-0.001, d) if add else (-d, 0.01)
        tool = mf.Manifold.extrude(cs, s1 - s0).translate([cu * 0 + 0, 0, s0])
        tool = tool.translate([cu, cv, 0])
        faces = [face]
        if mirror and face in ("+x", "-x"):
            faces.append("-x" if face == "+x" else "+x")
        for fc in faces:
            o2, u2, v2, n2, _, _ = _face_frame(lo, hi, fc)
            t = _place(tool, o2, u2, v2, n2)
            m = (m + t) if add else (m - t)
            c0 = o2 + cu * u2 + cv * v2
            far = c0 + n2 * (d if add else -min(d, thick))
            if circ:
                constr += [dict(pts=_circle(c0, u2, v2, rad), kind="ellipse", closed=True),
                           dict(pts=_circle(far, u2, v2, rad), kind="ellipse", closed=True),
                           dict(pts=_rect(c0, u2, v2, rad, rad), kind="profile", closed=True),
                           _seg(c0 - 1.3 * rad * u2, c0 + 1.3 * rad * u2, "axis"),
                           _seg(c0 - 1.3 * rad * v2, c0 + 1.3 * rad * v2, "axis"),
                           _seg(c0 - 0.2 * n2 * d, far + 0.2 * (far - c0), "axis")]
                corners = [c0 + rad * s * w for w in (u2, v2) for s in (-1, 1)]
            else:
                constr += [dict(pts=_rect(c0, u2, v2, su, sv), kind="profile", closed=True),
                           dict(pts=_rect(far, u2, v2, su, sv), kind="profile", closed=True)]
                corners = [c0 + a * su * u2 + b * sv * v2 for a in (-1, 1) for b in (-1, 1)]
            for p in corners:
                constr.append(_seg(p, p + (far - c0), "projection"))
        ops.append(dict(face=str(face), circle=bool(circ), add=bool(add)))
    if rng.random() < 0.3:  # Fase an einer senkrechten Kante
        sx, sy = rng.choice([-1, 1], 2)
        c = rng.uniform(0.1, 0.4) * min(hx, hy)
        cut = mf.Manifold.cube([2 * c, 2 * c, 2 * hz + 0.2], center=True).rotate([0, 0, 45]).translate([sx * hx, sy * hy, hz])
        m = m - cut
        for z in (0, 2 * hz):
            constr.append(_seg([sx * hx - sx * c * 1.41, sy * hy, z], [sx * hx, sy * hy - sy * c * 1.41, z], "profile"))
        ops.append(dict(chamfer=True))
    return m, constr, dict(shape="block", fillet=bool(fillet), mirror=bool(mirror), ops=ops)


def house(rng):
    hx, hy, hz = rng.uniform(0.5, 0.9), rng.uniform(0.35, 0.7), rng.uniform(0.25, 0.55)
    rh = rng.uniform(0.25, 0.7)
    ov = rng.uniform(0, 0.08)
    m = mf.Manifold.cube([2 * hx, 2 * hy, 2 * hz]).translate([-hx, -hy, 0])
    tri = mf.CrossSection([[[-hy - ov, 0], [hy + ov, 0], [0, rh]]])
    roof = mf.Manifold.extrude(tri, 2 * hx + 2 * ov).translate([0, 0, -hx - ov])
    roof = roof.transform([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 2 * hz]])
    m = m + roof
    constr = box_edges([-hx, -hy, 0], [hx, hy, 2 * hz])
    constr += box_edges([-hx - ov, -hy - ov, 2 * hz], [hx + ov, hy + ov, 2 * hz + rh], "scaffold")
    for x in (-hx - ov, hx + ov):
        constr.append(dict(pts=np.array([[x, -hy - ov, 2 * hz], [x, hy + ov, 2 * hz], [x, 0, 2 * hz + rh], [x, -hy - ov, 2 * hz]]), kind="profile", closed=True))
        constr.append(_seg([x, 0, 0], [x, 0, 2 * hz + rh * 1.15], "axis"))
    if rng.random() < 0.6:  # Schornstein
        cx_, cy_ = rng.uniform(-0.6, 0.6) * hx, rng.uniform(0.15, 0.6) * hy
        s = rng.uniform(0.06, 0.14)
        ch = mf.Manifold.cube([2 * s, 2 * s, rh + 0.25]).translate([cx_ - s, cy_ - s, 2 * hz])
        m = m + ch
        constr += box_edges([cx_ - s, cy_ - s, 2 * hz], [cx_ + s, cy_ + s, 2 * hz + rh + 0.25])
    for _ in range(rng.integers(0, 4)):  # Fenster/Tür als flache Taschen
        face = rng.choice(["+y", "-y", "+x", "-x"])
        o, u, v, n, hu, hv = _face_frame(np.array([-hx, -hy, 0]), np.array([hx, hy, 2 * hz]), face)
        su, sv = rng.uniform(0.08, 0.3) * hu, rng.uniform(0.15, 0.45) * hv
        cu, cv = rng.uniform(-1, 1) * (hu - su) * 0.8, rng.uniform(-0.6, 0.6) * (hv - sv)
        t = mf.Manifold.extrude(mf.CrossSection.square([2 * su, 2 * sv], center=True), 0.06).translate([cu, cv, -0.05])
        m = m - _place(t, o, u, v, n)
        constr.append(dict(pts=_rect(o + cu * u + cv * v, u, v, su, sv), kind="profile", closed=True))
    return m, constr, dict(shape="house")


def lathe(rng):
    H = rng.uniform(0.8, 2.0)
    k = rng.integers(2, 6)
    z = np.sort(np.r_[0, rng.uniform(0.05, 0.95, k - 1), 1]) * H
    r = rng.uniform(0.15, 0.6, k + 1)
    if rng.random() < 0.35:  # Dose/Zylinder
        r[:] = r[0]
    zs = np.linspace(0, H, 40)
    rs = np.interp(zs, z, r)
    if rng.random() < 0.6:  # geglättetes Profil
        rs = np.convolve(np.r_[[rs[0]] * 3, rs, [rs[-1]] * 3], np.ones(7) / 7, "valid")
    poly = [[0, 0]] + [[float(a), float(b)] for a, b in zip(rs, zs)] + [[0, H]]
    m = mf.Manifold.revolve(mf.CrossSection([poly]), SEG)
    R = rs.max()
    constr = box_edges([-R, -R, 0], [R, R, H])
    constr.append(_seg([0, 0, -0.1 * H], [0, 0, 1.12 * H], "axis"))
    ex, ey, ez = np.eye(3)
    for zz in sorted({0.0, float(H), float(zs[np.argmax(rs)])}):
        rr = float(np.interp(zz, zs, rs))
        constr.append(dict(pts=_circle(np.array([0, 0, zz]), ex, ey, rr), kind="ellipse", closed=True))
        constr.append(_seg([-R, 0, zz], [R, 0, zz], "axis")); constr.append(_seg([0, -R, zz], [0, R, zz], "axis"))
    return m, constr, dict(shape="lathe", cylinder=bool(np.ptp(r) == 0))


def stack(rng):
    """Gestapelte Primitive (Lampe, Tisch, Schneemann ...)."""
    z0 = 0.0; m = None; constr = []
    ex, ey, ez = np.eye(3)
    if rng.random() < 0.3:  # Tisch: Platte + 4 Beine
        hx, hy = rng.uniform(0.5, 0.9), rng.uniform(0.3, 0.7)
        lh, th, lr = rng.uniform(0.4, 0.9), rng.uniform(0.04, 0.12), rng.uniform(0.03, 0.08)
        m = mf.Manifold.cube([2 * hx, 2 * hy, th]).translate([-hx, -hy, lh])
        constr += box_edges([-hx, -hy, 0], [hx, hy, lh + th])
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = sx * (hx - 2 * lr), sy * (hy - 2 * lr)
                m = m + mf.Manifold.cylinder(lh, lr, lr, SEG).translate([px, py, 0])
                constr.append(_seg([px, py, 0], [px, py, lh], "axis"))
        return m, constr, dict(shape="table")
    for i in range(rng.integers(2, 4)):
        kind = rng.choice(["box", "cyl", "cone", "sphere"])
        s = rng.uniform(0.2, 0.6) * (0.85 ** i)
        h = rng.uniform(0.2, 0.8)
        if kind == "box":
            p = mf.Manifold.cube([2 * s, 2 * s * rng.uniform(0.6, 1.4), h]).translate([-s, -s, z0])
            lo, hi = np.array([-s, -s, z0]), np.array([s, s, z0 + h])
        elif kind == "sphere":
            h = 2 * s
            p = mf.Manifold.sphere(s, SEG).translate([0, 0, z0 + s])
            constr.append(dict(pts=_circle(np.array([0, 0, z0 + s]), ex, ey, s), kind="ellipse", closed=True))
            lo, hi = np.array([-s, -s, z0]), np.array([s, s, z0 + h])
        else:
            top = s if kind == "cyl" else s * rng.uniform(0.0, 0.6)
            p = mf.Manifold.cylinder(h, s, top, SEG).translate([0, 0, z0])
            for zz, rr in ((z0, s), (z0 + h, top)):
                if rr > 0:
                    constr.append(dict(pts=_circle(np.array([0, 0, zz]), ex, ey, rr), kind="ellipse", closed=True))
            lo, hi = np.array([-s, -s, z0]), np.array([s, s, z0 + h])
        constr += box_edges(lo, hi)
        m = p if m is None else m + p
        z0 += h * (0.9 if kind == "sphere" else 1.0)
    constr.append(_seg([0, 0, -0.1], [0, 0, z0 * 1.1], "axis"))
    return m, constr, dict(shape="stack")


def furniture(rng):
    """Möbel mit dünnen Beinen (Tisch, Hocker, Stuhl, Bank) - Zusatzdaten gegen fehlende Beine."""
    kind = rng.choice(["table", "stool", "chair", "bench"], p=[0.4, 0.2, 0.25, 0.15])
    if kind == "stool":
        hx = hy = rng.uniform(0.25, 0.45)
    elif kind == "chair":
        hx = hy = rng.uniform(0.3, 0.5)
    elif kind == "bench":
        hx, hy = rng.uniform(0.7, 1.1), rng.uniform(0.2, 0.35)
    else:
        hx, hy = rng.uniform(0.5, 0.95), rng.uniform(0.3, 0.75)
    lh = rng.uniform(0.35, 0.95) if kind in ("table", "bench") else rng.uniform(0.35, 0.6)
    th = rng.uniform(0.04, 0.12); lr = rng.uniform(0.03, 0.07)
    round_top = kind in ("table", "stool") and rng.random() < 0.3
    box_legs = rng.random() < 0.4
    constr = []
    if round_top:
        r = min(hx, hy)
        m = mf.Manifold.cylinder(th, r, r, SEG).translate([0, 0, lh]); hx = hy = r
    else:
        m = mf.Manifold.cube([2 * hx, 2 * hy, th]).translate([-hx, -hy, lh])
        constr += box_edges([-hx, -hy, lh], [hx, hy, lh + th])
    off = 2.0 * lr if not round_top else lr + 0.12 * hx
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * (hx - off), sy * (hy - off)
            leg = (mf.Manifold.cube([2 * lr, 2 * lr, lh]).translate([px - lr, py - lr, 0]) if box_legs
                   else mf.Manifold.cylinder(lh, lr, lr, SEG).translate([px, py, 0]))
            m = m + leg
            constr.append(_seg([px, py, 0], [px, py, lh], "axis"))
    if kind == "chair":
        bh = rng.uniform(0.3, 0.6)
        m = m + mf.Manifold.cube([2 * hx, th, bh]).translate([-hx, hy - th, lh + th])
        for sx in (-1, 1):
            m = m + mf.Manifold.cylinder(bh, lr, lr, SEG).translate([sx * (hx - off), hy - off, lh + th])
    return m, constr, dict(shape="table")


GENERATORS = dict(block=(block, 0.5), house=(house, 0.15), lathe=(lathe, 0.2), stack=(stack, 0.15))
EXTRA = dict(furniture=furniture)


def generate(seed, kind=None):
    rng = np.random.default_rng(seed)
    if kind is None:
        names = list(GENERATORS); p = np.array([GENERATORS[k][1] for k in names])
        kind = rng.choice(names, p=p / p.sum())
    import os
    kind = os.environ.get("PROCAD_KIND") or kind
    m, constr, info = (EXTRA[kind] if kind in EXTRA else GENERATORS[kind][0])(rng)
    V, F = _mesh(m)
    return V, F, constr, info
