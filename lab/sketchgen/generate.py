"""Synthetische Konzeptskizzen aus 3D-Modellen erzeugen (lokal, ohne Onshape/Blender).

Quellen: procad (prozedurale CAD-Formen, Konstruktionslinien gratis) und Mesh-Dateien
(Objaverse-GLB, OBJ, STL ...). Pro Objekt mehrere perspektivische Ansichten.

Ausgabe pro Probe (out/<shard>/<id>...):
  <id>.png          stilisierte Skizze (Graustufen)
  <id>_clean.png    saubere Linien (nur mit --clean)
  <id>_normal.png   Normalen in Kamerakoordinaten, RGBA (A = Maske)
  <id>_depth.png    Kameratiefe in 1/10000 Einheiten (uint16, 0 = Hintergrund)
  <id>.json         Kamera (K, R, t, az, el, dist, fov), Normierung, Quelle, Stil, Striche
und <out>/index_<worker>.jsonl.

Beispiele:
  python -m sketchgen.generate --procad 200 --views 3 --out out/pc --preview
  python -m sketchgen.generate --meshes 'objaverse/glb/*.glb' --views 3 --out out/obja
"""
import argparse, glob, json, os, sys, time, traceback
import multiprocessing as mp
import numpy as np
from PIL import Image

from . import procad, render as rnd, lines as ln, construct, stylize


# ---------- Quellen ----------
def normalize(V):
    lo, hi = V.min(0), V.max(0)
    c = (lo + hi) / 2
    s = 1.0 / max(np.linalg.norm(hi - lo) / 2, 1e-9)
    return c, s


def load_mesh(path):
    import trimesh
    sc = trimesh.load(path, force="scene", process=False)
    meshes = [g for g in sc.dump() if isinstance(g, trimesh.Trimesh)] if hasattr(sc, "dump") else [sc]
    if not meshes:
        raise ValueError("keine Dreiecke")
    m = trimesh.util.concatenate(meshes)
    V, F = np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)
    if path.lower().endswith((".glb", ".gltf")):  # glTF: Y oben -> Z oben
        V = V[:, [0, 2, 1]] * [1, -1, 1]
    return V, F


def make_item(spec, rng):
    """spec: ('procad', seed) | ('mesh', path). -> V, F, constr(3D), info"""
    if spec[0] == "procad":
        V, F, constr, info = procad.generate(int(spec[1]))
        info["source"] = "procad"; info["seed"] = int(spec[1])
    else:
        V, F = load_mesh(spec[1])
        if not (100 <= len(F) <= 600_000):
            raise ValueError(f"Facettenzahl {len(F)} außerhalb des Bereichs")
        c, s = normalize(V)
        Vn = (V - c) * s
        constr, cinfo = construct.mesh_construction(Vn, F, rng)
        for cl in constr:
            cl["pts"] = cl["pts"] / s + c
        info = dict(source="mesh", path=os.path.relpath(spec[1]), uid=os.path.splitext(os.path.basename(spec[1]))[0], **cinfo)
    c, s = normalize(V)
    V = (V - c) * s
    for cl in constr:
        cl["pts"] = (np.asarray(cl["pts"], float) - c) * s
    info["norm_center"] = c.tolist(); info["norm_scale"] = float(s)
    return V, F, constr, info


# ---------- Kamera ----------
def sample_camera(rng, W, H):
    u = rng.random()
    el = rng.uniform(15, 40) if u < 0.7 else rng.uniform(0, 15) if u < 0.9 else rng.uniform(40, 70)
    az = rng.uniform(0, 360)
    fov = rng.uniform(25, 55)
    dist = 1.0 / np.sin(np.radians(fov) / 2) * rng.uniform(0.85, 1.1)
    e, a = np.radians(el), np.radians(az)
    target = rng.normal(0, 0.04, 3)
    C = target + dist * np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    R, t = rnd.look_at(C, target)
    K = rnd.intrinsics(fov, W, H)
    return dict(K=K, R=R, t=t, C=C, az=float(az), el=float(el), fov=float(fov), dist=float(dist))


