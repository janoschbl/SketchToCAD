"""Live-Vorschau fürs Trainings-Dashboard.

Im Trainingsskript (z. B. alle paar hundert Schritte bzw. pro Epoche):

    from livepreview import write_preview, write_batch
    write_batch(run_dir, sketches[:16])                       # was gerade trainiert wird
    write_preview(run_dir, epoch, step, [dict(name=..., sketch=sk, pred=prob, gt=occ, az=az, el=el), ...])

sketch: (H,W) Werte 0..1 (1 = weiß) oder 0..255; pred/gt: (D,D,D) Voxel (Wahrscheinlichkeit bzw. 0/1),
Achsen x,y,z mit Z oben, Objekt in [-1,1]³. az/el in Grad (Kamera bei cos az·cos el, sin az·cos el, sin el)
– dann werden Vorhersage und Ground Truth aus derselben Ansicht wie die Skizze gezeigt.
Schreibt <run>/preview/*.png und <run>/preview/preview.json (atomar).
"""
import json, os, time
import numpy as np
from PIL import Image

T = 160  # Kachelgröße in Pixeln


def _img(a):
    a = np.asarray(a, np.float32)
    if a.max() > 1.5:
        a = a / 255.0
    if a.ndim == 3:
        a = a[..., 0] if a.shape[-1] in (1, 3, 4) else a[0]
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).convert("RGB").resize((T, T), Image.LANCZOS)


def render_voxels(vox, az=35.0, el=25.0, thr=0.5, color=(70, 110, 200)):
    """Orthografisches Bild eines Voxelgitters mit Z-Buffer und einfacher Schattierung."""
    v = np.asarray(vox, np.float32)
    D = v.shape[0]
    idx = np.argwhere(v > thr)
    img = np.full((T, T, 3), 255, np.uint8)
    if len(idx) == 0:
        return Image.fromarray(img)
    P = (idx + 0.5) / D * 2 - 1
    a, e = np.radians(az), np.radians(el)
    f = -np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])  # Blickrichtung
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r) + 1e-9
    u = np.cross(r, f)
    x, y, z = P @ r, P @ u, P @ f
    s = T / 3.5 * 1.0  # gleicher Maßstab wie die alte Konvention (ortho 3,5)
    px = np.clip((x * s + T / 2).astype(int), 0, T - 1)
    py = np.clip((T / 2 - y * s).astype(int), 0, T - 1)
    depth = np.full((T, T), np.inf, np.float32)
    o = np.argsort(-z)                     # hinten zuerst, vorne überschreibt
    rad = max(1, int(round(s * 2 / D * 0.75)))
    for dx in range(-rad, rad + 1):
        for dy in range(-rad, rad + 1):
            qx, qy = np.clip(px + dx, 0, T - 1), np.clip(py + dy, 0, T - 1)
            depth[qy[o], qx[o]] = np.minimum(depth[qy[o], qx[o]], z[o])
    m = np.isfinite(depth)
    d = np.where(m, depth, depth[m].max() if m.any() else 0)
    gy, gx = np.gradient(d)
    n = np.dstack([-gx * s / 4, -gy * s / 4, np.ones_like(d)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    light = np.clip(n @ np.array([0.4, 0.5, 0.77]), 0, 1) * 0.65 + 0.35
    zn = (d - d[m].min()) / (np.ptp(d[m]) + 1e-6) if m.any() else d
    shade = light * (1 - 0.25 * zn)
    for c in range(3):
        img[..., c] = np.where(m, np.clip(color[c] * shade + 60 * shade, 0, 255), 255)
    return Image.fromarray(img)


def iou(pred, gt, thr=0.5):
    p, g = np.asarray(pred) > thr, np.asarray(gt) > 0.5
    u = (p | g).sum()
    return float((p & g).sum() / u) if u else 1.0


def _atomic_json(path, obj):
    tmp = path + ".tmp"
    json.dump(obj, open(tmp, "w"))
    os.replace(tmp, path)


def write_preview(run_dir, epoch, step, items):
    d = os.path.join(run_dir, "preview"); os.makedirs(d, exist_ok=True)
    out = []
    for i, it in enumerate(items):
        az, el = it.get("az", 35.0), it.get("el", 25.0)
        _img(it["sketch"]).save(f"{d}/p{i}_sketch.png")
        render_voxels(it["pred"], az, el).save(f"{d}/p{i}_pred.png")
        rec = dict(name=str(it.get("name", i)), sketch=f"p{i}_sketch.png", pred=f"p{i}_pred.png")
        if it.get("gt") is not None:
            render_voxels(it["gt"], az, el, color=(90, 90, 90)).save(f"{d}/p{i}_gt.png")
            rec.update(gt=f"p{i}_gt.png", iou=round(iou(it["pred"], it["gt"]), 3))
        out.append(rec)
    _atomic_json(f"{d}/preview.json", dict(epoch=epoch, step=step, updated=time.time(), items=out))


def write_batch(run_dir, sketches, cols=8):
    """Kontaktbogen der gerade trainierten Skizzen."""
    d = os.path.join(run_dir, "preview"); os.makedirs(d, exist_ok=True)
    sk = list(sketches)
    if not sk:
        return
    t = 96; rows = int(np.ceil(len(sk) / cols))
    sheet = Image.new("RGB", (cols * t, rows * t), "white")
    for i, s in enumerate(sk):
        sheet.paste(_img(s).resize((t, t)), ((i % cols) * t, (i // cols) * t))
    sheet.save(f"{d}/batch.tmp.png"); os.replace(f"{d}/batch.tmp.png", f"{d}/batch.png")


if __name__ == "__main__":  # Selbsttest mit Kugel/Quader
    import sys
    run = sys.argv[1] if len(sys.argv) > 1 else "runs/_demo"
    g = np.linspace(-1, 1, 64)
    X, Y, Z = np.meshgrid(g, g, g, indexing="ij")
    ball = (X**2 + Y**2 + Z**2 < 0.5).astype(np.float32)
    box = ((abs(X) < 0.6) & (abs(Y) < 0.4) & (abs(Z) < 0.5)).astype(np.float32)
    sk = np.ones((128, 128)); sk[30:98, 30] = sk[30:98, 97] = sk[30, 30:98] = sk[97, 30:98] = 0
    write_preview(run, 1, 10, [dict(name="Kugel", sketch=sk, pred=ball * 0.8, gt=ball),
                               dict(name="Quader", sketch=sk, pred=ball, gt=box, az=60, el=30)])
    write_batch(run, [sk] * 16)
    print("ok", run)
