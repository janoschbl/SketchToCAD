"""Variante A+: LiftNet auf ausgewogenem Mix procad + CAD2Sketch + DifferSketching.

Gegen das Auswendiglernen des CAD2Sketch-Stils:
- feste Anteile pro Quelle (--mix procad:c2s:ds), Epoche = feste Schrittzahl statt "einmal alles"
- Auswahl des besten Stands nach score = Mittel(DifferSketching-Val, procad-Val, Live-Test Häuser/Dosen/Tische), NICHT nach CAD2Sketch
- EMA-Gewichte, jede Epoche gespeichert (fp16, ep_XXX.pt)
Gegen Löcher/Klumpen:
- Projektions-Loss: weiche Silhouette entlang aller drei Achsen muss zur Ziel-Silhouette passen
- stärkere Stil-Verfremdung (dünner/dicker, Unschärfe, Lücken, Rauschen)

  python train_mix.py --data data_real data_procad --out runs/mix_v1 --epochs 20
"""
import argparse, copy, json, math, os, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
from model_v2 import LiftNet

ap = argparse.ArgumentParser()
ap.add_argument("--data", nargs="+", default=["data_real", "data_procad"]); ap.add_argument("--out", default="runs/mix_v1")
ap.add_argument("--ood", default="data_real/ood")
ap.add_argument("--epochs", type=int, default=20); ap.add_argument("--steps", type=int, default=4000, help="Schritte pro Epoche")
ap.add_argument("--bs", type=int, default=8); ap.add_argument("--lr", type=float, default=5e-4)
ap.add_argument("--mix", default="procad:0.5,c2s:0.2,ds:0.3"); ap.add_argument("--proj_w", type=float, default=0.5)
ap.add_argument("--ema", type=float, default=0.999); ap.add_argument("--min_iou", type=float, default=0.85)
ap.add_argument("--band_w", type=float, default=0.0, help="Zusatzgewicht der BCE in 2-Voxel-Schale um die Zieloberfläche")
ap.add_argument("--crease_w", type=float, default=0.0, help="weiteres Zusatzgewicht an Kanten/Ecken des Ziels")
ap.add_argument("--grad_w", type=float, default=0.0, help="L1 zwischen räumlichen Gradienten von Vorhersage und Ziel (scharfe Ränder)")
ap.add_argument("--bin_w", type=float, default=0.0, help="Binarisierung p(1-p) in der Schale (keine weichen Übergänge)")
ap.add_argument("--val_cap", type=int, default=800); ap.add_argument("--init", default="")
a = ap.parse_args(); os.makedirs(a.out + "/preview", exist_ok=True); dev = "cuda"
torch.backends.cudnn.benchmark = True
mix = {k: float(v) for k, v in (p.split(":") for p in a.mix.split(","))}

# --- Daten (bleiben im RAM, nur der Batch geht auf die GPU) ---
Xs, VPs, items = [], [], []
for d, root in enumerate(a.data):
    Xs.append(torch.from_numpy(np.load(f"{root}/sketch128.npy", mmap_mode="r")[:].copy()))
    VPs.append(torch.from_numpy(np.load(f"{root}/vox64_packed.npy", mmap_mode="r")[:].copy()))
    for m in json.load(open(f"{root}/meta.json")):
        if "error" not in m and m.get("iou", 1) >= a.min_iou:
            m["d"] = d; items.append(m)
split = {s: [m for m in items if m["split"] == s] for s in ("train", "val", "test")}
for s, L in split.items():
    print(s, {src: sum(m["src"] == src for m in L) for src in mix}, flush=True)
tr = split["train"]
cnt = {src: sum(m["src"] == src for m in tr) for src in mix}
w = np.array([mix[m["src"]] / cnt[m["src"]] for m in tr]); w /= w.sum()
rng = np.random.default_rng(0)
val = {}
for src in mix:
    L = [m for m in split["val"] if m["src"] == src]
    val[src] = [L[i] for i in sorted(rng.choice(len(L), min(a.val_cap, len(L)), replace=False))] if L else []
bits = (2 ** torch.arange(7, -1, -1, device=dev)).to(torch.uint8)


