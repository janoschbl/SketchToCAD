"""Skizze (128x128 Kontur + Ansicht) -> 64^3 Occupancy. Alles liegt auf der GPU, daher sehr schnell."""
import json, math, os, sys, time, argparse, numpy as np, torch, torch.nn as nn, torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data"); ap.add_argument("--out", default="runs/base")
ap.add_argument("--epochs", type=int, default=30); ap.add_argument("--bs", type=int, default=128)
ap.add_argument("--lr", type=float, default=2e-3); ap.add_argument("--width", type=int, default=32)
ap.add_argument("--partial", type=float, default=0.3, help="Anteil Trainingsskizzen mit ausgeloeschten Strichteilen")
ap.add_argument("--simple_w", type=float, default=0.3, help="Gewicht fuer fast-elliptische (zu einfache) Skizzen")
ap.add_argument("--no_view", action="store_true")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True); dev = "cuda"
torch.manual_seed(0); np.random.seed(0)

meta = json.load(open(f"{a.data}/meta.json"))
sk = torch.from_numpy(np.load(f"{a.data}/sketch128.npy")).to(dev)                       # N,128,128 uint8 (Tinte=hell)
vox = torch.from_numpy(np.load(f"{a.data}/voxels64.npz")["vox"]).to(dev)               # A,64,64,64 uint8
aidx = torch.tensor([m["asset_idx"] for m in meta], device=dev)
az = torch.tensor([m["az"] for m in meta], dtype=torch.float32, device=dev)
el = torch.tensor([m["el"] for m in meta], dtype=torch.float32, device=dev)
ell = torch.tensor([m["ellipse"] for m in meta], device=dev)
simple = ell > 0.98
split = np.array([m["split"] for m in meta])
tr, va, te = [torch.from_numpy(np.nonzero(split == s)[0]).to(dev) for s in ("train", "val", "test")]
print("train/val/test", len(tr), len(va), len(te), flush=True)

def view_ch(i):
    r = torch.deg2rad(az[i]); e = (el[i] - 25) / 10
    v = torch.stack([torch.sin(r), torch.cos(r), e], 1)
    return torch.zeros_like(v) if a.no_view else v

def batch(i, train):
    x = sk[i].float().div(255).unsqueeze(1)                                              # B,1,128,128
    if train:
        B = x.shape[0]
        if a.partial > 0:                                                                 # unvollstaendige Skizze simulieren
            for _ in range(3):
                cx, cy = torch.randint(0, 128, (2, B), device=dev); s = torch.randint(16, 56, (B,), device=dev)
                yy, xx = torch.meshgrid(torch.arange(128, device=dev), torch.arange(128, device=dev), indexing="ij")
                m = ((xx[None] - cx[:, None, None]).abs() < s[:, None, None] // 2) & ((yy[None] - cy[:, None, None]).abs() < s[:, None, None] // 2)
                m &= (torch.rand(B, device=dev) < a.partial / 3)[:, None, None]
                x = x * (~m).unsqueeze(1)
        t = torch.rand(B, 1, 1, 1, device=dev) < 0.5                                       # zufaellig dickere Linie
        x = torch.where(t, F.max_pool2d(x, 3, 1, 1), x)
    v = view_ch(i)[:, :, None, None].expand(-1, -1, 128, 128)
    return torch.cat([x, v], 1), vox[aidx[i]].float().unsqueeze(1)

def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, 2, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True), nn.Conv2d(o, o, 3, 1, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True))
def up(i, o): return nn.Sequential(nn.ConvTranspose3d(i, o, 4, 2, 1, bias=False), nn.BatchNorm3d(o), nn.ReLU(True), nn.Conv3d(o, o, 3, 1, 1, bias=False), nn.BatchNorm3d(o), nn.ReLU(True))
class Net(nn.Module):
    def __init__(s, w):
        super().__init__()
        s.enc = nn.Sequential(blk(4, w), blk(w, w*2), blk(w*2, w*4), blk(w*4, w*8), blk(w*8, w*8), blk(w*8, w*8))   # 128 -> 2
        s.fc = nn.Sequential(nn.Flatten(), nn.Linear(w*8*4 + 3, 512), nn.ReLU(True), nn.Linear(512, 128*4*4*4), nn.ReLU(True))
        s.dec = nn.Sequential(up(128, 96), up(96, 48), up(48, 16), up(16, 8), nn.Conv3d(8, 1, 1))              # 4 -> 64
    def forward(s, x):
        h = s.enc(x); h = torch.cat([h.flatten(1), x[:, 1:, 0, 0]], 1)
        return s.dec(s.fc(h).view(-1, 128, 4, 4, 4))
