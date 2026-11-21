"""Bäckt Lack, Muster und Sticker in eine kompakte GLB-Textur."""
from __future__ import annotations

from io import BytesIO

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

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
