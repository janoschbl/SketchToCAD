"""Baut neue Teile aus begrenzten, kombinierbaren Mesh-Operationen."""
from __future__ import annotations

from unicodedata import normalize

import numpy as np
import trimesh

from . import model_io


def primitive(form, profil):
    if form == "profil":
        from manifold3d import CrossSection, FillRule

        points = np.asarray(profil, dtype=float)
        if (points.ndim != 2 or points.shape[1] != 2 or not 3 <= len(points) <= 32
                or not np.isfinite(points).all() or np.any(abs(points) > 10)):
            raise ValueError("Ein Profil braucht 3–32 begrenzte XY-Punkte.")
        section = CrossSection([points], FillRule.EvenOdd)
        if section.is_empty():
            raise ValueError("Das Profil muss eine Fläche einschließen.")
        mesh = section.extrude(1).to_mesh()
        return trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=False)
    if form in ("box", "keil"):
        mesh = trimesh.creation.box()
        if form == "keil":
            # Oberseite schmaler und nach hinten versetzt.
            oben = mesh.vertices[:, 1] > 0
            mesh.vertices[oben, 0] = mesh.vertices[oben, 0] * 0.45 - 0.2
        return mesh
    if form == "kugel":
        return trimesh.creation.icosphere(subdivisions=2)
    if form in ("zylinder", "kegel"):
        create = trimesh.creation.cylinder if form == "zylinder" else trimesh.creation.cone
        return create(radius=0.5, height=1, sections=24).apply_transform(
            trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    raise ValueError(f"Unbekannte Form: {form}")


def add_parts(scene, bezug, teile):
    """Position und Größe relativ zur Bounding Box des Bezugs, Rotation in Grad."""
    if not 1 <= len(teile) <= 32:
        raise ValueError("Pro Aufruf sind 1–32 Vorlagen möglich.")
    anchor = scene.geometry.get(bezug) if bezug is not None else scene
    if anchor is None or anchor.bounds is None:
        raise ValueError("Der Bezug braucht eine gültige Bounding Box.")
    bounds = anchor.bounds
    center = bounds.mean(0)
    extents = np.ptp(bounds, axis=0)
    # Auch ein flaches Bezugsteil kann ein Teil mit Höhe tragen.
    extents = np.where(extents > 0, extents, extents.max())
    used = {name.lower() for name in scene.geometry}
    pending = {}
    for teil in teile:
        label = normalize("NFKD", teil["name"]).encode("ascii", "ignore").decode()
        name = model_io._safe(label)
        form = teil["form"]
        if form == "kopie":
            mesh = scene.geometry.get(teil["quelle"])
        else:
            mesh = primitive(form, teil.get("profil"))
        if mesh is None:
            raise ValueError(f"Quellteil fehlt: {teil['quelle']}")
        offsets = np.asarray(teil["positionen"], dtype=float)
        dims = np.asarray(teil["groesse"], dtype=float)
        angles = np.asarray(teil["drehung"], dtype=float)
        if (offsets.ndim != 2 or offsets.shape[1] != 3 or not 1 <= len(offsets) <= 32
                or dims.shape != (3,) or angles.shape != (3,)
                or not np.all(np.isfinite(offsets)) or np.any(abs(offsets) > 10)
                or not np.all(np.isfinite(dims)) or np.any(dims <= 0) or np.any(dims > 10)
                or not np.all(np.isfinite(angles)) or np.any(abs(angles) > 360)):
            raise ValueError("Ungültige Position, Größe oder Drehung.")
        if len(pending) + len(offsets) > 64:
            raise ValueError("Pro Aufruf sind höchstens 64 neue Teile möglich.")
        template = mesh.copy()
        template.apply_translation(-mesh.bounds.mean(0))
        scale = np.divide(dims * extents, mesh.extents, out=np.ones(3), where=mesh.extents > 0)
        template.apply_scale(scale)
        template.apply_transform(trimesh.transformations.euler_matrix(*np.radians(angles)))
        template.apply_translation(-template.bounds.mean(0))
        if teil["rgb"] is not None:
            model_io.set_color(template, teil["rgb"])
        for i, offset in enumerate(offsets, 1):
            key = f"{name}_{i}" if len(offsets) > 1 else name
            if key.lower() in used:
                raise ValueError(f"Teilname bereits vergeben: {key}")
            used.add(key.lower())
            pending[key] = template.copy().apply_translation(center + offset * extents)

    for name, mesh in pending.items():
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    return list(pending)