net = Net(a.width).to(dev).to(memory_format=torch.channels_last) if False else Net(a.width).to(dev)
print("Parameter:", sum(p.numel() for p in net.parameters()) / 1e6, "M", flush=True)
spe = math.ceil(len(tr) / a.bs); total = spe * a.epochs
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, a.lr, total_steps=total, pct_start=0.15)
scaler = torch.cuda.amp.GradScaler()

def iou_eval(idx):
    net.eval(); inter = torch.zeros(len(idx), device=dev); uni = torch.zeros_like(inter)
    with torch.no_grad(), torch.autocast("cuda", torch.float16):
        for s in range(0, len(idx), 48):
            x, y = batch(idx[s:s+48], False); p = net(x) > 0
            y = y > 0.5; inter[s:s+48] = (p & y).flatten(1).sum(1); uni[s:s+48] = (p | y).flatten(1).sum(1)
    net.train(); r = inter / uni.clamp(min=1); sm = simple[idx]
    return dict(iou=r.mean().item(), iou_info=r[~sm].mean().item(), iou_simple=r[sm].mean().item() if sm.any() else None), r

status_path = f"{a.out}/status.json"; hist = []; t0 = time.time(); best = 0; step = 0
def write(**k):
    json.dump(dict(k, hist=hist, run=a.out, updated=time.time()), open(status_path + ".tmp", "w")); os.replace(status_path + ".tmp", status_path)
write(state="start", epoch=0, epochs=a.epochs, step=0, total=total, eta_s=None)
for ep in range(a.epochs):
    perm = tr[torch.randperm(len(tr), device=dev)]; run = 0
    for s in range(spe):
        i = perm[s*a.bs:(s+1)*a.bs]; x, y = batch(i, True)
        w = torch.where(simple[i], a.simple_w, 1.0).view(-1, 1, 1, 1, 1)
        with torch.autocast("cuda", torch.float16):
            lg = net(x)
        lg = lg.float(); bce = F.binary_cross_entropy_with_logits(lg, y, pos_weight=torch.tensor(4.0, device=dev), reduction="none")
        pr = torch.sigmoid(lg); dice = 1 - (2*(pr*y).flatten(1).sum(1) + 1) / (pr.flatten(1).sum(1) + y.flatten(1).sum(1) + 1)
        loss = (bce * w).mean() + (dice * w.view(-1)).mean()
        opt.zero_grad(set_to_none=True); scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
        step += 1; run += loss.item()
        if step % 20 == 0:
            el_t = time.time() - t0; write(state="train", epoch=ep+1, epochs=a.epochs, step=step, total=total, loss=loss.item(), lr=sched.get_last_lr()[0],
                                          eta_s=el_t / step * (total - step), elapsed_s=el_t, best_val_iou=best)
    m, _ = iou_eval(va); hist.append(dict(epoch=ep+1, loss=run/spe, **m)); best = max(best, m["iou"])
    if m["iou"] >= best: torch.save(net.state_dict(), f"{a.out}/best.pt")
    print(f"ep {ep+1}/{a.epochs} loss {run/spe:.3f} val IoU {m['iou']:.3f} info {m['iou_info']:.3f} simple {m['iou_simple']} | {time.time()-t0:.0f}s", flush=True)
net.load_state_dict(torch.load(f"{a.out}/best.pt")); mt, r = iou_eval(te)
np.save(f"{a.out}/test_iou.npy", r.cpu().numpy()); torch.save(net.state_dict(), f"{a.out}/final.pt")
write(state="done", epoch=a.epochs, epochs=a.epochs, step=total, total=total, eta_s=0, elapsed_s=time.time()-t0, best_val_iou=best, test=mt)
print("TEST", mt, flush=True)
