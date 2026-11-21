import os, sys, json, numpy as np, torch, trimesh
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, HERE + "/../prompt-editor")
from app.sharpen import sharpen
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
def draw(ax, V, F, lab=None):
    n = np.cross(V[F[:,1]]-V[F[:,0]], V[F[:,2]]-V[F[:,0]]); n /= np.maximum(np.linalg.norm(n,axis=1),1e-12)[:,None]
    sh = 0.45 + 0.55*np.clip(n @ np.array([.4,-.5,.75])/np.linalg.norm([.4,-.5,.75]), 0, 1)
    base = np.ones((len(F),3))*.85 if lab is None else plt.cm.tab20(lab % 20)[:,:3]
    ax.add_collection3d(Poly3DCollection(V[F], facecolors=base*sh[:,None], edgecolor='none'))
    ax.set_xlim(-1,1);ax.set_ylim(-1,1);ax.set_zlim(-1,1);ax.set_axis_off();ax.view_init(22,-55)
if __name__ == "__main__":
    fs = sys.argv[2:]; fig = plt.figure(figsize=(6*len(fs), 12))
    for j, f in enumerate(fs):
        sc = trimesh.load(f, force="scene"); m = sc.dump(concatenate=True)
        import time; t = time.time(); V, F, lab = sharpen(m.vertices, m.faces); print(os.path.basename(f), len(m.faces), "->", lab.max()+1, "Ebenen %.1fs" % (time.time()-t))
        draw(fig.add_subplot(2, len(fs), j+1, projection="3d"), m.vertices, m.faces)
        draw(fig.add_subplot(2, len(fs), len(fs)+j+1, projection="3d"), V, F, lab)
    plt.savefig(sys.argv[1], dpi=60, bbox_inches="tight")
