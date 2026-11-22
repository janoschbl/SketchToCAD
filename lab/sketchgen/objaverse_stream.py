"""Objaverse 1.0 im Durchlauf: Metadaten filtern -> GLB-Stapel laden -> Skizzen erzeugen -> GLB löschen.

Fortsetzbar (done_uids.txt), Download des nächsten Stapels läuft parallel zum Rendern.
Pro Objekt wird die Lizenz/Urheberangabe in attribution.jsonl festgehalten (CC-BY verlangt Nennung).

  python -m sketchgen.objaverse_stream --out out/objaverse --target 20000 --views 3
"""
import argparse, gzip, json, os, re, shutil, threading, queue, time
import multiprocessing as mp
import numpy as np

from . import generate as gen

META = os.path.expanduser("~/.objaverse/hf-objaverse-v1/metadata")
BAD = re.compile(r"scan|photogrammetry|lidar|reality ?capture|polycam|metashape|agisoft|3d ?zephyr|kiri|point ?cloud|heightmap|terrain|landscape|nsfw", re.I)
BAD_CAT = {"cultural-heritage-history", "places-travel"}  # überwiegend Fotogrammetrie / Szenen
# Bevorzugt (immer genommen): Tiere, Figuren/Fantasy, Pflanzen, Essen, Möbel; alles andere nur mit Wahrscheinlichkeit --p-other
PREFER_CAT = {"animals-pets", "characters-creatures", "nature-plants", "food-drink", "furniture-home"}
PREFER_RX = re.compile(r"\b(cat|kitten|dog|puppy|horse|unicorn|dragon|bird|owl|fish|rabbit|bunny|bear|fox|plant|flower|tree|cactus|mug|cup|chair|table|house|cottage)s?\b", re.I)