def batch(ms, aug):
    x = torch.stack([Xs[m["d"]][m["i"]] for m in ms]).to(dev, non_blocking=True).float().div(255)[:, None]
    v = torch.stack([VPs[m["d"]][m["v"]] for m in ms]).to(dev, non_blocking=True)
    y = ((v[..., None] & bits) > 0).view(len(ms), 1, 64, 64, 64).float()
    if aug:
        B = len(ms); r = lambda p: (torch.rand(B, 1, 1, 1, device=dev) < p)
        fl = r(0.5)                                                               # Spiegeln (Skizze + Spalten)
        x = torch.where(fl, x.flip(-1), x); y = torch.where(fl[..., None], y.flip(-1), y)
        x = torch.where(r(0.25), F.max_pool2d(x, 3, 1, 1), x)                    # dicker
        x = torch.where(r(0.15), -F.max_pool2d(-x, 3, 1, 1) * 0.5 + x * 0.5, x)  # dünner/blasser
        x = torch.where(r(0.25), F.avg_pool2d(x, 3, 1, 1) * 1.5, x).clamp(0, 1)  # unscharf (Bleistift)
        g = torch.empty(B, 1, 1, 1, device=dev).uniform_(0.5, 1.6)              # Tintenintensität / Druck
        x = x.clamp(1e-4, 1) ** g
        sh = torch.randint(-3, 4, (2,)).tolist()                                 # Ausschnitt-Ungenauigkeit
        x = torch.roll(x, shifts=sh, dims=(-2, -1))
        drop = (F.interpolate(torch.rand(B, 1, 16, 16, device=dev), 128) > 0.12).float()  # Lücken in Strichen
        x = x * torch.where(r(0.4), drop, torch.ones_like(drop))
        sp = (torch.rand_like(x) < 0.002).float() * torch.rand_like(x)          # Papierrauschen/Krümel
        x = torch.where(r(0.2), (x + sp).clamp(0, 1), x)
        x = x * torch.empty(B, 1, 1, 1, device=dev).uniform_(0.7, 1.0)          # Kontrast
    return x, y


def proj_loss(lg, y):
    """Weiche Silhouette (P(mind. ein Voxel belegt)) entlang Tiefe/Zeile/Spalte gegen Ziel-Silhouette."""
    ls = F.logsigmoid(-lg)                                                       # log(1-p)
    out = 0
    for ax in (2, 3, 4):
        lq = ls.sum(ax).clamp(max=-1e-4)                                         # log P(alle leer)
        t = y.amax(ax)
        # p = 1-exp(lq): BCE stabil in log-Form
        out = out + (-(t * torch.log(-torch.expm1(lq)) + (1 - t) * lq)).mean()
    return out / 3


def edge_losses(lg, y):
    """Kanten-bewusste Verluste: gewichtete BCE (Schale/Kanten), Gradientenverlust, Binarisierung."""
    mx, mn = F.max_pool3d(y, 5, 1, 2), -F.max_pool3d(-y, 5, 1, 2)
    band = (mx - mn).clamp(0, 1)                                         # 1 nahe der Oberfläche (±2 Voxel)
    crease = band * ((F.avg_pool3d(y, 7, 1, 3) - 0.5).abs() > 0.1).float()  # ebene Flächen ~0,5, Kanten/Ecken weichen ab
    wmap = 1 + a.band_w * band + a.crease_w * crease
    pr = torch.sigmoid(lg)
    bce = (F.binary_cross_entropy_with_logits(lg, y, pos_weight=torch.tensor(3.0, device=lg.device), reduction="none") * wmap).sum() / wmap.sum()
    g = sum((pr.diff(dim=d).abs() - y.diff(dim=d).abs()).abs().mean() for d in (2, 3, 4)) / 3
    bn = (pr * (1 - pr) * band).sum() / band.sum().clamp(min=1)
    return bce, g, bn


net = LiftNet().to(dev)
if a.init:
    net.load_state_dict(torch.load(a.init, map_location=dev)); print("init von", a.init, flush=True)
ema = copy.deepcopy(net).eval()
for p in ema.parameters(): p.requires_grad_(False)
print("Parameter:", round(sum(p.numel() for p in net.parameters()) / 1e6, 2), "M", flush=True)
total = a.steps * a.epochs
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-3)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, a.lr, total_steps=total, pct_start=0.05)
scaler = torch.cuda.amp.GradScaler()


def iou_of(model, x, y):
    with torch.no_grad(), torch.autocast("cuda", torch.float16):
        p = model(x) > 0
    y = y > 0.5
    return ((p & y).flatten(1).sum(1) / (p | y).flatten(1).sum(1).clamp(min=1)).float().cpu()


def evaluate(model, ms):
    if not ms: return None
    return float(torch.cat([iou_of(model, *batch(ms[s:s + a.bs], False)) for s in range(0, len(ms), a.bs)]).mean())


ood = dict(x=torch.from_numpy(np.load(f"{a.ood}/sketch128.npy")).to(dev), y=torch.from_numpy(np.load(f"{a.ood}/vox64.npy")).to(dev),
           meta=json.load(open(f"{a.ood}/meta.json")))


def depth_img(v):
    v = np.asarray(v); hit = v.any(0); k = np.argmax(v, 0)
    return Image.fromarray(np.where(hit, 40 + k * 3, 255).astype(np.uint8)).resize((192, 192), Image.NEAREST)