def project_constr(constr, cam):
    out = []
    for cl in constr:
        P = np.asarray(cl["pts"], float)
        if len(P) == 2:  # gerade Linie bleibt in Perspektive gerade, aber für Stil verdichten
            P = P[0] + np.linspace(0, 1, 24)[:, None] * (P[1] - P[0])
        uv, z = rnd.project(P, cam["K"], cam["R"], cam["t"])
        if (z <= 0.05).any():
            continue
        out.append(dict(pts=uv, kind=cl["kind"], closed=cl.get("closed", False)))
    return out


# ---------- Worker ----------
_R = None


def _init(W, H):
    global _R
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    if os.environ.get("SGEN_MEM_GB"):   # pro Worker: zu große Meshes -> MemoryError (wird als Fehler verworfen) statt OOM-Kill des ganzen Laufs
        import resource
        resource.setrlimit(resource.RLIMIT_DATA, (int(float(os.environ["SGEN_MEM_GB"]) * 2**30),) * 2)
    _R = rnd.Renderer(W, H)


def process(job):
    spec, idx, out, views, W, H, seed, save_clean, save_strokes = job[:9]
    max_ink = job[9] if len(job) > 9 else 15.0
    train = job[10] if len(job) > 10 else False   # True: Trainingspaar (Skizze 128² + Voxel 64³) direkt mitschreiben, Normal/Tiefe weglassen
    rng = np.random.default_rng(seed)
    t0 = time.time()
    try:
        V, F, constr, info = make_item(spec, rng)
        me = ln.MeshEdges(V, F, crease_deg=float(rng.uniform(30, 45)))
        _R.set_mesh(me.V, me.F)
        if train:
            from realdata.build import solid_voxels, view_voxels, crop_ink, ink_of
            solid = solid_voxels(V, F)
    except Exception as e:
        return [dict(error=f"{type(e).__name__}: {e}", spec=list(map(str, spec)))]
    shard = os.path.join(out, f"{idx // 1000:04d}")
    os.makedirs(shard, exist_ok=True)
    recs = []
    for v in range(views):
        sid = f"{idx:07d}_{v}"
        try:
            for _try in range(4):
                cam = sample_camera(rng, W, H)
                buf = _R.render(cam["K"], cam["R"], cam["t"])
                m = buf["mask"]
                if m.mean() > 0.02 and not (m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any()):
                    break
            ln.prep_buffers(buf)
            st = stylize.sample_style(rng, W)
            lines2d = ln.extract(me, cam, buf, hidden=st["hidden"])
            ink = sum(ln._length(l["pts"]) for l in lines2d if l["kind"] in ("sil", "crease"))
            if ink > max_ink * W:           # Scans/Rauschen: zu viele Innenlinien -> verwerfen
                recs.append(dict(error="clutter", ink=round(ink / W, 1), id=sid, spec=list(map(str, spec))))
                continue
            lines2d += project_constr(constr, cam)
            plan = stylize.plan_strokes(lines2d, st, rng)
            img, drawn = stylize.render(plan, st, rng, W, H)
            base = os.path.join(shard, sid)
            Image.fromarray(img).save(base + ".png", optimize=True)
            if save_clean:
                cl, _ = stylize.render(stylize.plan_strokes(lines2d, dict(st, construct=0, hidden=False, split_len=1e9), rng), st, rng, W, H, clean=True)
                Image.fromarray(cl).save(base + "_clean.png", optimize=True)
            if train:
                sk = crop_ink(ink_of(base + ".png"))
                if sk is None:
                    recs.append(dict(error="leer", id=sid, spec=list(map(str, spec)))); continue
                vox = view_voxels(solid, (cam["K"], cam["R"], cam["t"]), m, cam["K"][0, 0])
                np.savez(base + "_train.npz", sketch=sk, vox=np.packbits(vox))
            else:
                nrm = ((buf["normal"] * [1, -1, -1] + 1) * 127.5).clip(0, 255).astype(np.uint8)  # OpenGL-Stil: y oben, z zur Kamera
                Image.fromarray(np.dstack([nrm, (m * 255).astype(np.uint8)]), "RGBA").save(base + "_normal.png", optimize=True)
                dep = np.where(m, np.clip(buf["depth"] * 10000, 1, 65535), 0).astype(np.uint16)
                Image.fromarray(dep).save(base + "_depth.png")
            counts = {}
            for s in drawn:
                counts[s["kind"]] = counts.get(s["kind"], 0) + 1
            meta = dict(id=sid, **{k: info[k] for k in info},
                        camera=dict(K=cam["K"].tolist(), R=cam["R"].tolist(), t=cam["t"].tolist(), C=cam["C"].tolist(),
                                    az=cam["az"], el=cam["el"], fov=cam["fov"], dist=cam["dist"]),
                        style=st, n_strokes=len(drawn), stroke_counts=counts, size=[W, H],
                        crease_thr=me.crease_thr)
            if save_strokes:
                meta["strokes"] = [dict(kind=s["kind"], a=round(s["alpha"], 3),
                                        p=np.round(s["pts"], 1).tolist(),
                                        pr=None if s["pressure"] is None else np.round(s["pressure"], 2).tolist()) for s in drawn]
            json.dump(meta, open(base + ".json", "w"))
            recs.append(dict(id=sid, file=os.path.relpath(base, out), source=info["source"], shape=info.get("shape"), uid=info.get("uid"),
                             n_strokes=len(drawn), sec=round(time.time() - t0, 2)))
        except Exception as e:
            recs.append(dict(error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-600:], id=sid, spec=list(map(str, spec))))
    return recs


