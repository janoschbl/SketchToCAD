import torch.nn as nn
def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, 2, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True), nn.Conv2d(o, o, 3, 1, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(True))
def up(i, o): return nn.Sequential(nn.ConvTranspose3d(i, o, 4, 2, 1, bias=False), nn.BatchNorm3d(o), nn.ReLU(True), nn.Conv3d(o, o, 3, 1, 1, bias=False), nn.BatchNorm3d(o), nn.ReLU(True))
class Net(nn.Module):
    """Eingabe: B x 4 x 128 x 128 (Tinte + sin(az), cos(az), (el-25)/10) -> B x 1 x 64^3 Logits."""
    def __init__(s, w=32):
        super().__init__()
        s.enc = nn.Sequential(blk(4, w), blk(w, w*2), blk(w*2, w*4), blk(w*4, w*8), blk(w*8, w*8), blk(w*8, w*8))
        s.fc = nn.Sequential(nn.Flatten(), nn.Linear(w*8*4 + 3, 512), nn.ReLU(True), nn.Linear(512, 128*4*4*4), nn.ReLU(True))
        s.dec = nn.Sequential(up(128, 96), up(96, 48), up(48, 16), up(16, 8), nn.Conv3d(8, 1, 1))
    def forward(s, x):
        h = s.enc(x); h = __import__("torch").cat([h.flatten(1), x[:, 1:, 0, 0]], 1)
        return s.dec(s.fc(h).view(-1, 128, 4, 4, 4))
