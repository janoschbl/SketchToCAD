"""Skizze (128², Tinte) -> blickausgerichtetes Voxelgitter 64³ [Tiefe, Zeile, Spalte].

Daten: realdata/build.py (CAD2Sketch + DifferSketching), realdata/build_procad.py (procad). Mehrere --data möglich,
Anteile pro Quelle über --mix. Live-Test: procad-Häuser/Dosen/Tische aus data_real/ood (Seeds < 200, nicht im Training).
  python train_real.py --data data_real data_procad --mix procad:0.5,c2s:0.25,ds:0.25 --out runs/mix_v1 --epochs 30
"""
import argparse, json, math, os, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
from model_v2 import LiftNet

ap = argparse.ArgumentParser()
ap.add_argument("--data", nargs="+", default=["data_real"]); ap.add_argument("--mix", default="")
ap.add_argument("--steps_per_epoch", type=int, default=0); ap.add_argument("--keep", type=int, default=3); ap.add_argument("--out", default="runs/real_v1")
ap.add_argument("--epochs", type=int, default=150); ap.add_argument("--bs", type=int, default=8)
ap.add_argument("--lr", type=float, default=5e-4); ap.add_argument("--ds_w", type=float, default=2.0)
ap.add_argument("--min_iou", type=float, default=0.85); ap.add_argument("--patience", type=int, default=6)
a = ap.parse_args(); os.makedirs(a.out + "/preview", exist_ok=True); dev = "cuda"
torch.backends.cudnn.benchmark = True

# Daten bleiben im Arbeitsspeicher (GPU hat neben MeshPad/voxtype nur ~3,5 GB frei); Indizes je Quelle versetzt
Xs, VPs, meta, oi, ov = [], [], [], 0, 0
for d in a.data:
    x_ = np.load(f"{d}/sketch128.npy", mmap_mode="r"); v_ = np.load(f"{d}/vox64_packed.npy", mmap_mode="r")
    Xs.append(np.ascontiguousarray(x_)); VPs.append(np.ascontiguousarray(v_))
    for m in json.load(open(f"{d}/meta.json")):
        if "error" in m: continue
        meta.append(dict(m, i=m["i"] + oi, v=m["v"] + ov))
    oi += len(x_); ov += len(v_)
X = torch.from_numpy(np.concatenate(Xs)); VP = torch.from_numpy(np.concatenate(VPs)); del Xs, VPs
ok = [m for m in meta if m["iou"] >= a.min_iou]
print(f"{len(meta)} Skizzen, {len(ok)} mit Kamera-IoU >= {a.min_iou}", flush=True)
split = {s: [m for m in ok if m["split"] == s] for s in ("train", "val", "test")}
for s, L in split.items():
    print(s, len(L), "Skizzen, je Quelle", {k: sum(m["src"] == k for m in L) for k in sorted({m["src"] for m in L})}, flush=True)
tr = split["train"]
srcs = np.array([m["src"] for m in tr])
if a.mix:   # feste Anteile je Quelle, innerhalb gleichverteilt
    share = {k: float(v) for k, v in (x.split(":") for x in a.mix.split(","))}
    w = np.array([share.get(k, 0.0) / (srcs == k).sum() for k in srcs])
else:
    w = np.where(srcs == "ds", a.ds_w, 1.0)
w = w / w.sum()
print("Anteile im Training:", {k: round(float(w[srcs == k].sum()), 3) for k in sorted(set(srcs))}, flush=True)
X = X.pin_memory(); VP = VP.pin_memory()
bits = (2 ** torch.arange(7, -1, -1, device=dev)).to(torch.uint8)

def unpack(vi):
    v = VP[vi.cpu()].to(dev, non_blocking=True)                                 # B x 32768
    return ((v[..., None] & bits) > 0).view(len(vi), 1, 64, 64, 64).float()

