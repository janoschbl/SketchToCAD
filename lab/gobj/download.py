"""GObjaverse-Ansichten für eine Liste von gobj_ids laden (Einzeldateien, fortsetzbar).

URL-Schema wie im offiziellen Skript download_gobjaverse_280k.py (richdreamer/dataset/gobjaverse):
  https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/objaverse/<gobj_id>/campos_512_v4/NNNNN/NNNNN<suffix>

  python gobj/download.py gobj/pilot.json --out gobj/data --threads 8 [--views 0-39] [--items .png,_nd.exr,.json]
"""
import argparse, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/objaverse"
ITEMS = [".json", ".png", "_albedo.png", "_hdr.exr", "_mr.png", "_nd.exr", "_ng.exr"]


def fetch(job):
    url, dst = job
    if os.path.exists(dst):
        return "skip", 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(dst + ".tmp", "wb") as f:
                n = 0
                while chunk := r.read(1 << 16):
                    f.write(chunk); n += len(chunk)
            os.replace(dst + ".tmp", dst)
            return "ok", n
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "404", 0
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return "fail", 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", help="JSON-Liste von gobj_ids")
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--views", default="0-39")
    ap.add_argument("--items", default=",".join(ITEMS))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    ids = json.load(open(a.ids))[: a.limit or None]
    lo, hi = map(int, a.views.split("-"))
    items = a.items.split(",")
    jobs = [(f"{BASE}/{g}/campos_512_v4/{v:05d}/{v:05d}{it}", os.path.join(a.out, g, f"{v:05d}", f"{v:05d}{it}"))
            for g in ids for v in range(lo, hi + 1) for it in items]
    cnt, tot, t0 = {}, 0, time.time()
    with ThreadPoolExecutor(a.threads) as ex:
        for i, (s, n) in enumerate(ex.map(fetch, jobs), 1):
            cnt[s] = cnt.get(s, 0) + 1; tot += n
            if i % 500 == 0 or i == len(jobs):
                print(f"{i}/{len(jobs)} {cnt} {tot / 1e6:.0f} MB {tot / 1e6 / (time.time() - t0):.1f} MB/s", flush=True)


if __name__ == "__main__":
    main()
