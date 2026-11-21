import json, itertools, numpy as np
from scipy import ndimage as ndi
meta=json.load(open('data/meta.json')); sk=np.load('data/sketch128.npy',mmap_mode='r'); V=np.load('data/voxels64.npz')
vox=V['vox']; R=64; LIM=1.02
g=np.indices((R,R,R)).reshape(3,-1).T
P=(g+0.5)/R*2*LIM-LIM
def render(a,az,el,cfg):
    sx,sy,swap=cfg
    p=P[vox[a].reshape(-1)>0]
    az=np.deg2rad(az); el=np.deg2rad(el)
    cam=np.array([sx*np.sin(az)*np.cos(el), sy*np.cos(az)*np.cos(el), np.sin(el)])
    if swap: cam=np.array([sx*np.cos(az)*np.cos(el), sy*np.sin(az)*np.cos(el), np.sin(el)])
    f=-cam/np.linalg.norm(cam); up=np.array([0,0,1.]); r=np.cross(f,up); r/=np.linalg.norm(r); u=np.cross(r,f)
    x=64+(p@r)*128/3.5; y=64-(p@u)*128/3.5
    m=np.zeros((128,128),bool); xi=np.round(x).astype(int); yi=np.round(y).astype(int)
    ok=(xi>=0)&(xi<128)&(yi>=0)&(yi<128); m[yi[ok],xi[ok]]=True
    return ndi.binary_fill_holes(ndi.binary_closing(m,iterations=2))
rng=np.random.default_rng(0); idx=rng.choice(len(meta),60,replace=False)
res={}
for cfg in itertools.product([1,-1],[1,-1],[False,True]):
    s=[]
    for i in idx:
        m=meta[i]; t=ndi.binary_fill_holes(ndi.binary_dilation(np.asarray(sk[i])>25))
        r=render(m['asset_idx'],m['az'],m['el'],cfg)
        s.append((r&t).sum()/max((r|t).sum(),1))
    res[cfg]=np.mean(s); print(cfg, round(res[cfg],3))