def candidates(licenses, max_mb, min_faces, max_faces, shard=({0}, 1), p_other=1.0):
    import zlib
    for i in range(160):
        p = f"{META}/{i // 1000:03d}-{i % 1000:03d}.json.gz"
        if not os.path.exists(p):
            continue
        with gzip.open(p, "rb") as f:
            d = json.load(f)
        for j, (uid, m) in enumerate(d.items()):
            if m.get("license") not in licenses or m.get("isAgeRestricted"):
                continue
            fc = m.get("faceCount") or 0
            sz = ((m.get("archives") or {}).get("glb") or {}).get("size") or 0
            if not (min_faces <= fc <= max_faces) or sz > max_mb * 1e6 or (m.get("animationCount") or 0) > 0:
                continue
            tags = " ".join(t.get("name", "") for t in (m.get("tags") or []))
            cats = {c.get("name") for c in (m.get("categories") or [])}
            text = f"{m.get('name', '')} {tags} {m.get('description', '')[:300]}"
            if BAD.search(text) or cats & BAD_CAT:
                continue
            h = zlib.crc32(uid.encode())
            if h % shard[1] not in shard[0]:
                continue
            if p_other < 1 and not (cats & PREFER_CAT or PREFER_RX.search(f"{m.get('name', '')} {tags}")) and (h >> 8) % 1000 >= p_other * 1000:
                continue
            yield i * 100000 + j, uid, dict(uid=uid, name=m.get("name"), license=m.get("license"),
                                           author=(m.get("user") or {}).get("username"), url=m.get("viewerUrl"),
                                           categories=sorted(c for c in cats if c))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=1000, help="Anzahl Objekte in diesem Lauf")
    ap.add_argument("--views", type=int, default=3)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--batch", type=int, default=200)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 4))
    ap.add_argument("--dl-procs", type=int, default=8)
    ap.add_argument("--licenses", default="cc0,by,by-sa")
    ap.add_argument("--max-mb", type=float, default=25)
    ap.add_argument("--min-faces", type=int, default=200)
    ap.add_argument("--max-faces", type=int, default=300_000)
    ap.add_argument("--keep-glb", action="store_true")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--shard", default="0/1", help="k[,k2..]/n: nur Objekte mit crc32(uid) %% n in {k..} (Aufteilung auf mehrere Rechner)")
    ap.add_argument("--p-other", type=float, default=0.3, help="Anteil nicht bevorzugter Kategorien")
    ap.add_argument("--train", action="store_true", help="Trainingspaare (_train.npz) direkt erzeugen, ohne Normal/Tiefe")
    ap.add_argument("--min-free", type=float, default=30, help="GB, darunter Abbruch")
    a = ap.parse_args()
    import objaverse

    os.makedirs(a.out, exist_ok=True)
    donef = os.path.join(a.out, "done_uids.txt")
    done = set(open(donef).read().split()) if os.path.exists(donef) else set()
    keep = set()
    pil = os.path.join(os.path.dirname(__file__), "..", "objaverse", "pilot_meta.json")
    if os.path.exists(pil):  # Pilot-GLBs nie löschen
        keep = {x["uid"] for x in json.load(open(pil))["selected"]}

    def batches():
        cur, n = [], 0
        for idx, uid, meta in candidates(set(a.licenses.split(",")), a.max_mb, a.min_faces, a.max_faces,
                                                ({int(k) for k in a.shard.split("/")[0].split(",")}, int(a.shard.split("/")[1])), a.p_other):
            if uid in done:
                continue
            cur.append((idx, uid, meta)); n += 1
            if len(cur) == a.batch or n >= a.target:
                yield cur; cur = []
            if n >= a.target:
                return
        if cur:
            yield cur

    q = queue.Queue(maxsize=1)

    def downloader():
        for b in batches():
            try:
                paths = objaverse.load_objects(uids=[u for _, u, _ in b], download_processes=a.dl_procs)
            except Exception as e:
                print("Download-Fehler:", e, flush=True); paths = {}
            q.put((b, paths))
        q.put(None)

    threading.Thread(target=downloader, daemon=True).start()
    attr = open(os.path.join(a.out, "attribution.jsonl"), "a")
    idxf = open(os.path.join(a.out, f"index_{os.getpid()}.jsonl"), "a")
    dlog = open(donef, "a")
    t0 = time.time(); nobj = nsk = nerr = 0
    ctx = mp.get_context("spawn")
    with ctx.Pool(a.workers, initializer=gen._init, initargs=(a.size, a.size), maxtasksperchild=100) as pool:
        while (item := q.get()) is not None:
            b, paths = item
            jobs, metas = [], {}
            for idx, uid, meta in b:
                p = paths.get(uid)
                if p and os.path.exists(p):
                    jobs.append((("mesh", p), idx, a.out, a.views, a.size, a.size, a.seed * 1_000_003 + idx, False, True, 15.0, a.train))
                    metas[idx] = meta
            for recs in pool.imap_unordered(gen.process, jobs, chunksize=1):
                for r in recs:
                    if "error" in r:
                        nerr += 1
                    else:
                        nsk += 1
                    idxf.write(json.dumps(r) + "\n")
            for idx, uid, meta in b:
                if idx in metas:
                    attr.write(json.dumps(dict(idx=idx, **meta)) + "\n")
                dlog.write(uid + "\n")
                p = paths.get(uid)
                if p and not a.keep_glb and uid not in keep and os.path.exists(p):
                    os.remove(p)
            attr.flush(); idxf.flush(); dlog.flush()
            nobj += len(b)
            el = time.time() - t0
            free = shutil.disk_usage(a.out).free / 1e9
            print(f"{nobj} Objekte, {nsk} Skizzen, {nerr} verworfen/Fehler, {nsk / el:.1f} Skizzen/s, {free:.0f} GB frei", flush=True)
            if free < a.min_free:
                print(f"Weniger als {a.min_free} GB frei – Abbruch."); break
    print(f"fertig nach {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
