"""Oberflächen-Segmentierung der Zieldaten (procad) – Demo für die Lab-Seite.

Nimmt die exakten Ziel-Meshes der Trainingsdaten (`out/procad_v1`, Seeds -> procad exakt reproduzierbar)
und zerlegt sie in einzelne OBERFLÄCHEN (nicht nur Teile):
  1. Teil pro Dreieck aus manifold3d (`run_original_id`: Wand-Quader, Dachprisma, Schornstein, Fenster-Taschen …).
  2. Innerhalb eines Teils: Dreiecke über gemeinsame Kanten zusammenfassen, solange der Knickwinkel klein ist
     (< CREASE°). Ebenen werden so je eine Fläche, Zylindermäntel (7,5° pro Facette) bleiben eine Fläche.
  3. Name/Klasse aus Teil + Normalenrichtung (Dachfläche Süd, Giebel Ost, Wand West, Laibung …).
Zusätzlich dieselbe Form als 64³-Voxelgitter (Auflösung des Modells) mit Marching Cubes; jedes Dreieck
bekommt die Fläche des nächstgelegenen Punkts auf dem Ziel-Mesh (= so sähen Flächen-Labels im Gitter aus).

  .venv/bin/python segment_surfaces.py --out ../app/public/segdemo/objects.json
"""
import argparse, base64, glob, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sketchgen import procad  # noqa: E402

CREASE = 20.0  # Grad
DIRS = {(1, 0): "Ost (+X)", (-1, 0): "West (−X)", (0, 1): "Nord (+Y)", (0, -1): "Süd (−Y)"}


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def build(seed):
    """Wie procad.generate, aber mit dem Manifold (für die Teil-IDs)."""
    rng = np.random.default_rng(seed)
    names = list(procad.GENERATORS); p = np.array([procad.GENERATORS[k][1] for k in names])
    kind = rng.choice(names, p=p / p.sum())
    m, _, info = procad.GENERATORS[kind][0](rng)
    g = m.to_mesh()
    V = np.asarray(g.vert_properties, float)[:, :3]
    F = np.asarray(g.tri_verts, np.int64)
    ids, run = np.asarray(g.run_original_id), np.asarray(g.run_index)
    part = np.zeros(len(F), int)
    for k in range(len(ids)):
        part[run[k] // 3:run[k + 1] // 3] = k  # Teilindex in Erzeugungsreihenfolge
    order = np.argsort(ids)  # IDs steigen in Erzeugungsreihenfolge
    rank = np.empty_like(order); rank[order] = np.arange(len(order))
    return V, F, rank[part], info


def weld(V, F, eps=1e-6):
    """Positionsgleiche Vertices verschmelzen (für Kantennachbarschaft)."""
    key = np.round(V / eps).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()[F]


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    area = np.linalg.norm(n, axis=1) / 2
    return n / np.maximum(2 * area, 1e-12)[:, None], area


def segment(V, F, part):
    Fw = weld(V, F)
    N, area = face_normals(V, F)
    parent = np.arange(len(F))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a

    e = np.sort(np.r_[Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]], axis=1)
    fi = np.tile(np.arange(len(F)), 3)
    o = np.lexsort((e[:, 1], e[:, 0])); e, fi = e[o], fi[o]
    same = np.all(e[1:] == e[:-1], axis=1)
    cos = np.cos(np.radians(CREASE))
    for a, b in zip(fi[:-1][same], fi[1:][same]):
        if part[a] == part[b] and N[a] @ N[b] > cos:
            ra, rb = find(a), find(b)
            if ra != rb: parent[rb] = ra
    root = np.array([find(i) for i in range(len(F))])
    _, sid = np.unique(root, return_inverse=True)
    return sid, N, area


def dir_name(n):
    ax = int(np.argmax(np.abs(n[:2])))
    k = [0, 0]; k[ax] = int(np.sign(n[ax])) or 1
    return DIRS[tuple(k)]


