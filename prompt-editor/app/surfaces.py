"""Bäckt Lack, Muster und Sticker in eine kompakte GLB-Textur."""
from __future__ import annotations

from io import BytesIO

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError

from . import model_io

TILE = 256
PAD = 2
# Je Fläche: horizontale und vertikale Projektionsachse, horizontal gespiegelt?
SIDES = ("vorne", "hinten", "oben", "unten", "links", "rechts")
PROJECTIONS = ((2, 1, True), (2, 1, False), (0, 2, True),
               (0, 2, False), (0, 1, False), (0, 1, True))


def read_image(raw):
    if not raw:
        raise ValueError("Für einen Bildsticker bitte eine Bilddatei anhängen.")
    try:
        with Image.open(BytesIO(raw), formats=("PNG", "JPEG", "WEBP")) as image:
            if image.width * image.height > 24_000_000:
                raise ValueError("Das Stickerbild ist zu groß.")
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.thumbnail((TILE, TILE), Image.Resampling.LANCZOS)
            return image
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Stickerbilder müssen als PNG, JPEG oder WebP lesbar sein.") from exc


def _chart_uv(mesh):
    axis = np.argmax(abs(mesh.face_normals), axis=1)
    chart = axis * 2 + (mesh.face_normals[np.arange(len(axis)), axis] < 0)
    # Trenne nur UV-Nähte. Kopiere die bisherigen Normalen für GLB-Shading.
    keys = mesh.faces * 6 + chart[:, None]
    unique, faces = np.unique(keys.ravel(), return_inverse=True)
    source = unique // 6
    vertices = mesh.vertices[source]
    coords = (vertices - mesh.bounds[0]) / np.where(mesh.extents > 0, mesh.extents, 1)
    uv = np.empty((len(vertices), 2))
    for i, (h, v, flip) in enumerate(PROJECTIONS):
        use = unique % 6 == i
        u = 1 - coords[use, h] if flip else coords[use, h]
        uv[use, 0] = (i % 3 * TILE + PAD + u * (TILE - 2 * PAD)) / (TILE * 3)
        uv[use, 1] = 1 - (i // 3 * TILE + PAD + (1 - coords[use, v]) * (TILE - 2 * PAD)) / (TILE * 2)
    projected = trimesh.Trimesh(vertices, faces.reshape(-1, 3), process=False,
                                vertex_normals=mesh.vertex_normals[source], metadata=mesh.metadata.copy())
    return projected, uv


def _paint(atlas, base, pattern):
    color = tuple(base or [180, 180, 180])
    atlas.paste(color, (0, 0, *atlas.size))
    if pattern is None:
        return
    kind, count, accent = pattern["art"], pattern["anzahl"], tuple(pattern["rgb"])
    motif = pattern.get("motiv")
    if kind not in ("streifen", "karo", "punkte", "grafik") or not isinstance(count, int) or not 1 <= count <= 16:
        raise ValueError("Ungültiges Muster oder Anzahl außerhalb 1–16.")
    if kind == "grafik" and (not motif or len(motif) > 8 or any(
        not 3 <= len(poly) <= 24 or any(len(p) != 2 or any(not 0 <= v <= 1 for v in p) for p in poly)
        for poly in motif
    )):
        raise ValueError("Ein Motiv braucht 1–8 Polygone mit je 3–24 Punkten (UV von 0 bis 1).")
    draw = ImageDraw.Draw(atlas)
    for side in range(6):
        ox, oy = side % 3 * TILE, side // 3 * TILE
        for x in range(count):
            x0, x1 = ox + x * TILE // count, ox + (x + 1) * TILE // count - 1
            if kind == "streifen":
                draw.rectangle((x0, oy, (x0 + x1) // 2, oy + TILE - 1), fill=accent)
                continue
            for y in range(count):
                y0, y1 = oy + y * TILE // count, oy + (y + 1) * TILE // count - 1
                if kind == "punkte":
                    inset = max(1, TILE // count // 4)
                    draw.ellipse((x0 + inset, y0 + inset, x1 - inset, y1 - inset), fill=accent)
                elif kind == "grafik":
                    for poly in motif:
                        draw.polygon([(x0 + round(u * (x1 - x0)), y1 - round(v * (y1 - y0)))
                                      for u, v in poly], fill=accent)
                elif (x + y) % 2 == 0:
                    draw.rectangle((x0, y0, x1, y1), fill=accent)


def _stamp(atlas, sticker, image, extents):
    side = SIDES.index(sticker["seite"])
    u, v = sticker["position"]
    size = sticker["breite"]
    if not 0 <= u <= 1 or not 0 <= v <= 1 or not 0.02 <= size <= 1:
        raise ValueError("Ungültige Stickerposition oder -breite.")
    text = sticker["text"]
    if text is None:
        stamp = image
    else:
        if not text.strip() or len(text) > 48 or not text.isprintable():
            raise ValueError("Stickertext muss 1–48 druckbare Zeichen enthalten.")
        font = ImageFont.load_default(size=36)
        left, top, right, bottom = font.getbbox(text)
        stamp = Image.new("RGBA", (right - left + 4, bottom - top + 4))
        ImageDraw.Draw(stamp).text((2 - left, 2 - top), text, font=font, fill=tuple(sticker["rgb"]))
    width = round(size * (TILE - 2 * PAD))
    h, v_axis, _ = PROJECTIONS[side]
    if extents[h] <= 0 or extents[v_axis] <= 0:
        raise ValueError("Diese Seite hat keine Fläche für einen Sticker.")
    aspect = extents[h] / extents[v_axis]
    height = min(TILE, max(1, round(width * stamp.height / stamp.width * aspect)))
    width = min(width, max(1, round(height * stamp.width / stamp.height / aspect)))
    stamp = stamp.resize((width, height), Image.Resampling.LANCZOS)
    ox, oy = side % 3 * TILE, side // 3 * TILE
    tile = atlas.crop((ox, oy, ox + TILE, oy + TILE)).convert("RGBA")
    x = round(PAD + u * (TILE - 2 * PAD) - width / 2)
    y = round(PAD + (1 - v) * (TILE - 2 * PAD) - height / 2)
    tile.alpha_composite(stamp, (x, y))
    atlas.paste(tile.convert("RGB"), (ox, oy))


def paint_mesh(mesh, rgb, metall, rauheit, muster, sticker, image):
    old = getattr(mesh.visual, "material", None)
    old_atlas = getattr(old, "baseColorTexture", None)
    is_atlas = (getattr(old, "name", None) or "").startswith(model_io.ATLAS_PREFIX) and old_atlas is not None
    base = rgb if rgb is not None else model_io.color_of(mesh) or [180, 180, 180]
    if (metall is not None and not 0 <= metall <= 1) or (rauheit is not None and not 0 <= rauheit <= 1):
        raise ValueError("Metall und Rauheit müssen zwischen 0 und 1 liegen.")
    use_atlas = muster is not None or sticker is not None
    if not use_atlas:
        result = mesh.copy()
        if rgb is not None:
            model_io.set_color(result, rgb)
        elif isinstance(old, trimesh.visual.material.PBRMaterial):
            # Glanz lässt sich unabhängig von der vorhandenen Textur ändern.
            pass
        else:
            model_io.set_color(result, model_io.color_of(mesh) or [180, 180, 180])
        material = result.visual.material
    else:
        keep = rgb is None and muster is None and sticker is not None
        if keep and is_atlas:
            result, uv = mesh.copy(), mesh.visual.uv.copy()
            atlas = old_atlas.convert("RGB")
        else:
            if keep and (getattr(old, "baseColorTexture", None) is not None or
                         getattr(old, "image", None) is not None):
                raise ValueError("Für Sticker auf importierten Texturen bitte eine neue Grundfarbe angeben.")
            result, uv = _chart_uv(mesh)
            atlas = Image.new("RGB", (TILE * 3, TILE * 2))
            _paint(atlas, base, muster)
        if sticker is not None:
            _stamp(atlas, sticker, image, mesh.extents)
        name = model_io.ATLAS_PREFIX + bytes(base).hex()
        material = trimesh.visual.material.PBRMaterial(name=name, baseColorTexture=atlas,
                                                     baseColorFactor=[255, 255, 255, 255])
        result.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    for key, val, fallback in (("metallicFactor", metall, 0.1), ("roughnessFactor", rauheit, 0.6)):
        previous = getattr(old, key, None)
        setattr(material, key, val if val is not None else fallback if previous is None else previous)
    return result


# ---------------------------------------------------------------- Bereiche einer vorhandenen Textur
def _used_mask(mesh, size, max_side=1024):
    """Texel, die dieses Teil tatsächlich nutzt (UV-Dreiecke gerastert), als bool-Array (H, W)."""
    w, h = size
    s = min(1.0, max_side / max(w, h))
    mw, mh = max(1, round(w * s)), max(1, round(h * s))
    uv = np.asarray(mesh.visual.uv, dtype=float)
    pts = np.c_[uv[:, 0] * mw, (1 - uv[:, 1]) * mh]
    mask = Image.new("L", (mw, mh), 0)
    draw = ImageDraw.Draw(mask)
    for f in mesh.faces:
        tri = pts[f]
        if not np.isfinite(tri).all():
            continue
        draw.polygon([tuple(p) for p in tri], fill=255, outline=255)
    if (mw, mh) != (w, h):
        mask = mask.resize((w, h), Image.Resampling.NEAREST)
    return np.asarray(mask) > 0


def _grow(mask, px):
    if px <= 0:
        return mask
    img = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * px + 1))
    return np.asarray(img) > 0


def recolor_region(mesh, quellfarben, toleranz, bild_bereich=None, ziel_rgb=None):
    """Färbt nur die Texel nahe den Quellfarben um (Schattierung bleibt) oder entfernt sie (Umgebungsfarbe).
    Gibt (neues Mesh, Anzahl geänderter Texel) zurück; die Geometrie bleibt unverändert."""
    from scipy.ndimage import binary_fill_holes

    img = model_io.texture_of(mesh)
    if img is None:
        raise ValueError("Dieses Teil hat keine Textur. Für einfarbige Teile faerbe verwenden.")
    if not 0 <= float(toleranz) <= 255:
        raise ValueError("toleranz muss zwischen 0 und 255 liegen.")
    rgba = np.asarray(img.convert("RGBA")).copy()
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3].astype(float)
    src = np.asarray(quellfarben, dtype=float).reshape(-1, 3)
    dist = np.full((h, w), np.inf)
    for c in src:
        dist = np.minimum(dist, np.linalg.norm(rgb - c, axis=-1))
    used = _used_mask(mesh, (w, h))
    region = used.copy()
    if bild_bereich is not None:
        x0, y0, x1, y1 = [float(v) for v in bild_bereich]
        if not all(0 <= v <= 1 for v in (x0, y0, x1, y1)) or x1 <= x0 or y1 <= y0:
            raise ValueError("bild_bereich braucht 0 ≤ x0 < x1 ≤ 1 und 0 ≤ y0 < y1 ≤ 1.")
        box = np.zeros_like(used)
        box[int(y0 * h):max(int(y0 * h) + 1, int(np.ceil(y1 * h))), int(x0 * w):max(int(x0 * w) + 1, int(np.ceil(x1 * w)))] = True
        region &= box
    mask = (dist <= float(toleranz)) & region
    if not mask.any():
        raise ValueError("Keine Texel mit diesen Quellfarben gefunden. Farben aus der Teiletabelle verwenden.")
    if ziel_rgb is None:
        # Logo entfernen: Löcher (z. B. Sonne im Logo) und Kantensaum mitnehmen, mit der Umgebungsfarbe füllen.
        # Schließen: Lücken wie Linien zwischen zwei Logofarben und der Umriss gehören zum Logo.
        grow = max(1, round(max(w, h) / 512))
        mask = binary_fill_holes(_grow(mask, 3 * grow)) & region
        ring = _grow(mask, 4 * grow) & ~mask & used
        fill = np.median(rgb[ring], axis=0) if ring.any() else np.array([255.0, 255.0, 255.0])
        rgb[mask] = fill
    else:
        if len(ziel_rgb) != 3 or any(not 0 <= int(c) <= 255 for c in ziel_rgb):
            raise ValueError("ziel_rgb braucht drei Werte zwischen 0 und 255.")
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
        ref = max(float(np.median(lum[mask])), 1.0)
        shade = np.clip(lum[mask] / ref, 0.0, 1.6)[:, None]
        rgb[mask] = np.clip(np.asarray(ziel_rgb, dtype=float)[None] * shade, 0, 255)
    rgba[..., :3] = rgb.round().astype(np.uint8)
    result = mesh.copy()
    mat = mesh.visual.material.copy()
    texture = Image.fromarray(rgba, "RGBA")
    if hasattr(mat, "baseColorTexture"):
        mat.baseColorTexture = texture
    else:
        mat.image = texture
    result.visual = trimesh.visual.TextureVisuals(uv=mesh.visual.uv.copy(), material=mat)
    return result, int(mask.sum())


def sample_texture(mesh, x, y):
    """Farbe der Textur an Bildposition (x, y) in 0–1, oben links 0,0 – oder None."""
    img = model_io.texture_of(mesh)
    if img is None:
        return None
    px = img.convert("RGB").getpixel((min(img.width - 1, max(0, int(x * img.width))),
                                      min(img.height - 1, max(0, int(y * img.height)))))
    return [int(c) for c in px]


def texture_neighborhood(mesh, x, y, radius=0.03, top=3):
    """Hauptfarben der Textur im Umkreis einer Bildposition (Pin trifft evtl. nur eine Linie im Logo)."""
    img = model_io.texture_of(mesh)
    if img is None:
        return []
    w, h = img.size
    box = (max(0, int((x - radius) * w)), max(0, int((y - radius) * h)),
           min(w, int((x + radius) * w) + 1), min(h, int((y + radius) * h) + 1))
    if box[2] <= box[0] or box[3] <= box[1]:
        return []
    px = np.asarray(img.convert("RGB").crop(box)).reshape(-1, 3).astype(int)
    keys, inv, counts = np.unique(px // 24, axis=0, return_inverse=True, return_counts=True)
    out = []
    for k in np.argsort(-counts)[:top]:
        share = counts[k] / len(px)
        if share >= 0.05:
            out.append(([int(c) for c in px[inv.ravel() == k].mean(0).round()], round(float(share), 2)))
    return out


# ---------------------------------------------------------------- Logos / Decals in die vorhandene Textur
MIN_DECAL_PX = 400    # so viele Texel soll ein Logo mindestens breit sein
MAX_TEXTURE = 4096    # größte Texturseite nach dem Hochrechnen
def text_image(text, rgb):
    """Text als freigestelltes Bild (für klebe_logo ohne Bild)."""
    if not text or not text.strip() or len(text) > 48 or not text.isprintable():
        raise ValueError("Logo-Text muss 1–48 druckbare Zeichen enthalten.")
    font = ImageFont.load_default(size=96)
    left, top, right, bottom = font.getbbox(text)
    img = Image.new("RGBA", (right - left + 8, bottom - top + 8))
    ImageDraw.Draw(img).text((4 - left, 4 - top), text, font=font, fill=tuple(rgb or [20, 20, 20]))
    return img


def _ensure_texture(mesh):
    """Teil ohne Textur bekommt einen Atlas in seiner Grundfarbe; ein Farbfaktor ≠ Weiß wird in die Textur gebacken,
    damit das Logo seine echten Farben behält. → (Mesh mit eigener Textur, RGBA-Bild)."""
    img = model_io.texture_of(mesh)
    if img is None:
        base = model_io.color_of(mesh) or [180, 180, 180]
        result, uv = _chart_uv(mesh)
        atlas = Image.new("RGB", (TILE * 3, TILE * 2), tuple(base))
        old = getattr(mesh.visual, "material", None)
        mat = trimesh.visual.material.PBRMaterial(
            name=model_io.ATLAS_PREFIX + bytes(base).hex(), baseColorTexture=atlas, baseColorFactor=[255, 255, 255, 255],
            metallicFactor=getattr(old, "metallicFactor", None) or 0.1,
            roughnessFactor=getattr(old, "roughnessFactor", None) or 0.6)
        result.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
        return result, atlas.convert("RGBA")
    result = mesh.copy()
    mat = mesh.visual.material.copy()
    rgba = img.convert("RGBA")
    factor = np.asarray(getattr(mat, "baseColorFactor", None) if getattr(mat, "baseColorFactor", None) is not None
                        else [255, 255, 255, 255], dtype=float)
    if factor.max() > 1.0001:
        factor = factor / 255.0
    if np.any(np.abs(factor[:3] - 1) > 1e-3):
        a = np.asarray(rgba).astype(float)
        a[..., :3] *= factor[:3]
        rgba = Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), "RGBA")
        if hasattr(mat, "baseColorFactor"):
            mat.baseColorFactor = [255, 255, 255, int(round(factor[3] * 255)) if len(factor) > 3 else 255]
    result.visual = trimesh.visual.TextureVisuals(uv=mesh.visual.uv.copy(), material=mat)
    return result, rgba


