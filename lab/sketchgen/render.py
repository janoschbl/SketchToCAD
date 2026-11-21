"""Headless-GPU-Renderer (moderngl/EGL): Tiefe, Normalen (Kamera), Face-ID pro Pixel.

Kamera-Konvention (OpenCV): X_cam = R @ X_world + t, x rechts, y unten, z nach vorn.
Pixel u = fx*x/z + cx, v = fy*y/z + cy. Bildzeile 0 = oben.
"""
import numpy as np
import moderngl

VS = """
#version 330
in vec3 pos;
uniform mat4 R4;     // world -> cam (OpenCV)
uniform mat4 P;      // cam -> clip
out vec3 pc;
void main(){ vec4 c = R4 * vec4(pos,1.0); pc = c.xyz; gl_Position = P * c; }
"""
FS = """
#version 330
in vec3 pc;
layout(location=0) out vec4 o_geo;   // normal.xyz (cam), depth z
layout(location=1) out int  o_id;    // face id + 1
void main(){
  vec3 n = normalize(cross(dFdx(pc), dFdy(pc)));
  if (dot(n, pc) > 0.0) n = -n;      // zur Kamera zeigen
  o_geo = vec4(n, pc.z);
  o_id = gl_PrimitiveID + 1;
}
"""

_CTX = None


def ctx():
    global _CTX
    if _CTX is None:
        _CTX = moderngl.create_standalone_context(backend="egl")
    return _CTX


def look_at(eye, target, up=(0, 0, 1)):
    """R, t für OpenCV-Kamera am Punkt eye, Blick auf target."""
    eye = np.asarray(eye, float); target = np.asarray(target, float)
    f = target - eye; f /= np.linalg.norm(f)
    r = np.cross(f, up)
    if np.linalg.norm(r) < 1e-6:
        r = np.cross(f, (0, 1, 0))
    r /= np.linalg.norm(r)
    d = np.cross(f, r)                       # y nach unten im Bild
    R = np.stack([r, d, f])
    return R, -R @ eye


def intrinsics(fov_deg, W, H):
    fy = 0.5 * H / np.tan(np.radians(fov_deg) / 2)
    return np.array([[fy, 0, W / 2], [0, fy, H / 2], [0, 0, 1.0]])


def project(X, K, R, t):
    """Weltpunkte (N,3) -> Pixel (N,2), Kameratiefe z (N,)."""
    c = X @ R.T + t
    z = c[:, 2]
    uv = (c[:, :2] / z[:, None]) * [K[0, 0], K[1, 1]] + [K[0, 2], K[1, 2]]
    return uv, z


class Renderer:
    def __init__(self, W=512, H=512):
        self.W, self.H = W, H
        g = ctx()
        self.prog = g.program(vertex_shader=VS, fragment_shader=FS)
        self.t_geo = g.texture((W, H), 4, dtype="f4")
        self.t_id = g.texture((W, H), 1, dtype="i4")
        self.depth = g.depth_renderbuffer((W, H))
        self.fbo = g.framebuffer([self.t_geo, self.t_id], self.depth)
        self.vao = None

    def set_mesh(self, V, F):
        g = ctx()
        tri = np.ascontiguousarray(V[F].reshape(-1, 3), dtype="f4")   # nicht indiziert -> PrimitiveID = Face
        if self.vao is not None:
            self.vao.release(); self.vbo.release()
        self.vbo = g.buffer(tri.tobytes())
        self.vao = g.vertex_array(self.prog, [(self.vbo, "3f", "pos")])

    def render(self, K, R, t, near=0.05, far=100.0):
        W, H = self.W, self.H
        fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
        P = np.zeros((4, 4))
        P[0, 0] = 2 * fx / W; P[0, 2] = 2 * cx / W - 1
        P[1, 1] = -2 * fy / H; P[1, 2] = 1 - 2 * cy / H
        P[2, 2] = (far + near) / (far - near); P[2, 3] = -2 * far * near / (far - near)
        P[3, 2] = 1
        R4 = np.eye(4); R4[:3, :3] = R; R4[:3, 3] = t
        self.prog["R4"].write(R4.T.astype("f4").tobytes())   # GLSL spaltenweise
        self.prog["P"].write(P.T.astype("f4").tobytes())
        g = ctx()
        self.fbo.use()
        g.enable(moderngl.DEPTH_TEST); g.disable(moderngl.CULL_FACE)
        self.fbo.clear(0, 0, 0, 0, depth=1.0)
        self.t_id.write(np.zeros((H, W), "i4").tobytes())
        self.vao.render(moderngl.TRIANGLES)
        geo = np.frombuffer(self.t_geo.read(), "f4").reshape(H, W, 4)[::-1]
        fid = np.frombuffer(self.t_id.read(), "i4").reshape(H, W)[::-1] - 1
        mask = fid >= 0
        depth = np.where(mask, geo[..., 3], np.inf).astype("f4")
        normal = np.where(mask[..., None], geo[..., :3], 0).astype("f4")
        return dict(depth=depth, normal=normal, fid=fid, mask=mask)
