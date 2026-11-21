"""Schritt 1 des Hybrid-Systems: mix_v1 (best.pt) auf OOD-Skizzen -> Voxel-Vorhersage (blickausgerichtet 64^3)."""
import json, numpy as np, torch, sys
from model_v2 import LiftNet
net = LiftNet(); sd = torch.load("runs_home/mix_v1/best.pt", map_location="cpu")
net.load_state_dict({k: v.float() for k, v in sd.items()}); net.eval()
X = np.load("data_real/ood/sketch128.npy"); GT = np.load("data_real/ood/vox64.npy")
meta = json.load(open("data_real/ood/meta.json"))
with torch.no_grad():
    lg = net(torch.from_numpy(X.astype(np.float32) / (255 if X.dtype == np.uint8 else 1))[:, None])[:, 0].numpy()
np.save("out/hybrid/pred_logits.npy", lg)
for i, m in enumerate(meta):
    p = lg[i] > 0; g = GT[i] > 0
    print(i, m["name"], "IoU %.2f" % ((p & g).sum() / max((p | g).sum(), 1)))