def contact_sheet(out, n=48, cols=8, tile=192, with_normal=True):
    files = sorted(glob.glob(os.path.join(out, "*/*_?.png")))[:n]
    if not files:
        return None
    per = 2 if with_normal else 1
    rows = int(np.ceil(len(files) / cols))
    sheet = Image.new("RGB", (cols * tile * per, rows * tile), "white")
    for i, f in enumerate(files):
        r, c = divmod(i, cols)
        sheet.paste(Image.open(f).convert("RGB").resize((tile, tile), Image.LANCZOS), (c * tile * per, r * tile))
        if with_normal:
            nm = Image.open(f[:-4] + "_normal.png")
            bg = Image.new("RGBA", nm.size, (255, 255, 255, 255)); bg.alpha_composite(nm)
            sheet.paste(bg.convert("RGB").resize((tile, tile)), (c * tile * per + tile, r * tile))
    p = os.path.join(out, "preview.png")
    sheet.save(p)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--procad", type=int, default=0, help="Anzahl prozeduraler CAD-Objekte")
    ap.add_argument("--procad-start", type=int, default=0)
    ap.add_argument("--meshes", default=None, help="Glob für Mesh-Dateien (glb/obj/stl)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--views", type=int, default=3)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--clean", action="store_true", help="zusätzlich saubere Linienbilder")
    ap.add_argument("--no-strokes", action="store_true", help="Strichdaten nicht ins JSON")
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()

    specs = [("procad", a.procad_start + i) for i in range(a.procad)]
    if a.meshes:
        ms = sorted(glob.glob(a.meshes))
        if a.limit:
            ms = ms[:a.limit]
        specs += [("mesh", p) for p in ms]
    os.makedirs(a.out, exist_ok=True)
    # bereits erledigte Objekte überspringen (Fortsetzen)
    jobs = []
    for i, sp in enumerate(specs):
        if os.path.exists(os.path.join(a.out, f"{i // 1000:04d}", f"{i:07d}_{a.views - 1}.json")):
            continue
        jobs.append((sp, i, a.out, a.views, a.size, a.size, a.seed * 1_000_003 + i, a.clean, not a.no_strokes))
    print(f"{len(specs)} Objekte, {len(jobs)} offen, {a.workers} Worker", flush=True)
    t0 = time.time(); done = err = 0
    idx = open(os.path.join(a.out, f"index_{os.getpid()}.jsonl"), "a")
    ctx = mp.get_context("spawn")
    with ctx.Pool(a.workers, initializer=_init, initargs=(a.size, a.size), maxtasksperchild=200) as pool:
        for recs in pool.imap_unordered(process, jobs, chunksize=1):
            for r in recs:
                idx.write(json.dumps(r) + "\n")
                if "error" in r:
                    err += 1
                else:
                    done += 1
            n = done + err
            if n and (n % 50 == 0 or n < 10):
                el = time.time() - t0
                print(f"{done} Skizzen, {err} Fehler, {done / el:.1f}/s", flush=True)
    idx.close()
    el = time.time() - t0
    print(f"fertig: {done} Skizzen, {err} Fehler in {el:.0f}s ({done / max(el, 1e-9):.2f}/s)", flush=True)
    if a.preview:
        print("Vorschau:", contact_sheet(a.out))


if __name__ == "__main__":
    main()
