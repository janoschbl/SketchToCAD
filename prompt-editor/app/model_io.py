"""Laden und Speichern von 3D-Modellen mit benannten Teilen.

Intern arbeitet die App mit einer flachen trimesh-Szene: ein Eintrag pro Teil,
Weltkoordinaten eingerechnet, Teilname = Knoten-/Prim-Name.
Eingabe: GLB/GLTF, OBJ, USD (.usd/.usda/.usdc). Ausgabe: GLB (Vorschau) und USD (Film/Austausch).
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np
import trimesh

ATLAS_PREFIX = "SketchToCAD_Atlas_v1_"


def _safe(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_]", "_", name).strip("_") or "teil"
    return ("t_" + s) if s[0].isdigit() else s


def color_of(mesh: trimesh.Trimesh):
    v = mesh.visual
    try:
        mat = getattr(v, "material", None)
        name = getattr(mat, "name", None) or ""
        if name.startswith(ATLAS_PREFIX) and len(name) == len(ATLAS_PREFIX) + 6:
            return list(bytes.fromhex(name.removeprefix(ATLAS_PREFIX)))
        if mat is not None and getattr(mat, "baseColorFactor", None) is not None:
            return [int(c) for c in np.asarray(mat.baseColorFactor)[:3]]
        if hasattr(v, "face_colors") and len(v.face_colors):
            return [int(c) for c in v.face_colors[0][:3]]
    except Exception:
        pass
    return None


def set_color(mesh: trimesh.Trimesh, rgb):
    if len(rgb) != 3 or any(not isinstance(c, (int, np.integer)) or not 0 <= c <= 255 for c in rgb):
        raise ValueError("RGB braucht drei Ganzzahlen zwischen 0 und 255.")
    rgba = [*rgb, 255]
    mat = trimesh.visual.material.PBRMaterial(baseColorFactor=rgba, metallicFactor=0.1, roughnessFactor=0.6)
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)


def ascii_name(name: str) -> str:
    from unicodedata import normalize
    name = str(name).replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    name = name.replace("Ä", "Ae").replace("Ö", "Oe").replace("Ü", "Ue")
    return normalize("NFKD", name).encode("ascii", "ignore").decode()


def texture_of(mesh: trimesh.Trimesh):
    """Grundfarb-Textur (PIL-Bild) eines Teils oder None."""
    mat = getattr(mesh.visual, "material", None)
    img = getattr(mat, "baseColorTexture", None)
    if img is None:
        img = getattr(mat, "image", None)
    uv = getattr(mesh.visual, "uv", None)
    if img is None or uv is None or len(uv) != len(mesh.vertices):
        return None
    return img


def tint(mesh: trimesh.Trimesh, rgb):
    """Grundfarbfaktor setzen, die Textur bleibt erhalten (Farbe wird mit ihr multipliziert)."""
    if len(rgb) != 3 or any(not isinstance(c, (int, np.integer)) or not 0 <= c <= 255 for c in rgb):
        raise ValueError("RGB braucht drei Ganzzahlen zwischen 0 und 255.")
    mat = getattr(mesh.visual, "material", None)
    if not isinstance(mat, trimesh.visual.material.PBRMaterial):
        set_color(mesh, rgb)
        return
    mat = mat.copy()
    mat.baseColorFactor = [*rgb, 255]
    mesh.visual.material = mat


def sample_surface_uv(mesh: trimesh.Trimesh, count=4000, seed=0):
    """UV-Koordinaten zufälliger Oberflächenpunkte (flächengewichtet) – nur der genutzte Teil der Textur."""
    uv = np.asarray(mesh.visual.uv, dtype=float)
    area = mesh.area_faces
    if not len(area) or area.sum() <= 0:
        return uv
    rng = np.random.default_rng(seed)
    faces = rng.choice(len(area), size=count, p=area / area.sum())
    a, b = rng.random((2, count))
    flip = a + b > 1
    a[flip], b[flip] = 1 - a[flip], 1 - b[flip]
    f = mesh.faces[faces]
    return uv[f[:, 0]] * (1 - a - b)[:, None] + uv[f[:, 1]] * a[:, None] + uv[f[:, 2]] * b[:, None]


def uv_to_pixel(uv, size):
    """trimesh-UV (v nach oben) → Pixel im Texturbild (y nach unten), mit Wiederholung."""
    w, h = size
    u, v = np.mod(uv[:, 0], 1.0), np.mod(uv[:, 1], 1.0)
    return (np.clip((u * w).astype(int), 0, w - 1), np.clip(((1 - v) * h).astype(int), 0, h - 1))


def texture_palette(mesh: trimesh.Trimesh, top=6, min_share=0.01):
    """Hauptfarben der tatsächlich genutzten Textur: [(rgb, Anteil)], grob quantisiert."""
    img = texture_of(mesh)
    if img is None:
        return []
    arr = np.asarray(img.convert("RGB"))
    x, y = uv_to_pixel(sample_surface_uv(mesh), (arr.shape[1], arr.shape[0]))
    px = arr[y, x].astype(int)
    factor = getattr(mesh.visual.material, "baseColorFactor", None)
    if factor is not None:
        px = px * np.asarray(factor[:3], dtype=int) // 255
    q = px // 24
    keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    out = []
    for k in np.argsort(-counts)[:top]:
        share = counts[k] / len(px)
        if share < min_share:
            break
        out.append(([int(c) for c in px[inv.ravel() == k].mean(0).round()], round(float(share), 3)))
    return out


def fingerprint(mesh: trimesh.Trimesh) -> str:
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(mesh.vertices, dtype=np.float64).tobytes())
    h.update(np.ascontiguousarray(mesh.faces, dtype=np.int64).tobytes())
    return h.hexdigest()[:16]


def _flatten(raw: trimesh.Scene) -> trimesh.Scene:
    scene = trimesh.Scene()
    used = set()
    for node in raw.graph.nodes_geometry:
        T, gname = raw.graph[node]
        m = raw.geometry[gname].copy()
        m.apply_transform(T)
        # trimesh hängt bei Meshes mit mehreren Primitiven zufällige Suffixe an den Knotennamen (Name_1a2b3c);
        # dann den stabilen Geometrienamen nehmen, damit Teilnamen bei jedem Laden gleich bleiben.
        auto = re.fullmatch(r"(.+)_[0-9a-f]{6}", str(node))
        name = _safe(str(gname) if auto and str(gname).startswith(auto.group(1)) else str(node))
        base, i = name, 2
        while name in used:
            name = f"{base}_{i}"; i += 1
        used.add(name)
        scene.add_geometry(m, node_name=name, geom_name=name)
    return scene


def _load_usd(path: str) -> trimesh.Scene:
    from pxr import Usd, UsdGeom
    stage = Usd.Stage.Open(path)
    up = UsdGeom.GetStageUpAxis(stage)
    cache = UsdGeom.XformCache()
    scene = trimesh.Scene()
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        um = UsdGeom.Mesh(prim)
        pts = np.array(um.GetPointsAttr().Get() or [], dtype=np.float64)
        counts = np.array(um.GetFaceVertexCountsAttr().Get() or [], dtype=np.int64)
        idx = np.array(um.GetFaceVertexIndicesAttr().Get() or [], dtype=np.int64)
        if len(pts) == 0 or len(counts) == 0:
            continue
        faces, o = [], 0
        for c in counts:  # Fächer-Triangulierung von Polygonen
            for k in range(1, c - 1):
                faces.append([idx[o], idx[o + k], idx[o + k + 1]])
            o += c
        M = np.array(cache.GetLocalToWorldTransform(prim)).T  # USD: Zeilenvektoren
        m = trimesh.Trimesh(pts, np.array(faces), process=False)
        m.apply_transform(M)
        if up == UsdGeom.Tokens.z:
            m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
        col = um.GetDisplayColorAttr().Get()
        if col:
            set_color(m, [int(255 * c) for c in col[0]])
        name = _safe(prim.GetName())
        if name in scene.geometry:
            name = _safe(str(prim.GetPath()).replace("/", "_"))
        scene.add_geometry(m, node_name=name, geom_name=name)
    if not scene.geometry:
        raise ValueError("Keine Meshes in der USD-Datei gefunden.")
    return scene


def load_model(path: str, split: bool = False) -> trimesh.Scene:
    suffix = Path(path).suffix.lower()
    if suffix in (".usd", ".usda", ".usdc"):
        return _load_usd(path)
    scene = _flatten(trimesh.load(path, force="scene"))
    if split and len(scene.geometry) == 1:  # ein Klumpen: nach Verbundenheit zerlegen (kostenlos)
        mesh = next(iter(scene.geometry.values()))
        # Die UV-Nähte eines bereits exportierten Editor-Teils sind keine Segmentgrenzen.
        material = getattr(mesh.visual, "material", None)
        if (getattr(material, "name", None) or "").startswith(ATLAS_PREFIX):
            return scene
        pieces = mesh.split(only_watertight=False)
        if len(pieces) <= 1:  # ein zusammenhängender Körper: an Kanten (Knicken) in Flächen zerlegen
            from .segmentation import segment_faces
            labels, count = segment_faces(mesh.vertices, mesh.faces)
            if count > 1:
                pieces = [mesh.submesh([np.nonzero(labels == k)[0]], append=True) for k in range(min(count, 200))]
        if 1 < len(pieces) <= 200:
            scene = trimesh.Scene()
            for i, p in enumerate(pieces):
                scene.add_geometry(p, node_name=f"teil_{i:02d}", geom_name=f"teil_{i:02d}")
    return scene


def save_glb(scene: trimesh.Scene, path: str):
    scene.export(path)


def save_usd(scene: trimesh.Scene, path: str):
    from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, Vt
    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    root = UsdGeom.Xform.Define(stage, "/Asset")
    stage.SetDefaultPrim(root.GetPrim())
    UsdGeom.Scope.Define(stage, "/Asset/Looks")
    for name, mesh in scene.geometry.items():
        safe = _safe(name)
        um = UsdGeom.Mesh.Define(stage, f"/Asset/{safe}")
        um.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(mesh.vertices.astype(np.float32)))
        um.CreateFaceVertexCountsAttr(Vt.IntArray([3] * len(mesh.faces)))
        um.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(mesh.faces.flatten().astype(np.int32)))
        um.CreateSubdivisionSchemeAttr("none")
        rgb = color_of(mesh) or [180, 180, 180]
        col = Gf.Vec3f(*[c / 255 for c in rgb])
        um.CreateDisplayColorAttr([col])
        mat = UsdShade.Material.Define(stage, f"/Asset/Looks/M_{safe}")
        sh = UsdShade.Shader.Define(stage, f"/Asset/Looks/M_{safe}/PBR")
        sh.CreateIdAttr("UsdPreviewSurface")
        sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(col)
        sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.6)
        mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
        UsdShade.MaterialBindingAPI.Apply(um.GetPrim()).Bind(mat)
    stage.GetRootLayer().Save()


def parts_list(scene: trimesh.Scene) -> list[dict]:
    out = []
    for name, m in scene.geometry.items():
        lo, hi = m.bounds
        eintrag = {"name": name, "farbe_rgb": color_of(m),
                   "mitte": [round(float(x), 4) for x in (lo + hi) / 2],
                   "groesse": [round(float(x), 4) for x in hi - lo]}
        palette = texture_palette(m)
        if palette:
            eintrag["textur"] = palette
        out.append(eintrag)
    return out