def classify(shape, V, F, part, sid, N, area):
    """Teilklassen + Flächennamen."""
    nparts = part.max() + 1
    pcls = ["teil"] * nparts
    zmax_wall = V[F[part == 0]].reshape(-1, 3)[:, 2].max()
    z0 = V[:, 2].min()
    if shape == "house":
        pcls[0] = "wand"
        if nparts > 1: pcls[1] = "dach"
        for k in range(2, nparts):
            pz = V[F[part == k]].reshape(-1, 3)[:, 2]
            if k == 2 and pz.min() >= zmax_wall - 1e-6:
                pcls[k] = "schornstein"
            else:
                pcls[k] = "tuer" if pz.min() - z0 < 0.12 * (zmax_wall - z0) else "fenster"
    elif shape == "table":
        pcls = ["platte"] + ["bein"] * (nparts - 1)
    elif shape == "lathe":
        pcls = ["koerper"] * nparts
    else:
        pcls = ["koerper"] + ["merkmal"] * (nparts - 1)

    count = {}
    for k in range(nparts):
        c = pcls[k]; count[c] = count.get(c, 0) + 1
    inst, seen = {}, {}
    for k in range(nparts):
        c = pcls[k]
        seen[c] = seen.get(c, 0) + 1
        inst[k] = seen[c] if count[c] > 1 else 0

    label = {"wand": "Wand", "dach": "Dach", "schornstein": "Schornstein", "tuer": "Tür", "fenster": "Fenster",
             "platte": "Platte", "bein": "Bein", "koerper": "Körper", "merkmal": "Merkmal", "teil": "Teil"}
    surfs = []
    for s in range(sid.max() + 1):
        m = sid == s
        a = area[m].sum()
        n = (N[m] * area[m, None]).sum(0); n /= max(np.linalg.norm(n), 1e-12)
        spread = float(np.degrees(np.arccos(np.clip((N[m] @ n).min(), -1, 1))))
        k = int(np.bincount(part[m]).argmax()); c = pcls[k]
        pname = label[c] + (f" {inst[k]}" if inst[k] else "")
        curved = spread > 5
        if curved:
            kind = "mantel"; nm = f"{pname} – Mantel" if c not in ("koerper",) else "Mantel"
        elif c in ("fenster", "tuer"):  # Glas/Blatt: siehe unten
            kind = "laibung"
            nm = f"{pname} – Laibung " + ("oben" if n[2] > 0.95 else "unten" if n[2] < -0.95 else dir_name(n))
        elif n[2] > 0.95:
            kind = "oben"; nm = {"wand": "Wand-Oberseite", "schornstein": "Schornstein-Kopf"}.get(c, f"{pname} – Oberseite")
        elif n[2] < -0.95:
            kind = "unten"; nm = {"wand": "Boden", "dach": "Dachüberstand (unten)"}.get(c, f"{pname} – Unterseite")
        elif c == "dach" and n[2] > 0.15:
            kind = "dachflaeche"; nm = "Dachfläche " + dir_name(n)
        elif c == "dach":
            kind = "giebel"; nm = "Giebel " + dir_name(n)
        else:
            kind = "seite"; nm = ("Wand " if c == "wand" else f"{pname} – Seite ") + dir_name(n)
        surfs.append(dict(id=s, name=nm, part=pname, _k=k, cls=c, kind=kind, area=round(float(a), 4),
                          normal=[round(float(x), 3) for x in n]))
    # Fenster/Tür: größte Fläche des Teils = Glas/Türblatt (Taschenboden), Rest = Laibung
    for k in range(nparts):
        if pcls[k] in ("fenster", "tuer"):
            ss = [x for x in surfs if x["_k"] == k]
            big = max(ss, key=lambda x: x["area"])
            big["kind"] = "glas" if pcls[k] == "fenster" else "tuerblatt"
            big["name"] = f"{big['part']} – " + ("Glas" if pcls[k] == "fenster" else "Türblatt")
    for x in surfs: x.pop("_k")
    # doppelte Namen durchnummerieren
    cnt = {}
    for x in surfs: cnt[x["name"]] = cnt.get(x["name"], 0) + 1
    seen = {}
    for x in surfs:
        if cnt[x["name"]] > 1:
            seen[x["name"]] = seen.get(x["name"], 0) + 1; x["name"] += f" {seen[x['name']]}"
    return surfs


def voxel_variant(V, F, sid, n=64):
    import trimesh
    from scipy.spatial import cKDTree
    from skimage.measure import marching_cubes
    from realdata.build import solid_voxels
    solid = solid_voxels(V, F, n)
    vol = np.pad(solid.astype(np.float32), 1)
    Vm, Fm, _, _ = marching_cubes(vol, 0.5)
    Vm = (Vm - 1 + 0.5) / n * 2 - 1
    Fm = Fm[:, ::-1].copy()  # nach außen zeigend
    pts, fidx = trimesh.sample.sample_surface(trimesh.Trimesh(V, F, process=False), 200_000, seed=0)
    tree = cKDTree(pts)
    _, j = tree.query(Vm[Fm].mean(1))
    lab = sid[fidx[j]]
    return Vm.astype(np.float32), Fm.astype(np.uint32), lab.astype(np.uint16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="out/procad_v1")
    ap.add_argument("--out", default="../app/public/segdemo/objects.json")
    ap.add_argument("--houses", type=int, default=10)
    ap.add_argument("--others", type=int, default=2, help="je Tisch/Block/Drehkörper")
    a = ap.parse_args()

    want = {"house": a.houses, "table": a.others, "block": a.others, "lathe": a.others}
    picked, seen = [], set()
    for path in sorted(glob.glob(os.path.join(a.src, "index_*.jsonl"))):
        for line in open(path):
            r = json.loads(line)
            if "error" in r: continue
            seed = int(r["id"].split("_")[0])
            if seed in seen: continue
            seen.add(seed)
            sh = r.get("shape")
            if want.get(sh, 0) > 0:
                want[sh] -= 1; picked.append((seed, sh))
        if not any(want.values()): break

    objs = []
    for seed, sh in picked:
        V, F, part, info = build(seed)
        lo, hi = V.min(0), V.max(0)
        V = (V - (lo + hi) / 2) / (np.linalg.norm(hi - lo) / 2)  # wie generate.normalize
        sid, N, area = segment(V, F, part)
        surfs = classify(info["shape"], V, F, part, sid, N, area)
        Vv, Fv, lv = voxel_variant(V, F, sid)
        objs.append(dict(
            seed=seed, shape=info["shape"], name=f"{dict(house='Haus', table='Tisch', block='Block', lathe='Drehkörper').get(info['shape'], info['shape'])} #{seed}",
            surfaces=surfs,
            exact=dict(v=b64(V.astype(np.float32)), f=b64(F.astype(np.uint32)), s=b64(sid.astype(np.uint16)), n=len(F)),
            vox64=dict(v=b64(Vv), f=b64(Fv), s=b64(lv), n=len(Fv)),
        ))
        print(f"seed {seed:7d} {info['shape']:6s} {len(F):5d} Dreiecke  {len(surfs):3d} Flächen  64³: {len(Fv)} Dreiecke", flush=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(dict(source=a.src, crease_deg=CREASE, objects=objs), open(a.out, "w"))
    print("->", a.out, f"{os.path.getsize(a.out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
