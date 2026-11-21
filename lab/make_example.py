"""Beispiel der Zwei-Schritt-Kette für EIN Haus: Skizze -> 2.5D-Zwischenkarten -> 3D mit Teilen.  python make_example.py [seed] [view]"""
import json, sys, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import house_prog as H
from sketchgen import render as rnd
from PIL import Image
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from scipy import ndimage as ndi
seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0; view = int(sys.argv[2]) if len(sys.argv) > 2 else 2
sub = f"{seed // 1000:04d}"; base = f"{HERE}/out/procad_v1/{sub}/{seed:07d}_{view}"
cam = json.load(open(base + ".json"))["camera"]; K, R, t = (np.array(cam[k]) for k in ("K", "R", "t"))
P = H.replay(seed); V, F, part, names = H.build(P)
r = rnd.Renderer(512, 512); r.set_mesh(V, F); buf = r.render(K, R, t)
fid, mask = buf["fid"], buf["mask"]
PC = {"wand": (.93, .88, .78), "dach": (.72, .30, .25), "schornstein": (.45, .33, .30), "fenster": (.42, .66, .86), "sonstiges": (.7, .7, .7)}
pid = np.where(mask, part[np.clip(fid, 0, None)], -1)
partmap = np.ones((512, 512, 3))
for k, nm in enumerate(names):
    partmap[pid == k] = PC.get(nm, PC["sonstiges"])
# Flächen-ID (Ebene): Dreiecke mit gleicher Normale + gleichem Teil
Nf = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); Nf /= np.linalg.norm(Nf, axis=1, keepdims=True)
key = np.round(Nf, 2) @ np.array([1, 7.3, 53.1]) + part * 1000
_, sid = np.unique(np.round(key, 3), return_inverse=True)
surf = np.where(mask, sid[np.clip(fid, 0, None)], -1)
rng = np.random.default_rng(1); col = rng.uniform(.35, .95, (sid.max() + 2, 3)); surfmap = np.where(mask[..., None], col[surf], 1.0)
# Kantenarten aus der Geometrie: Umriss (Maskenrand), Knick (Flächen-ID-Wechsel innen), Tiefensprung
edge = np.ones((512, 512, 3))
sil = mask & ~ndi.binary_erosion(mask, iterations=2); edge[sil] = (0, 0, 0)
chg = np.zeros_like(mask)
for dy, dx in ((0, 1), (1, 0)):
    a, b = surf[:512 - dy, :512 - dx], surf[dy:, dx:]; c = (a != b) & (a >= 0) & (b >= 0); chg[:512 - dy, :512 - dx] |= c
chg = ndi.binary_dilation(chg, iterations=1) & mask & ~sil
dep = buf["depth"]; fd = np.where(mask, dep, np.nan)
edge[chg] = (0.85, 0.1, 0.1)
n = buf["normal"]; nimg = np.where(mask[..., None], n * 0.5 + 0.5, 1.0)
dimg = np.where(mask, (dep - dep[mask].min()) / np.ptp(dep[mask]), 1.0); dimg = plt.cm.viridis_r(dimg)[..., :3]; dimg[~mask] = 1
sk = np.asarray(Image.open(base + ".png").convert("RGB"))
fig = plt.figure(figsize=(18, 9.5))
panels = [("1  Eingabe: Skizze", sk), ("2a  Normalen (Farbe = Richtung)", nimg), ("2b  Tiefe", dimg), ("2c  Teile (wand, dach, ...)", partmap), ("2d  Flächen + Kanten (rot = Knick, schwarz = Umriss)", np.where(edge.sum(-1, keepdims=True) < 3, edge, surfmap))]
for i, (tt, im) in enumerate(panels):
    ax = fig.add_subplot(2, 5, i + 1); ax.imshow(im); ax.set_title(tt, fontsize=10); ax.axis("off")
ax = fig.add_subplot(2, 5, 6, projection="3d"); ax.set_title("3  Ergebnis: Mesh nach Teilen", fontsize=10)
for k, nm in enumerate(names):
    ff = F[part == k]; ax.add_collection3d(Poly3DCollection(V[ff], facecolors=PC.get(nm, PC["sonstiges"]), edgecolor=(0.15, 0.15, 0.15), linewidth=0.4))
ax.set_xlim(-1, 1); ax.set_ylim(-1, 1); ax.set_zlim(-1, 1); ax.set_axis_off(); ax.view_init(24, -58)
ax = fig.add_subplot(2, 5, 7, projection="3d"); ax.set_title("3  zweite Ansicht", fontsize=10)
for k, nm in enumerate(names):
    ff = F[part == k]; ax.add_collection3d(Poly3DCollection(V[ff], facecolors=PC.get(nm, PC["sonstiges"]), edgecolor=(0.15, 0.15, 0.15), linewidth=0.4))
ax.set_xlim(-1, 1); ax.set_ylim(-1, 1); ax.set_zlim(-1, 1); ax.set_axis_off(); ax.view_init(20, 125)
ax = fig.add_subplot(2, 5, (8, 10)); ax.axis("off")
vec = H.encode(P); txt = [f"Haus (procad-Seed {seed}, Ansicht {view}: az {cam['az']:.0f}°, el {cam['el']:.0f}°)", "",
    f"Parameter (massstabsfrei): Wand {vec[0]:.2f} × {vec[1]:.2f} × {2*vec[2]:.2f}, Dach {vec[3]:.2f}, Überstand {vec[4]:.2f}",
    "Schornstein: " + (f"ja (s {P['chim']['s']/np.linalg.norm([2*P['hx'],2*P['hy'],2*P['hz']+P['rh']]):.2f})" if P["chim"] else "nein"),
    "Öffnungen: " + (", ".join(f"{o['face']}" for o in P["op"]) or "keine"), "",
    f"Teile im Mesh: {', '.join(sorted(set(names)))}   ·   {len(F)} Dreiecke, {sid.max()+1} Flächen", "",
    "Ideal: Eingabe 1 -> Netz 1 -> 2a–2d (aus 3D-Daten exakt erzeugbar) -> Netz 2 / Programm-Anpassung -> 3 (exakte Kanten, benannte Teile)"]
ax.text(0, 1, "\n".join(txt), va="top", fontsize=11, family="monospace", wrap=True)
plt.tight_layout(); out = f"{HERE}/out/example/haus_{seed}_{view}.png"; plt.savefig(out, dpi=70); print(out)
for nm, im in (("sketch", sk), ("normal", (nimg * 255).astype(np.uint8)), ("depth", (dimg * 255).astype(np.uint8)), ("parts", (partmap * 255).astype(np.uint8)), ("surfaces_edges", (np.where(edge.sum(-1, keepdims=True) < 3, edge, surfmap) * 255).astype(np.uint8))):
    Image.fromarray(np.asarray(im, np.uint8)).save(f"{HERE}/out/example/haus_{seed}_{view}_{nm}.png")
json.dump(dict(seed=seed, view=view, camera=dict(az=cam["az"], el=cam["el"], fov=cam["fov"]), params=P, parts=names, vec=vec.tolist()), open(f"{HERE}/out/example/haus_{seed}_{view}.json", "w"), indent=1)
