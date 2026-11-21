"""Segmentiertes Testauto für den Prompt-Editor."""

import trimesh

from . import model_io


def make_testauto():
    s = trimesh.Scene()
    def add(name, m, rgb):
        model_io.set_color(m, rgb)
        s.add_geometry(m, node_name=name, geom_name=name)
    add("karosserie", trimesh.creation.box([4, 0.8, 1.8]).apply_translation([0, 0.8, 0]), [200, 30, 30])
    add("kabine", trimesh.creation.box([2, 0.7, 1.6]).apply_translation([-0.2, 1.55, 0]), [200, 30, 30])
    for n, x, z in [("vl", 1.3, 0.95), ("vr", 1.3, -0.95), ("hl", -1.3, 0.95), ("hr", -1.3, -0.95)]:
        add(f"reifen_{n}", trimesh.creation.cylinder(radius=0.45, height=0.3).apply_translation([x, 0.45, z]), [25, 25, 25])
        add(f"felge_{n}", trimesh.creation.cylinder(radius=0.25, height=0.32).apply_translation([x, 0.45, z]), [150, 150, 150])
    for n, z in [("l", 0.6), ("r", -0.6)]:
        add(f"scheinwerfer_{n}", trimesh.creation.box([0.1, 0.2, 0.4]).apply_translation([2.02, 0.9, z]), [255, 240, 180])
    add("spoiler", trimesh.creation.box([0.3, 0.1, 1.6]).apply_translation([-1.9, 1.45, 0]), [30, 30, 30])
    return s