def batch(ms, aug):
    xi = torch.tensor([m["i"] for m in ms]); vi = torch.tensor([m["v"] for m in ms])
    x = X[xi].to(dev, non_blocking=True).float().div(255)[:, None]; y = unpack(vi)
    if aug:
        B = len(ms)
        fl = torch.rand(B, device=dev) < 0.5                                     # Spiegeln (Skizze + Spalten)
        x = torch.where(fl.view(-1, 1, 1, 1), x.flip(-1), x); y = torch.where(fl.view(-1, 1, 1, 1, 1), y.flip(-1), y)
        th = torch.rand(B, device=dev) < 0.3                                     # dickere Striche
        x = torch.where(th.view(-1, 1, 1, 1), F.max_pool2d(x, 3, 1, 1), x)
        g = torch.empty(B, 1, 1, 1, device=dev).uniform_(0.6, 1.4)              # Tintenintensität
        x = x.clamp(1e-4, 1) ** g
        sh = torch.randint(-3, 4, (2,)).tolist()                                 # kleine Verschiebung (Ausschnitt-Ungenauigkeit)
        x = torch.roll(x, shifts=sh, dims=(-2, -1))
        drop = (F.interpolate(torch.rand(B, 1, 16, 16, device=dev), 128) > 0.08).float()  # Lücken in Strichen
        x = x * torch.where(torch.rand(B, 1, 1, 1, device=dev) < 0.3, drop, torch.ones_like(drop))
    return x, y

net = LiftNet().to(dev)
print("Parameter:", round(sum(p.numel() for p in net.parameters()) / 1e6, 2), "M", flush=True)
spe = a.steps_per_epoch or math.ceil(len(tr) / a.bs); total = spe * a.epochs
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-3)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, a.lr, total_steps=total, pct_start=0.05)
scaler = torch.cuda.amp.GradScaler()

def evaluate(ms):
    net.eval(); res = []
    with torch.no_grad(), torch.autocast("cuda", torch.float16):
        for s in range(0, len(ms), a.bs):
            x, y = batch(ms[s:s + a.bs], False); p = net(x) > 0; y = y > 0.5
            res.append(((p & y).flatten(1).sum(1) / (p | y).flatten(1).sum(1).clamp(min=1)).float().cpu())
    net.train(); r = torch.cat(res).numpy()
    src = np.array([m["src"] for m in ms])
    out = dict(iou=float(r.mean()))
    for k in ("c2s", "ds", "procad"):
        out[f"iou_{k}"] = float(r[src == k].mean()) if (src == k).any() else None
    return out, r

# Live-Test: procad (nicht im Training) – Haus, Dose, Tisch …
ood = None
for d in a.data:
    if ood is None and os.path.exists(f"{d}/ood/sketch128.npy"):
        ood = dict(x=torch.from_numpy(np.load(f"{d}/ood/sketch128.npy")).to(dev),
                   y=torch.from_numpy(np.load(f"{d}/ood/vox64.npy")).to(dev), meta=json.load(open(f"{d}/ood/meta.json")))

def score_of(m, o):
    """Auswahlkriterium: echte Skizzen (DifferSketching) + procad-Formen (Haus, Dose, Tisch …), nicht CAD2Sketch-Stil."""
    parts = [m.get("iou_ds"), m.get("iou_procad")] if m.get("iou_procad") is not None else [m.get("iou_ds"), o.get("iou_ood")]
    parts = [p for p in parts if p is not None]
    return float(np.mean(parts)) if parts else m["iou"]

def depth_img(v):  # v: 64³ bool [k,row,col] -> Tiefenbild (nah = dunkel)
    v = np.asarray(v); hit = v.any(0); k = np.argmax(v, 0)
    img = np.where(hit, 40 + k * 3, 255).astype(np.uint8)
    return Image.fromarray(img).resize((192, 192), Image.NEAREST)

def ood_eval(save):
    if ood is None: return {}
    net.eval()
    with torch.no_grad(), torch.autocast("cuda", torch.float16):
        xo = ood["x"].float().div(255)[:, None]
        lg = torch.cat([net(xo[s:s + a.bs]).float() for s in range(0, len(xo), a.bs)])
    net.train(); p = lg[:, 0] > 0; y = ood["y"] > 0
    r = ((p & y).flatten(1).sum(1) / (p | y).flatten(1).sum(1).clamp(min=1)).cpu().numpy()
    if save:
        items = []
        for i, m in enumerate(ood["meta"]):
            Image.fromarray(255 - ood["x"][i].cpu().numpy()).resize((192, 192)).save(f"{a.out}/preview/s{i}.png")
            depth_img(p[i].cpu()).save(f"{a.out}/preview/p{i}.png"); depth_img(y[i].cpu()).save(f"{a.out}/preview/g{i}.png")
            items.append(dict(sketch=f"s{i}.png", pred=f"p{i}.png", gt=f"g{i}.png", name=m["name"], iou=float(r[i])))
        json.dump(dict(updated=time.time(), items=items), open(f"{a.out}/preview/preview.json", "w"))
    names = np.array([m["shape"] for m in ood["meta"]])
    return dict(iou_ood=float(r.mean()), **{f"iou_{k}": float(r[names == k].mean()) for k in sorted(set(names))})

