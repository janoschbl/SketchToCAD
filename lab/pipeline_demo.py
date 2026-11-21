"""Ganze Kette: Skizze -> LiftNet (mix_v1) -> Mesh -> Kanten-Segmentierung -> segmentiertes GLB (für den Prompt-Editor)."""
import json, os, sys
import numpy as np, torch, trimesh
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, HERE + "/../prompt-editor")
from model_v2 import LiftNet
from app.segmentation import segment_faces
from app.sharpen import sharpen
from app import model_io

CK = os.environ.get("CKPT", "runs_home/mix_v1/best.pt")
net = LiftNet(); net.load_state_dict({k: v.float() for k, v in torch.load(f"{HERE}/{CK}", map_location="cpu").items()}); net.eval()
X = np.load(f"{HERE}/data_real/ood/sketch128.npy"); meta = json.load(open(f"{HERE}/data_real/ood/meta.json"))
idx = [int(a) for a in sys.argv[1:]] or range(len(meta))
for i in idx:
    x = torch.from_numpy(X[i].astype(np.float32) / (255 if X.dtype == np.uint8 else 1))[None, None]
    with torch.no_grad(): lg = net(x)[0, 0].numpy()
    p = lg > 0
    lab, n = ndi.label(ndi.binary_closing(np.pad(p, 2))[2:-2, 2:-2, 2:-2] | p)
    if n > 1: p = lab == 1 + np.bincount(lab.ravel())[1:].argmax()
    f = ndi.gaussian_filter(ndi.binary_fill_holes(p).astype(np.float32), 0.8)
    if f.max() <= .5: print(i, meta[i]["name"], "leer"); continue
    v, fc, _, _ = marching_cubes(np.pad(f, 1), 0.5); v = (v - 1 + .5) / 64 * 2 - 1
    m = trimesh.Trimesh(v[:, [2, 0, 1]], fc[:, ::-1], process=False)  # (Spalte, Tiefe, Zeile) -> x,y,z grob; nur Demo
    m.vertices[:, 2] *= -1
    if os.environ.get("SHARPEN", "1") == "1":   # Kanten/Ecken schärfen; die Ebenen sind zugleich die Teile
        V2, F2, labels = sharpen(m.vertices, m.faces); m = trimesh.Trimesh(V2, F2, process=False); k = int(labels.max()) + 1
    else:
        labels, k = segment_faces(m.vertices, m.faces)
    out = f"{HERE}/out/pipeline/{i:02d}_" + "".join(c if c.isalnum() else "_" for c in meta[i]["name"]) + ".glb"
    sc = trimesh.Scene()
    for j in range(k):
        part = m.submesh([np.nonzero(labels == j)[0]], append=True); sc.add_geometry(part, node_name=f"flaeche_{j:02d}", geom_name=f"flaeche_{j:02d}")
    sc.export(out); print(i, meta[i]["name"], len(fc), "Dreiecke ->", k, "Flächen", out)
