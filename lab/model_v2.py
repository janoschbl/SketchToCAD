"""LiftNet: 2D-U-Net auf der Skizze, Merkmale werden pixelgenau in die Tiefe gehoben (Kanäle -> Tiefenachse),
dann 3D-Faltungen für räumliche Konsistenz. Ausgabe: Logits B x 1 x 64(Tiefe) x 64(Zeile) x 64(Spalte)."""
import torch, torch.nn as nn, torch.nn.functional as F


def c2(i, o, s=1):
    return nn.Sequential(nn.Conv2d(i, o, 3, s, 1, bias=False), nn.GroupNorm(8, o), nn.SiLU(True),
                         nn.Conv2d(o, o, 3, 1, 1, bias=False), nn.GroupNorm(8, o), nn.SiLU(True))


def c3(i, o):
    return nn.Sequential(nn.Conv3d(i, o, 3, 1, 1, bias=False), nn.GroupNorm(min(8, o // 2), o), nn.SiLU(True))


class LiftNet(nn.Module):
    def __init__(s, w=32, c32=16, c64=4):
        super().__init__()
        s.c32, s.c64 = c32, c64
        s.e0 = c2(1, w)              # 128
        s.e1 = c2(w, w * 2, 2)       # 64
        s.e2 = c2(w * 2, w * 4, 2)   # 32
        s.e3 = c2(w * 4, w * 8, 2)   # 16
        s.e4 = c2(w * 8, w * 8, 2)   # 8
        s.e5 = c2(w * 8, w * 8, 2)   # 4  (globaler Kontext)
        s.g = nn.Sequential(nn.Flatten(), nn.Linear(w * 8 * 16, 512), nn.SiLU(True), nn.Linear(512, w * 8 * 16), nn.SiLU(True))
        s.d4 = c2(w * 16, w * 8)     # 8
        s.d3 = c2(w * 16, w * 8)     # 16
        s.d2 = c2(w * 12, w * 8)     # 32
        s.to32 = nn.Conv2d(w * 8, c32 * 32, 1)       # -> c32 x 32 (Tiefe) bei 32²
        s.d1 = c2(w * 8 + w * 2, w * 4)  # 64
        s.to64 = nn.Conv2d(w * 4, c64 * 64, 1)       # -> c64 x 64 (Tiefe) bei 64²
        s.r32 = nn.Sequential(c3(c32, 32), c3(32, 32), c3(32, 32))
        s.up = nn.ConvTranspose3d(32, 16, 4, 2, 1)
        s.r64 = nn.Sequential(c3(16 + c64, 16), c3(16, 16), nn.Conv3d(16, 1, 1))

    def forward(s, x):
        B = x.shape[0]
        e0 = s.e0(x); e1 = s.e1(e0); e2 = s.e2(e1); e3 = s.e3(e2); e4 = s.e4(e3); e5 = s.e5(e4)
        g = s.g(e5).view_as(e5)
        up = lambda t: F.interpolate(t, scale_factor=2, mode="nearest")
        d4 = s.d4(torch.cat([up(g), e4], 1))
        d3 = s.d3(torch.cat([up(d4), e3], 1))
        d2 = s.d2(torch.cat([up(d3), e2], 1))                         # 32²
        v32 = s.to32(d2).view(B, s.c32, 32, 32, 32)                   # [c, Tiefe, Zeile, Spalte]
        d1 = s.d1(torch.cat([up(d2), e1], 1))                         # 64²
        v64 = s.to64(d1).view(B, s.c64, 64, 64, 64)
        h = s.up(s.r32(v32))
        return s.r64(torch.cat([h, v64], 1))
