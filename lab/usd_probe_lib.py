import sys, numpy as np
from pxr import Usd, UsdGeom
def load(path):
    st = Usd.Stage.Open(path)
    up = UsdGeom.GetStageUpAxis(st); mpu = UsdGeom.GetStageMetersPerUnit(st)
    cache = UsdGeom.XformCache()
    V=[];F=[];off=0
    for prim in st.Traverse():
        if prim.IsA(UsdGeom.Mesh):
            m=UsdGeom.Mesh(prim)
            pts=np.array(m.GetPointsAttr().Get(),dtype=np.float64)
            fc=np.array(m.GetFaceVertexCountsAttr().Get()); fi=np.array(m.GetFaceVertexIndicesAttr().Get())
            M=np.array(cache.GetLocalToWorldTransform(prim)).T
            pts=(np.c_[pts,np.ones(len(pts))]@M.T)[:,:3]
            tri=[];i=0
            for c in fc:
                for k in range(1,c-1): tri.append((fi[i],fi[i+k],fi[i+k+1]))
                i+=c
            V.append(pts);F.append(np.array(tri)+off);off+=len(pts)
    return np.vstack(V),np.vstack(F),up,mpu

def load_mesh(p):
    V,F,_,_=load(p); return V,F
