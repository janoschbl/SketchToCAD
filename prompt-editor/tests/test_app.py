"""End-to-end-Test der App über HTTP – ohne API-Schlüssel (LLM_MODE=mock).
Start: python -m pytest -q tests   (im Ordner sketchtocad_app)"""
import io, json, os, sys, tempfile
from pathlib import Path

os.environ["LLM_MODE"] = "mock"
os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import trimesh
from fastapi.testclient import TestClient

from app import model_io, planner, cad_sandbox
from app.server import app

c = TestClient(app)


def make_testauto_glb() -> bytes:
    s = trimesh.Scene()
    def add(name, m, rgb):
        model_io.set_color(m, rgb); s.add_geometry(m, node_name=name, geom_name=name)
    add("karosserie", trimesh.creation.box([4, 0.8, 1.8]).apply_translation([0, 0.8, 0]), [200, 30, 30])
    add("kabine", trimesh.creation.box([2, 0.7, 1.6]).apply_translation([-0.2, 1.55, 0]), [200, 30, 30])
    for n, x, z in [("vl", 1.3, 0.95), ("vr", 1.3, -0.95), ("hl", -1.3, 0.95), ("hr", -1.3, -0.95)]:
        add(f"reifen_{n}", trimesh.creation.cylinder(radius=0.45, height=0.3).apply_translation([x, 0.45, z]), [25, 25, 25])
        add(f"felge_{n}", trimesh.creation.cylinder(radius=0.25, height=0.32).apply_translation([x, 0.45, z]), [150, 150, 150])
    for n, z in [("l", 0.6), ("r", -0.6)]:
        add(f"scheinwerfer_{n}", trimesh.creation.box([0.1, 0.2, 0.4]).apply_translation([2.02, 0.9, z]), [255, 240, 180])
    add("spoiler", trimesh.creation.box([0.3, 0.1, 1.6]).apply_translation([-1.9, 1.45, 0]), [30, 30, 30])
    return s.export(file_type="glb")


def fps(sid, v):
    scene = model_io.load_model(str(Path(os.environ["DATA_DIR"]) / sid / f"v{v}.glb"))
    return {n: (model_io.fingerprint(m), tuple(model_io.color_of(m) or [])) for n, m in scene.geometry.items()}


def upload():
    r = c.post("/api/upload", files={"datei": ("auto.glb", make_testauto_glb(), "model/gltf-binary")})
    assert r.status_code == 200, r.text
    return r.json()


def edit(sid, auftrag, **kw):
    r = c.post(f"/api/{sid}/edit", data={"auftrag": auftrag, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_frontend_und_config():
    assert c.get("/").status_code == 200
    assert c.get("/api/config").json()["modus"] == "mock"


def test_upload_teile():
    st = upload()
    assert len(st["teile"]) == 13 and st["version"] == 1


def test_lokale_aenderung_nur_gemeinte_teile():
    st = upload(); sid = st["session"]
    vor = fps(sid, 1)
    res = edit(sid, "Mach die Felgen weiß")
    assert res["neue_version"] and res["version"] == 2
    nach = fps(sid, 2)
    geaendert = {n for n in vor if vor[n] != nach.get(n)}
    assert geaendert == {"felge_vl", "felge_vr", "felge_hl", "felge_hr"}


def test_auswahl_per_klick_wird_genutzt():
    st = upload(); sid = st["session"]
    res = edit(sid, "mach das rot", ausgewaehlt="spoiler")
    assert res["aufrufe"][0]["ergebnis"] == ["spoiler"]


def test_skalieren_mit_bodenanker():
    st = upload(); sid = st["session"]
    edit(sid, "Größere Räder")
    sc = model_io.load_model(str(Path(os.environ["DATA_DIR"]) / sid / "v2.glb"))
    assert abs(sc.geometry["reifen_vl"].bounds[0][1] - 0.0) < 1e-6  # Unterkante bleibt am Boden


def test_rueckfrage_erzeugt_keine_version():
    st = upload(); sid = st["session"]
    res = edit(sid, "Mach es irgendwie schöner")
    assert res["rueckfragen"] and not res["neue_version"] and res["version"] == 1


def test_ersetze_per_cad_code_einmal_erzeugt_und_gespiegelt():
    st = upload(); sid = st["session"]
    vor = fps(sid, 1)
    res = edit(sid, "Neue Sternfelgen vorne")
    log = res["aufrufe"][0]
    assert "fehler" not in log, log
    assert sorted(log["ergebnis"]) == ["felge_vl", "felge_vr"]
    nach = fps(sid, 2)
    assert {n for n in vor if vor[n] != nach[n]} == {"felge_vl", "felge_vr"}
    sc = model_io.load_model(str(Path(os.environ["DATA_DIR"]) / sid / "v2.glb"))
    # gespiegelt: Speichen (Schauseite) liegen jeweils auf der Außenseite
    l, r = sc.geometry["felge_vl"], sc.geometry["felge_vr"]
    assert l.vertices[:, 2].mean() > l.bounds.mean(0)[2] - 1e-3 and r.vertices[:, 2].mean() < r.bounds.mean(0)[2] + 1e-3


def test_undo_und_usd_export_und_reimport():
    st = upload(); sid = st["session"]
    edit(sid, "Spoiler weg")
    assert c.post(f"/api/{sid}/undo").json()["version"] == 1
    usd = c.get(f"/api/{sid}/export.usda")
    assert usd.status_code == 200 and b"def Mesh" in usd.content
    r = c.post("/api/upload", files={"datei": ("modell.usda", usd.content, "text/plain")})
    assert r.status_code == 200 and len(r.json()["teile"]) == 13


def test_sandbox_blockiert_gefaehrlichen_code():
    for bad in ["import os\nresult=1", "result = open('/etc/passwd').read()", "import cadquery as cq\nx=().__class__"]:
        try:
            cad_sandbox.pruefe(bad); assert False, bad
        except cad_sandbox.CadError:
            pass


def test_openai_anfrage_struktur():
    req = planner.build_request([{"name": "horn"}], "Horn lila", "horn", "data:image/png;base64,AAAA", "gpt-6.1-sol")
    assert req["model"] == "gpt-6.1-sol" and req["tools"] and req["parallel_tool_calls"]
    content = req["input"][0]["content"]
    assert content[0]["type"] == "input_text" and "horn" in content[0]["text"]
    assert content[-1] == {"type": "input_image", "image_url": "data:image/png;base64,AAAA"}
    for t in req["tools"]:
        assert t["type"] == "function" and t["parameters"]["additionalProperties"] is False
        assert set(t["parameters"]["required"]) == set(t["parameters"]["properties"])  # strict-kompatibel