def _face_at_uv(mesh, uv_pt):
    """Dreieck, das den UV-Punkt enthält → (Flächenindex, Baryzentrische) oder None."""
    uv = np.asarray(mesh.visual.uv, dtype=float)[mesh.faces]  # (F, 3, 2)
    a, b, c = uv[:, 0], uv[:, 1], uv[:, 2]
    v0, v1, v2 = b - a, c - a, np.asarray(uv_pt, dtype=float) - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    ok = np.abs(den) > 1e-18
    den = np.where(ok, den, 1)
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    u = 1 - v - w
    eps = 1e-6
    inside = ok & (u >= -eps) & (v >= -eps) & (w >= -eps)
    idx = np.flatnonzero(inside)
    if not len(idx):
        return None
    f = int(idx[np.argmax(mesh.area_faces[idx])])
    return f, np.array([u[f], v[f], w[f]])


def _face_at_side(mesh, seite, position):
    """Strahl von der genannten Seite der Hülle nach innen; erster Treffer → (Flächenindex, Baryzentrische)."""
    side = SIDES.index(seite)
    axis, negative = side // 2, side % 2 == 1
    h, vax, flip = PROJECTIONS[side]
    lo, hi = mesh.bounds
    u, v = float(position[0]), float(position[1])
    if not 0 <= u <= 1 or not 0 <= v <= 1:
        raise ValueError("position braucht Werte zwischen 0 und 1.")
    origin = (lo + hi) / 2
    origin[h] = lo[h] + (1 - u if flip else u) * (hi[h] - lo[h])
    origin[vax] = lo[vax] + v * (hi[vax] - lo[vax])
    origin[axis] = (lo[axis] - 1) if negative else (hi[axis] + 1)
    direction = np.zeros(3)
    direction[axis] = 1.0 if negative else -1.0
    tri = mesh.triangles
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    p = np.cross(direction, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-14
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = origin - tri[:, 0]
    bu = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    bv = (q @ direction) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (bu >= 0) & (bv >= 0) & (bu + bv <= 1) & (t > 0)
    if not hit.any():
        raise ValueError(f"Auf der Seite „{seite}“ liegt an dieser Position keine Fläche.")
    f = int(np.flatnonzero(hit)[np.argmin(t[hit])])
    return f, np.array([1 - bu[f] - bv[f], bu[f], bv[f]])


def place_decal(mesh, logo, breite_m, uv_punkt=None, seite=None, position=None, drehung=0.0):
    """Klebt ein Bild (RGBA) als Aufkleber in die Textur des Teils – Textur und Geometrie bleiben, nur die
    Texel unter dem Aufkleber ändern sich. Ort: uv_punkt (Bildposition x, y in 0–1, oben links 0,0, z. B. vom Pin)
    oder seite + position (wie bei lackiere). breite_m = echte Breite in Metern; aufrecht = Welt-Y.
    → (neues Mesh, Info-Dict)."""
    breite_m = float(breite_m)
    if not np.isfinite(breite_m) or breite_m <= 0:
        raise ValueError("breite_m muss größer als 0 sein.")
    if max(mesh.extents) > 0 and breite_m > 2 * max(mesh.extents):
        raise ValueError("Das Logo wäre größer als das ganze Teil.")
    result, tex = _ensure_texture(mesh)
    W, H = tex.size
    hit = None
    if uv_punkt is not None and model_io.texture_of(mesh) is not None:
        x, y = float(uv_punkt[0]), float(uv_punkt[1])
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            raise ValueError("bild_position braucht Werte zwischen 0 und 1.")
        hit = _face_at_uv(result, (x, 1 - y))
        if hit is None:
            raise ValueError("Die Bildposition liegt auf keiner Fläche dieses Teils.")
    elif seite is not None:
        hit = _face_at_side(result, seite, position if position is not None else [0.5, 0.5])
    else:
        raise ValueError("Ort fehlt: Pin, bild_position oder seite angeben.")
    f, bary = hit
    tri3 = result.vertices[result.faces[f]]
    tri_uv = np.asarray(result.visual.uv, dtype=float)[result.faces[f]]
    point = bary @ tri3
    uv0 = bary @ tri_uv
    n = result.face_normals[f]
    # Ableitung Fläche → UV: J (3×2) = E · T⁻¹, Umkehr per Pseudo-Inverse.
    E = np.c_[tri3[1] - tri3[0], tri3[2] - tri3[0]]
    T = np.c_[tri_uv[1] - tri_uv[0], tri_uv[2] - tri_uv[0]]
    if abs(np.linalg.det(T)) < 1e-14:
        raise ValueError("Die Textur ist an dieser Stelle verzerrt (keine UV-Fläche).")
    J = E @ np.linalg.inv(T)
    M = np.linalg.pinv(J)  # 2×3: Weltversatz → UV-Versatz
    up = np.array([0.0, 1.0, 0.0]) - n[1] * n
    if np.linalg.norm(up) < 0.2:  # Dach/Boden: „oben“ im Bild zeigt zur längsten waagerechten Achse
        long = 0 if mesh.extents[0] >= mesh.extents[2] else 2
        up = np.eye(3)[long] - n[long] * n
    up /= np.linalg.norm(up)
    right = np.cross(up, n)
    rad = np.radians(float(drehung or 0))
    right, up = np.cos(rad) * right + np.sin(rad) * up, -np.sin(rad) * right + np.cos(rad) * up

    def to_px(d3):
        du, dv = M @ d3
        return np.array([du * W, -dv * H])

    lw, lh = logo.size
    hoehe_m = breite_m * lh / lw
    # Grobe Texturen (z. B. Editor-Atlas 768×512 für ein ganzes Auto) vorher hochrechnen, damit das Logo scharf wird.
    ppm = min(np.linalg.norm(to_px(right)), np.linalg.norm(to_px(up)))
    k = min(int(np.ceil(MIN_DECAL_PX / max(breite_m * ppm, 1e-9))), MAX_TEXTURE // max(W, H))
    if k >= 2:
        W, H = W * k, H * k
        tex = tex.resize((W, H), Image.Resampling.LANCZOS)
    # Logo-Pixel (i nach rechts, j nach unten) → Texturpixel: c + A · (i, j)
    ax = to_px(right) * (breite_m / lw)
    ay = to_px(-up) * (hoehe_m / lh)
    center = np.array([uv0[0] * W, (1 - uv0[1]) * H])
    origin = center - ax * lw / 2 - ay * lh / 2
    A = np.c_[ax, ay]
    if abs(np.linalg.det(A)) < 1e-9:
        raise ValueError("Logo wäre in der Textur kleiner als ein Pixel.")
    corners = np.array([origin + A @ c for c in ([0, 0], [lw, 0], [0, lh], [lw, lh])])
    x0, y0 = np.floor(corners.min(0)).astype(int)
    x1, y1 = np.ceil(corners.max(0)).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if x1 <= x0 or y1 <= y0:
        raise ValueError("Das Logo liegt außerhalb der Textur.")
    if (x1 - x0) * (y1 - y0) > 16_000_000:
        raise ValueError("Logo zu groß für die Textur.")
    # Umkehr-Abbildung für PIL: Ausgabepixel (relativ zu x0, y0) → Logo-Pixel
    Ai = np.linalg.inv(A)
    off = Ai @ (np.array([x0, y0]) - origin)
    coeffs = (Ai[0, 0], Ai[0, 1], off[0], Ai[1, 0], Ai[1, 1], off[1])
    # Für saubere Kanten ggf. erst auf die Zielgröße herunterrechnen
    scale = max(np.linalg.norm(ax), np.linalg.norm(ay))
    src = logo
    if scale < 0.5:
        k = max(scale * 2, 1 / max(lw, lh))
        src = logo.resize((max(1, round(lw * k)), max(1, round(lh * k))), Image.Resampling.LANCZOS)
        sx, sy = src.width / lw, src.height / lh
        coeffs = (coeffs[0] * sx, coeffs[1] * sx, coeffs[2] * sx, coeffs[3] * sy, coeffs[4] * sy, coeffs[5] * sy)
    warped = src.transform((x1 - x0, y1 - y0), Image.Transform.AFFINE, coeffs, Image.Resampling.BICUBIC,
                           fillcolor=(0, 0, 0, 0))
    # Nur Flächen derselben Seite in der Nähe beschriften (sonst läuft das Logo in Nachbar-Inseln der Textur)
    near = (np.linalg.norm(result.triangles_center - point, axis=1) < max(breite_m, hoehe_m) * 1.5) & \
           (result.face_normals @ n > 0.5)
    sub = result.copy()
    sub.update_faces(near)
    sub.remove_unreferenced_vertices()
    allowed = _grow(_used_mask(sub, (W, H)), 1)[y0:y1, x0:x1]
    alpha = np.asarray(warped.getchannel("A")).astype(float) * allowed
    warped.putalpha(Image.fromarray(alpha.round().astype(np.uint8), "L"))
    region = tex.crop((x0, y0, x1, y1))
    region.alpha_composite(warped)
    tex.paste(region, (x0, y0))
    mat = result.visual.material
    if hasattr(mat, "baseColorTexture"):
        mat.baseColorTexture = tex
    else:
        mat.image = tex
    result.visual = trimesh.visual.TextureVisuals(uv=result.visual.uv, material=mat)
    return result, {"punkt": [round(float(v), 4) for v in point], "texel": int((alpha > 8).sum()),
                    "groesse_m": [round(breite_m, 4), round(hoehe_m, 4)]}


# ---------------------------------------------------------------- Lack umfärben (Textur bleibt, Logos wählbar)
def repaint_texture(mesh, rgb, logos_entfernen=False):
    """Färbt den Lack einer texturierten Fläche um. Die Grundfarbe (häufigste Textur-Farbe) wird zur Zielfarbe,
    ihre Schattierung bleibt; dunkle Details (Scheiben, Gummi, Zierleisten) bleiben. Andersfarbige Bereiche
    (Logos, Aufdrucke) bleiben stehen – oder werden mit logos_entfernen flach in der Zielfarbe übermalt.
    → (neues Mesh, Anzahl geänderter Texel)."""
    if len(rgb) != 3 or any(not 0 <= int(c) <= 255 for c in rgb):
        raise ValueError("RGB braucht drei Werte zwischen 0 und 255.")
    result, tex = _ensure_texture(mesh)  # backt einen Farbfaktor in die Textur
    a = np.asarray(tex).astype(float)
    h, w = a.shape[:2]
    px = a[..., :3]
    lum = px @ np.array([0.2126, 0.7152, 0.0722])
    used = _used_mask(result, (w, h))
    if not used.any():
        raise ValueError("Dieses Teil nutzt keine Textur-Fläche.")
    q = (px[used] // 24).astype(int)
    keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    base = px[used][inv.ravel() == int(np.argmax(counts))].mean(0)
    lbase = max(float(base @ np.array([0.2126, 0.7152, 0.0722])), 1.0)
    dist = np.linalg.norm(px - base, axis=-1)
    wb = np.clip((75.0 - dist) / 40.0, 0.0, 1.0)                       # Anteil „Grundfarbe“ (weiche Kante)
    dark = np.clip((95.0 - lum) / 25.0, 0.0, 1.0) if lbase >= 110 else np.zeros_like(lum)  # dunkle Details
    shade = np.clip(lum / lbase, 0.0, 1.35)[..., None]
    target = np.asarray(rgb, dtype=float)[None, None, :]
    shaded = np.clip(target * shade, 0, 255)
    keep = (1 - wb) if not logos_entfernen else dark * (1 - wb)        # Anteil Originalfarbe
    value = wb[..., None] * shaded + (1 - wb[..., None]) * target
    out = keep[..., None] * px + (1 - keep[..., None]) * value
    changed = used & (keep < 0.5)
    px2 = np.where(used[..., None], out, px)
    a[..., :3] = np.clip(px2, 0, 255)
    mat = result.visual.material
    img = Image.fromarray(a.round().astype(np.uint8), "RGBA")
    if hasattr(mat, "baseColorTexture"):
        mat.baseColorTexture = img
    else:
        mat.image = img
    result.visual = trimesh.visual.TextureVisuals(uv=result.visual.uv, material=mat)
    return result, int(changed.sum())


# ---------------------------------------------------------------- Logos als eigene Teile
def _project_down(mesh, points, n, reach):
    """Punkte entlang −n auf die Oberfläche setzen (nächster Treffer innerhalb reach) → (Punkte, Normalen, Treffer?)."""
    tri = mesh.triangles
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    d = -np.asarray(n, dtype=float)
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-14
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    out = np.array(points, dtype=float)
    normals = np.tile(np.asarray(n, dtype=float), (len(points), 1))
    hit = np.zeros(len(points), dtype=bool)
    for k, pt in enumerate(points):
        origin = pt + np.asarray(n) * reach
        s = origin - tri[:, 0]
        bu = (s * p).sum(1) * inv
        q = np.cross(s, e1)
        bv = (q @ d) * inv
        t = (e2 * q).sum(1) * inv
        good = ok & (bu >= 0) & (bv >= 0) & (bu + bv <= 1) & (t > 0) & (t <= 2 * reach)
        if good.any():
            f = int(np.flatnonzero(good)[np.argmin(t[good])])
            out[k] = origin + d * t[f]
            normals[k] = mesh.face_normals[f]
            hit[k] = True
    return out, normals, hit


def decal_part(mesh, logo, breite_m, uv_punkt=None, seite=None, position=None, drehung=0.0, raster=10):
    """Logo als eigenes, hauchdünnes Teil (Fläche mit transparenter Textur) auf die Oberfläche legen.
    Ort wie bei place_decal. Das Teil schmiegt sich an die Fläche an und lässt sich einzeln wählen, skalieren, löschen.
    → (Mesh des Logos, Info-Dict)."""
    breite_m = float(breite_m)
    if not np.isfinite(breite_m) or breite_m <= 0:
        raise ValueError("breite_m muss größer als 0 sein.")
    if max(mesh.extents) > 0 and breite_m > 2 * max(mesh.extents):
        raise ValueError("Das Logo wäre größer als das ganze Teil.")
    hit = None
    if uv_punkt is not None and model_io.texture_of(mesh) is not None:
        x, y = float(uv_punkt[0]), float(uv_punkt[1])
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            raise ValueError("bild_position braucht Werte zwischen 0 und 1.")
        hit = _face_at_uv(mesh, (x, 1 - y))
        if hit is None:
            raise ValueError("Die Bildposition liegt auf keiner Fläche dieses Teils.")
    elif seite is not None:
        hit = _face_at_side(mesh, seite, position if position is not None else [0.5, 0.5])
    else:
        raise ValueError("Ort fehlt: Pin, bild_position oder seite angeben.")
    f, bary = hit
    point = bary @ mesh.vertices[mesh.faces[f]]
    n = mesh.face_normals[f]
    up = np.array([0.0, 1.0, 0.0]) - n[1] * n
    if np.linalg.norm(up) < 0.2:  # Dach/Boden: „oben“ im Bild zeigt zur längsten waagerechten Achse
        long = 0 if mesh.extents[0] >= mesh.extents[2] else 2
        up = np.eye(3)[long] - n[long] * n
    up /= np.linalg.norm(up)
    right = np.cross(up, n)
    rad = np.radians(float(drehung or 0))
    right, up = np.cos(rad) * right + np.sin(rad) * up, -np.sin(rad) * right + np.cos(rad) * up
    lw, lh = logo.size
    hoehe_m = breite_m * lh / lw
    abstand = max(0.002, 0.0012 * float(max(mesh.extents)))
    reach = max(breite_m, hoehe_m) * 0.5
    g = int(raster)
    us, vs = np.meshgrid(np.linspace(-0.5, 0.5, g + 1), np.linspace(-0.5, 0.5, g + 1))
    flat = point + right[None] * (us.ravel() * breite_m)[:, None] + up[None] * (vs.ravel() * hoehe_m)[:, None]
    pts, normals, got = _project_down(mesh, flat, n, reach)
    # Nur Punkte übernehmen, die nahe an der ebenen Lage liegen (kein Springen auf andere Flächen).
    near = got & (np.linalg.norm(pts - flat, axis=1) < reach) & ((normals @ n) > 0.3)
    pts = np.where(near[:, None], pts + normals * abstand, flat + n * abstand)
    faces = []
    for r in range(g):
        for c in range(g):
            a = r * (g + 1) + c
            b, cc, d = a + 1, a + g + 2, a + g + 1
            faces += [[a, b, cc], [a, cc, d]]
    uv = np.c_[(us.ravel() + 0.5), (vs.ravel() + 0.5)]
    img = logo.convert("RGBA")
    if max(img.size) > 1024:
        img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    deco = trimesh.Trimesh(pts, np.array(faces), process=False)
    material = trimesh.visual.material.PBRMaterial(
        name="logo", baseColorTexture=img, baseColorFactor=[255, 255, 255, 255], alphaMode="BLEND",
        doubleSided=True, metallicFactor=0.0, roughnessFactor=0.55)
    deco.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return deco, {"punkt": [round(float(v), 4) for v in point], "groesse_m": [round(breite_m, 4), round(hoehe_m, 4)]}