status_path = f"{a.out}/status.json"; hist = []; t0 = time.time(); best = -1; best_ep = 0; step = 0
def write(**k):
    json.dump(dict(k, hist=hist, run=a.out, updated=time.time()), open(status_path + ".tmp", "w")); os.replace(status_path + ".tmp", status_path)
write(state="start", epoch=0, epochs=a.epochs, step=0, total=total)
rng = np.random.default_rng(0)
for ep in range(a.epochs):
    order = rng.choice(len(tr), len(tr), p=w); run = 0.0; te = time.time()
    if len(order) < spe * a.bs:
        order = rng.choice(len(tr), spe * a.bs, p=w)
    for s in range(spe):
        ms = [tr[j] for j in order[s * a.bs:(s + 1) * a.bs]]
        if not ms: break
        x, y = batch(ms, True)
        with torch.autocast("cuda", torch.float16):
            lg = net(x)
        lg = lg.float()
        bce = F.binary_cross_entropy_with_logits(lg, y, pos_weight=torch.tensor(3.0, device=dev))
        pr = torch.sigmoid(lg)
        dice = 1 - (2 * (pr * y).flatten(1).sum(1) + 1) / (pr.flatten(1).sum(1) + y.flatten(1).sum(1) + 1)
        loss = bce + dice.mean()
        opt.zero_grad(set_to_none=True); scaler.scale(loss).backward(); scaler.unscale_(opt)
        nn.utils.clip_grad_norm_(net.parameters(), 2.0); scaler.step(opt); scaler.update(); sched.step()
        step += 1; run += loss.item()
        if step % 25 == 0:
            el = time.time() - t0
            write(state="train", epoch=ep + 1, epochs=a.epochs, step=step, total=total, loss=loss.item(), lr=sched.get_last_lr()[0],
                  eta_s=el / step * (total - step), elapsed_s=el, best_val_iou=best, it_s=25 / max(time.time() - getattr(write, "t", t0), 1e-6))
            write.t = time.time()
    m, _ = evaluate(split["val"]); o = ood_eval(save=True)
    sc = score_of(m, o)
    hist.append(dict(epoch=ep + 1, loss=run / spe, score=sc, **m, **o))
    if sc > best:
        best, best_ep = sc, ep + 1; torch.save(net.state_dict(), f"{a.out}/best.pt")
    torch.save(net.state_dict(), f"{a.out}/last.pt")
    torch.save(net.state_dict(), f"{a.out}/ep{ep + 1:03d}.pt")   # jede Epoche aufheben, nur die letzten --keep behalten
    old = f"{a.out}/ep{ep + 1 - a.keep:03d}.pt"
    if ep + 1 - a.keep >= 1 and ep + 1 - a.keep != best_ep and os.path.exists(old): os.remove(old)
    f3 = lambda v: "–" if v is None else f"{v:.3f}"
    print(f"ep {ep + 1}/{a.epochs} loss {run / spe:.3f} score {sc:.3f} val {m['iou']:.3f} (c2s {f3(m['iou_c2s'])} ds {f3(m['iou_ds'])} procad {f3(m['iou_procad'])}) ood {o} | {time.time() - te:.0f}s/Ep", flush=True)
    if ep + 1 - best_ep > a.patience:
        print("Früher Abbruch: keine Verbesserung seit", a.patience, "Epochen", flush=True); break
net.load_state_dict(torch.load(f"{a.out}/best.pt")); mt, r = evaluate(split["test"]); o = ood_eval(save=True)
write(state="done", epoch=ep + 1, epochs=a.epochs, step=total, total=total, eta_s=0, elapsed_s=time.time() - t0, best_val_iou=best, test=dict(mt, **o))
print("TEST", mt, o, "beste Epoche", best_ep, flush=True)