def ood_eval(model, save):
    xo = ood["x"].float().div(255)[:, None]
    with torch.no_grad(), torch.autocast("cuda", torch.float16):
        p = torch.cat([model(xo[s:s + a.bs]).float() for s in range(0, len(xo), a.bs)])[:, 0] > 0
    y = ood["y"] > 0
    r = ((p & y).flatten(1).sum(1) / (p | y).flatten(1).sum(1).clamp(min=1)).cpu().numpy()
    if save:
        its = []
        for i, m in enumerate(ood["meta"]):
            Image.fromarray(255 - ood["x"][i].cpu().numpy()).resize((192, 192)).save(f"{a.out}/preview/s{i}.png")
            depth_img(p[i].cpu()).save(f"{a.out}/preview/p{i}.png"); depth_img(y[i].cpu()).save(f"{a.out}/preview/g{i}.png")
            its.append(dict(sketch=f"s{i}.png", pred=f"p{i}.png", gt=f"g{i}.png", name=m["name"], iou=float(r[i])))
        json.dump(dict(updated=time.time(), items=its), open(f"{a.out}/preview/preview.json", "w"))
    names = np.array([m["shape"] for m in ood["meta"]])
    return dict(iou_ood=float(r.mean()), **{f"iou_{k}": float(r[names == k].mean()) for k in sorted(set(names))})


status_path = f"{a.out}/status.json"; hist = []; t0 = time.time(); best = -1; best_ep = 0; step = 0
def write(**k):
    json.dump(dict(k, hist=hist, run=a.out, updated=time.time()), open(status_path + ".tmp", "w")); os.replace(status_path + ".tmp", status_path)
write(state="start", epoch=0, epochs=a.epochs, step=0, total=total)
tw = time.time()
for ep in range(a.epochs):
    order = rng.choice(len(tr), a.steps * a.bs, p=w); run = 0.0; te = time.time()
    for s in range(a.steps):
        x, y = batch([tr[j] for j in order[s * a.bs:(s + 1) * a.bs]], True)
        with torch.autocast("cuda", torch.float16):
            lg = net(x)
        lg = lg.float()
        if a.band_w or a.crease_w or a.grad_w or a.bin_w:
            bce, gl, bn = edge_losses(lg, y)
        else:
            bce = F.binary_cross_entropy_with_logits(lg, y, pos_weight=torch.tensor(3.0, device=dev)); gl = bn = 0.0
        pr = torch.sigmoid(lg)
        dice = 1 - (2 * (pr * y).flatten(1).sum(1) + 1) / (pr.flatten(1).sum(1) + y.flatten(1).sum(1) + 1)
        loss = bce + dice.mean() + a.proj_w * min(1.0, step / 3000) * proj_loss(lg, y) + a.grad_w * 10 * gl + a.bin_w * bn  # langsam hochfahren
        opt.zero_grad(set_to_none=True); scaler.scale(loss).backward(); scaler.unscale_(opt)
        nn.utils.clip_grad_norm_(net.parameters(), 2.0); scaler.step(opt); scaler.update(); sched.step()
        with torch.no_grad():
            dcy = min(a.ema, (1 + step) / (10 + step))
            for pe, pn in zip(ema.parameters(), net.parameters()): pe.lerp_(pn, 1 - dcy)
        step += 1; run += loss.item()
        if step % 25 == 0:
            el = time.time() - t0
            write(state="train", epoch=ep + 1, epochs=a.epochs, step=step, total=total, loss=loss.item(), lr=sched.get_last_lr()[0],
                  eta_s=el / step * (total - step), elapsed_s=el, best_val_iou=best, it_s=25 / max(time.time() - tw, 1e-6))
            tw = time.time()
    m = {f"iou_{src}": evaluate(ema, L) for src, L in val.items()}; o = ood_eval(ema, save=True)
    score = float(np.mean([v for v in (m.get("iou_ds"), m.get("iou_procad"), o["iou_ood"]) if v is not None]))
    hist.append(dict(epoch=ep + 1, loss=run / a.steps, iou=score, **m, **o))
    sd = {k: v.half() for k, v in ema.state_dict().items()}
    torch.save(sd, f"{a.out}/ep_{ep + 1:03d}.pt"); torch.save(sd, f"{a.out}/last.pt")
    if score > best:
        best, best_ep = score, ep + 1; torch.save(sd, f"{a.out}/best.pt")
    json.dump(hist, open(f"{a.out}/hist.json", "w"), indent=1)
    print(f"ep {ep + 1}/{a.epochs} loss {run / a.steps:.3f} score {score:.3f} " + " ".join(f"{k} {v:.3f}" for k, v in {**m, **o}.items() if v is not None)
          + f" | {time.time() - te:.0f}s/Ep", flush=True)
ema.load_state_dict({k: v.float() for k, v in torch.load(f"{a.out}/best.pt").items()})
mt = {f"iou_{src}": evaluate(ema, [x for x in split["test"] if x["src"] == src][:2000]) for src in mix}; o = ood_eval(ema, save=True)
write(state="done", epoch=ep + 1, epochs=a.epochs, step=total, total=total, eta_s=0, elapsed_s=time.time() - t0, best_val_iou=best,
      test=dict(iou=float(np.mean([v for v in mt.values() if v is not None])), **mt, **o))
print("TEST", mt, o, "beste Epoche", best_ep, flush=True)
