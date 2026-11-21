"""Haus als kleines Programm (Parameter) statt als Voxel-Klumpen: exakte Kanten/Ecken, benannte Teile.

`replay(seed)` liest die Parameter eines procad-Hauses (gleiche Zufallsfolge wie sketchgen/procad.house),
`build(p)` baut daraus ein wasserdichtes Mesh mit Teilnamen (wand, dach, schornstein, fenster).
Parameter sind massstabsfrei (alles / Diagonale D), weil die Skizze nur zugeschnitten ankommt.
Vektor (VEC=36): [hx,hy,hz,rh,ov | ch_p, ch_x, ch_y, ch_s, ch_h | 3 x (p, face(4 one-hot), su, sv, cu, cv)]
"""
import numpy as np, manifold3d as mf
SEG = 4
FACES = ["+y", "-y", "+x", "-x"]
FR = {"+x": ((1, 0, 0), (0, 1, 0), (0, 0, 1)), "-x": ((-1, 0, 0), (0, -1, 0), (0, 0, 1)),
      "+y": ((0, 1, 0), (-1, 0, 0), (0, 0, 1)), "-y": ((0, -1, 0), (1, 0, 0), (0, 0, 1))}
VEC = 5 + 5 + 3 * 9


def replay(seed):
    """Wie procad.generate(seed) -> house(rng), nur mit Parameteraufzeichnung."""
    from sketchgen import procad
    rng = np.random.default_rng(seed)
    names = list(procad.GENERATORS); p = np.array([procad.GENERATORS[k][1] for k in names])
    kind = rng.choice(names, p=p / p.sum())
    assert kind == "house", kind
    hx, hy, hz = rng.uniform(0.5, 0.9), rng.uniform(0.35, 0.7), rng.uniform(0.25, 0.55)
    rh = rng.uniform(0.25, 0.7); ov = rng.uniform(0, 0.08)
    P = dict(hx=hx, hy=hy, hz=hz, rh=rh, ov=ov, chim=None, op=[])
    if rng.random() < 0.6:
        cx, cy = rng.uniform(-0.6, 0.6) * hx, rng.uniform(0.15, 0.6) * hy
        s = rng.uniform(0.06, 0.14); P["chim"] = dict(cx=cx, cy=cy, s=s, h=rh + 0.25)
    for _ in range(rng.integers(0, 4)):
        face = str(rng.choice(["+y", "-y", "+x", "-x"]))
        hu = hy if face[1] == "x" else hx; hv = hz
        su, sv = rng.uniform(0.08, 0.3) * hu, rng.uniform(0.15, 0.45) * hv
        cu, cv = rng.uniform(-1, 1) * (hu - su) * 0.8, rng.uniform(-0.6, 0.6) * (hv - sv)
        P["op"].append(dict(face=face, fu=su / hu, fv=sv / hv, cu=cu / (hu - su) / 0.8, cv=cv / (hv - sv) / 0.6))
    return P


def build(P, nrm=True):
    """-> V, F, part (Dreiecks-Teil-ID), names (Liste, Index = Teil-ID). Normiert wie generate.normalize."""
    hx, hy, hz, rh, ov = (P[k] for k in ("hx", "hy", "hz", "rh", "ov"))
    ids = {}

    def tag(m, name):
        o = m.as_original(); ids[o.original_id()] = name; return o
    m = tag(mf.Manifold.cube([2 * hx, 2 * hy, 2 * hz]).translate([-hx, -hy, 0]), "wand")
    tri = mf.CrossSection([[[-hy - ov, 0], [hy + ov, 0], [0, rh]]])
    roof = mf.Manifold.extrude(tri, 2 * hx + 2 * ov).translate([0, 0, -hx - ov])
    roof = tag(roof.transform([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 2 * hz]]), "dach")
    m = m + roof
    if P["chim"]:
        c = P["chim"]; s = c["s"]
        m = m + tag(mf.Manifold.cube([2 * s, 2 * s, c["h"]]).translate([c["cx"] - s, c["cy"] - s, 2 * hz]), "schornstein")
    for o in P["op"]:
        n, u, v = (np.array(a, float) for a in FR[o["face"]])
        half = np.array([hx, hy, hz]); ctr = np.array([0, 0, hz])
        org = ctr + n * (np.abs(n) @ half); hu, hv = np.abs(u) @ half, np.abs(v) @ half
        su, sv = o["fu"] * hu, o["fv"] * hv
        cu, cv = o["cu"] * (hu - su) * 0.8, o["cv"] * (hv - sv) * 0.6
        t = tag(mf.Manifold.extrude(mf.CrossSection.square([2 * su, 2 * sv], center=True), 0.06).translate([cu, cv, -0.05]), "fenster")
        T = np.eye(4); T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = u, v, n, org + 0  # lokale Achsen -> Welt (wie procad._place)
        m = m - t.transform(T[:3])
    g = m.to_mesh()
    V = np.asarray(g.vert_properties, float)[:, :3]; F = np.asarray(g.tri_verts, np.int64)
    rid, run = np.asarray(g.run_original_id), np.asarray(g.run_index)
    part = np.zeros(len(F), int); names = []
    for k in range(len(rid)):
        nm = ids.get(int(rid[k]), "sonstiges")
        if nm == "fenster": nm = "tuer" if False else nm
        part[run[k] // 3:run[k + 1] // 3] = k; names.append(nm)
    if nrm:
        lo, hi = V.min(0), V.max(0); V = (V - (lo + hi) / 2) / (np.linalg.norm(hi - lo) / 2)
    return V, F, part, names


def encode(P):
    D = np.linalg.norm([2 * P["hx"] + 2 * P["ov"], 2 * P["hy"] + 2 * P["ov"], 2 * P["hz"] + P["rh"]])
    v = np.zeros(VEC, np.float32); v[:5] = np.array([P["hx"], P["hy"], P["hz"], P["rh"], P["ov"]]) / D
    c = P["chim"]
    if c: v[5:10] = [1, c["cx"] / P["hx"], c["cy"] / P["hy"], c["s"] / D, c["h"] / D]
    for k, o in enumerate(P["op"][:3]):
        b = 10 + 9 * k; v[b] = 1; v[b + 1 + FACES.index(o["face"])] = 1; v[b + 5:b + 9] = [o["fu"], o["fv"], o["cu"], o["cv"]]
    return v


def decode(v, thr=0.5):
    v = np.asarray(v, float); lo = lambda x, a, b: float(np.clip(x, a, b))
    P = dict(hx=lo(v[0], .15, 1.5), hy=lo(v[1], .1, 1.2), hz=lo(v[2], .08, 1.0), rh=lo(v[3], .05, 1.2), ov=lo(v[4], 0, .15), chim=None, op=[])
    if v[5] > thr: P["chim"] = dict(cx=lo(v[6], -.9, .9) * P["hx"], cy=lo(v[7], -.9, .9) * P["hy"], s=lo(v[8], .02, .3), h=lo(v[9], .1, 1.5))
    for k in range(3):
        b = 10 + 9 * k
        if v[b] > thr:
            P["op"].append(dict(face=FACES[int(np.argmax(v[b + 1:b + 5]))], fu=lo(v[b + 5], .05, .6), fv=lo(v[b + 6], .1, .7), cu=lo(v[b + 7], -1, 1), cv=lo(v[b + 8], -1, 1)))
    return P
