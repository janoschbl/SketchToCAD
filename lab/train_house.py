"""Skizze + Blickwinkel -> Hausparameter (house_prog). Verlust nur auf Parametern, Bewertung mit IoU der gebauten Meshes.
  python train_house.py --epochs 40 --out runs/house_v1
"""
import argparse, json, os, sys, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_prog as H
ap = argparse.ArgumentParser(); ap.add_argument("--data", default="data_procad"); ap.add_argument("--out", default="runs/house_v1")
ap.add_argument("--epochs", type=int, default=40); ap.add_argument("--bs", type=int, default=64); ap.add_argument("--lr", type=float, default=2e-3)
ap.add_argument("--threads", type=int, default=14)
a = ap.parse_args(); torch.set_num_threads(a.threads); os.makedirs(a.out, exist_ok=True); dev = "cuda" if torch.cuda.is_available() else "cpu"

meta = [m for m in json.load(open(f"{a.data}/meta.json")) if "error" not in m and m.get("shape") == "house"]
X = np.load(f"{a.data}/sketch128.npy", mmap_mode="r")
cache = f"{a.out}/params.npz"
if os.path.exists(cache):
    z = np.load(cache); Y = z["Y"]
else:
    Y = np.stack([H.encode(H.replay(int(m["obj"]))) for m in meta]); np.savez(cache, Y=Y)
xs = torch.from_numpy(np.stack([X[m["i"]] for m in meta]).astype(np.float32) / 255)[:, None]
cam = torch.tensor([[np.sin(np.radians(m["az"])), np.cos(np.radians(m["az"])), np.sin(np.radians(m["el"])), np.cos(np.radians(m["el"]))] for m in meta], dtype=torch.float32)
Y = torch.from_numpy(Y)
sp = np.array([m["split"] for m in meta]); tr, va, te = (np.nonzero(sp == s)[0] for s in ("train", "val", "test"))
print("train", len(tr), "val", len(va), "test", len(te), flush=True)


def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, 2, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True), nn.Conv2d(o, o, 3, 1, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True))
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.f = nn.Sequential(blk(1, 32), blk(32, 64), blk(64, 128), blk(128, 192), blk(192, 256), nn.AdaptiveAvgPool2d(1), nn.Flatten())
        s.h = nn.Sequential(nn.Linear(256 + 4, 512), nn.ReLU(True), nn.Dropout(0.1), nn.Linear(512, H.VEC))
    def forward(s, x, c): return s.h(torch.cat([s.f(x), c], 1))
net = Net().to(dev)
CONT = [0, 1, 2, 3, 4]; PRES = [5] + [10 + 9 * k for k in range(3)]


def loss_fn(o, y):
    l = sum(F.smooth_l1_loss(o[:, i], y[:, i], beta=0.02) for i in CONT) * 4
    ch = y[:, 5:6]; l += F.binary_cross_entropy_with_logits(o[:, 5], y[:, 5]) * 0.5
    l += (F.smooth_l1_loss(o[:, 6:10], y[:, 6:10], beta=0.02, reduction="none") * ch).mean() * 2
    for k in range(3):
        b = 10 + 9 * k; m = y[:, b:b + 1]
        l += F.binary_cross_entropy_with_logits(o[:, b], y[:, b]) * 0.5
        l += (F.cross_entropy(o[:, b + 1:b + 5], y[:, b + 1:b + 5].argmax(1), reduction="none") * m[:, 0]).mean() * 0.3
        l += (F.smooth_l1_loss(o[:, b + 5:b + 9], y[:, b + 5:b + 9], beta=0.02, reduction="none") * m).mean() * 2
    return l


def to_vec(o):
    v = o.clone()
    for i in PRES: v[:, i] = torch.sigmoid(v[:, i])
    return v


def iou_eval(idx, n=150):
    from sketchgen import procad
    from realdata.build import solid_voxels
    net.eval(); idx = idx[:n]
    with torch.no_grad(): o = to_vec(net(xs[idx].to(dev), cam[idx].to(dev))).cpu().numpy()
    r = []
    for j, i in enumerate(idx):
        Pg = H.decode(Y[i].numpy()); Pp = H.decode(o[j])
        Vg, Fg, _, _ = H.build(Pg); Vp, Fp, _, _ = H.build(Pp)
        # Normierung beider Meshes macht den Massstab egal; gleiche Orientierung im Objektsystem
        g, p = solid_voxels(Vg, Fg, 64), solid_voxels(Vp, Fp, 64); r.append((g & p).sum() / max((g | p).sum(), 1))
    net.train(); return float(np.mean(r))


opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-2)
steps = a.epochs * (len(tr) // a.bs); sched = torch.optim.lr_scheduler.OneCycleLR(opt, a.lr, total_steps=steps, pct_start=0.1)
best = -1; t0 = time.time(); rng = np.random.default_rng(0)
for ep in range(a.epochs):
    perm = rng.permutation(tr); run = 0
    for s in range(len(tr) // a.bs):
        b = perm[s * a.bs:(s + 1) * a.bs]; x = xs[b].to(dev)
        x = x * torch.empty(len(b), 1, 1, 1, device=dev).uniform_(0.7, 1.0)
        l = loss_fn(net(x, cam[b].to(dev)), Y[b].to(dev)); opt.zero_grad(); l.backward(); nn.utils.clip_grad_norm_(net.parameters(), 2); opt.step(); sched.step(); run += l.item()
    if ep % 4 == 3 or ep == a.epochs - 1:
        v = iou_eval(va, 100)
        if v > best: best = v; torch.save(net.state_dict(), f"{a.out}/best.pt")
        print(f"ep {ep+1} loss {run/(len(tr)//a.bs):.4f} val-IoU {v:.3f} best {best:.3f} {time.time()-t0:.0f}s", flush=True)
    else: print(f"ep {ep+1} loss {run/(len(tr)//a.bs):.4f} {time.time()-t0:.0f}s", flush=True)
net.load_state_dict(torch.load(f"{a.out}/best.pt")); print("TEST-IoU", iou_eval(te, 102), flush=True)
