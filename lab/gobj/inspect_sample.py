"""Formatprüfung und Übersichtsblatt für geladene GObjaverse-Objekte.

  python gobj/inspect_sample.py gobj/pilot.json --data gobj/data --view 0 --out gobj/pilot_sheet.png
Schreibt außerdem gobj/pilot_inspect.json (Elevation, Plattenbedarf, Masken-/Tiefen-Konsistenz je Objekt).
"""
import argparse, json, math, os
import numpy as np
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2, OpenEXR


def load_view(d, v):
    rgba = cv2.imread(f"{d}/{v:05d}/{v:05d}.png", cv2.IMREAD_UNCHANGED)
    nd = OpenEXR.File(f"{d}/{v:05d}/{v:05d}_nd.exr").channels()["RGBA"].pixels.astype(np.float32)
    cam = json.load(open(f"{d}/{v:05d}/{v:05d}.json"))
    return rgba, nd, cam


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids"); ap.add_argument("--data", required=True)
    ap.add_argument("--view", type=int, default=0); ap.add_argument("--out", required=True)
    ap.add_argument("--select", default=os.path.join(os.path.dirname(__file__), "select.jsonl"))
    a = ap.parse_args()
    sel = {json.loads(l)["gobj_id"]: json.loads(l) for l in open(a.select)}
    ids = json.load(open(a.ids))
    tiles, info = [], {}
    for g in ids:
        d = os.path.join(a.data, g)
        try:
            rgba, nd, cam = load_view(d, a.view)
        except Exception as e:
            info[g] = dict(error=str(e)); continue
        al = rgba[..., 3:] / 255.
        rgb = (rgba[..., :3] * al + 255 * (1 - al)).astype(np.uint8)
        dep = nd[..., 3]
        o = np.array(cam["origin"])
        size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(d) for f in fs)
        info[g] = dict(group=sel[g]["group"], elev=round(math.degrees(math.asin(o[2] / np.linalg.norm(o))), 1),
                       mb=round(size / 1e6, 1), fg=round(float((rgba[..., 3] > 0).mean()), 3),
                       mask_agree=round(float(((rgba[..., 3] > 0) == (dep > 0)).mean()), 4))
        t = cv2.resize(rgb, (160, 160), interpolation=cv2.INTER_AREA)
        cv2.putText(t, f"{g} {sel[g]['group'][:4]}", (3, 12), cv2.FONT_HERSHEY_SIMPLEX, .35, (0, 0, 255), 1)
        tiles.append(t)
    while len(tiles) % 10:
        tiles.append(np.full((160, 160, 3), 255, np.uint8))
    rows = [np.hstack(tiles[i:i + 10]) for i in range(0, len(tiles), 10)]
    cv2.imwrite(a.out, np.vstack(rows))
    json.dump(info, open(os.path.splitext(a.out)[0] + ".json", "w"), indent=1)
    ok = [v for v in info.values() if "error" not in v]
    print(f"{len(ok)}/{len(ids)} lesbar; MB/Objekt Mittel {np.mean([v['mb'] for v in ok]):.1f}; "
          f"Elevation {min(v['elev'] for v in ok)}–{max(v['elev'] for v in ok)}°; "
          f"Maske=Tiefe>0 min {min(v['mask_agree'] for v in ok)}")


if __name__ == "__main__":
    main()
