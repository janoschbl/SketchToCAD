"""End-to-end-Test der App über HTTP – ohne API-Schlüssel (LLM_MODE=mock).
Start: python -m pytest -q tests   (im Ordner sketchtocad_app)"""
import io, json, os, sys, tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ["LLM_MODE"] = "mock"
os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app import model_io, planner, cad_sandbox
from app.demo import make_testauto
from app.server import app

c = TestClient(app)


def fps(sid, v):
    scene = model_io.load_model(str(Path(os.environ["DATA_DIR"]) / sid / f"v{v}.glb"))
    return {n: (model_io.fingerprint(m), tuple(model_io.color_of(m) or [])) for n, m in scene.geometry.items()}


def upload():
    r = c.post("/api/upload", files={"datei": ("auto.glb", make_testauto().export(file_type="glb"), "model/gltf-binary")})
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
    assert content[-1] == {"type": "input_image", "image_url": "data:image/png;base64,AAAA", "detail": "low"}
    for t in req["tools"]:
        assert t["type"] == "function" and t["parameters"]["additionalProperties"] is False
        assert set(t["parameters"]["required"]) == set(t["parameters"]["properties"])  # strict-kompatibel



def test_einfache_farbe_auch_im_openai_modus_lokal(monkeypatch):
    monkeypatch.setenv("LLM_MODE", "openai")
    sid = upload()["session"]
    res = edit(sid, "Mach die Felgen weiß")
    assert res["neue_version"]
    assert res["nutzung"]["api_aufrufe"] == res["nutzung"]["input_tokens"] == 0


def test_heckfluegel_hinzufuegen_und_undo():
    sid = upload()["session"]
    original = fps(sid, 1)
    res = edit(sid, "Füge einen Heckflügel hinzu")
    assert res["aufrufe"][0]["ergebnis"] == ["heckfluegel"]
    after = fps(sid, 2)
    assert set(after) - set(original) == {"heckfluegel"}
    assert {n: after[n] for n in original} == original
    assert c.post(f"/api/{sid}/undo").json()["version"] == 1


def test_umbau_auf_acht_und_zwei_sitze(monkeypatch):
    sid = upload()["session"]
    original = fps(sid, 1)
    positions = [[x, 0, z] for x in (-0.36, -0.12, 0.12, 0.36) for z in (-0.24, 0.24)]
    calls = [{"name": "baue", "arguments": {"bezug": "kabine", "teile": [
        {"name": "sítz", "form": "profil", "quelle": None, "positionen": positions,
         "profil": [[0, 0], [1, 0], [1, 0.25], [0.25, 0.25], [0.25, 1], [0, 1]],
         "groesse": [0.16, 0.7, 0.3], "drehung": [0, 0, 0], "rgb": [40, 40, 40]}
    ]}}]
    def respond(**request):
        assert len(request["input"]) == 1
        return SimpleNamespace(
            output=[SimpleNamespace(type="function_call", name=call["name"],
                                    arguments=json.dumps(call["arguments"])) for call in calls],
            output_text="", usage=SimpleNamespace(input_tokens=100, output_tokens=50),
        )

    monkeypatch.setenv("LLM_MODE", "openai")
    monkeypatch.setattr(planner, "_responses", lambda: SimpleNamespace(create=respond))
    res = edit(sid, "Mach daraus einen Achtsitzer")
    assert res["nutzung"]["api_aufrufe"] == 1
    assert res["aufrufe"][0]["ergebnis"] == [f"sitz_{i}" for i in range(1, 9)]
    before = fps(sid, 2)
    assert all(before[n] == value for n, value in original.items())
    calls[:] = [{"name": "loesche", "arguments": {"teil": "sitz_[1-6]"}}]
    res = edit(sid, "Nur noch zwei Sitze")
    assert {p["name"] for p in res["teile"] if p["name"].startswith("sitz_")} == {"sitz_7", "sitz_8"}


def test_muster_und_spaeterer_bildsticker_bleiben_im_glb(monkeypatch):
    sid = upload()["session"]
    args = {"teil": "karosserie", "rgb": [5, 70, 180], "metall": 0.4, "rauheit": 0.2,
            "muster": {"art": "grafik", "anzahl": 3, "rgb": [255, 255, 255],
                       "motiv": [[[0, 0], [1, 0.5], [0, 1]]]}, "sticker": None}
    monkeypatch.setattr(planner, "plan", lambda *a: {
        "calls": [{"name": "lackiere", "arguments": args}], "text": "", "usage": {"api_aufrufe": 1}
    })
    res = edit(sid, "Blauer Lack mit weißen Pfeilen")
    assert res["aufrufe"][0]["ergebnis"] == ["karosserie"]
    assert len(res["teile"]) == 13

    def material(version):
        sc = model_io.load_model(str(Path(os.environ["DATA_DIR"]) / sid / f"v{version}.glb"))
        return sc.geometry["karosserie"].visual.material

    before = np.array(material(2).baseColorTexture)
    args.update(rgb=None, metall=None, rauheit=None, muster=None,
                sticker={"seite": "links", "position": [0.5, 0.5], "breite": 0.3,
                         "text": None, "rgb": [255, 255, 255]})
    image = io.BytesIO()
    Image.new("RGBA", (64, 16), (200, 30, 90, 180)).save(image, "PNG")
    r = c.post(f"/api/{sid}/edit", data={"auftrag": "Bild als Sticker links"},
               files={"bild": ("sticker.png", image.getvalue(), "image/png")})
    assert r.status_code == 200 and r.json()["neue_version"], r.text
    after = material(3)
    assert np.isclose(after.roughnessFactor, 0.2) and np.isclose(after.metallicFactor, 0.4)
    pixels = np.array(after.baseColorTexture)
    changed = np.argwhere(np.any(before != pixels, axis=2))
    assert 0 < len(changed) < 256 ** 2
    assert (changed[:, 0] >= 256).all() and ((256 <= changed[:, 1]) & (changed[:, 1] < 512)).all()
    assert fps(sid, 3)["karosserie"][1] == (5, 70, 180)
    assert fps(sid, 3)["kabine"] == fps(sid, 1)["kabine"]



def test_dashboard_standardauto_und_standardmodell(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert c.get("/api/config").json()["modell"] == "gpt-6.2-sol"
    r = c.post("/api/demo")
    assert r.status_code == 200
    state = r.json()
    assert state["version"] == 1 and len(state["teile"]) == 13
    assert c.get(state["glb_url"]).content.startswith(b"glTF")
    assert edit(state["session"], "Karosserie blau")["neue_version"]
    assert c.post("/api/demo").json()["session"] != state["session"]


def test_kantensegmentierung_zerlegt_einen_koerper(tmp_path):
    import trimesh
    from app import model_io
    from app.segmentation import segment_faces

    box = trimesh.creation.box([2, 1, 1])
    labels, count = segment_faces(box.vertices, box.faces)
    assert count == 6 and len(labels) == len(box.faces)
    path = tmp_path / "box.glb"
    box.export(path)
    scene = model_io.load_model(str(path), split=True)
    assert len(scene.geometry) == 6


def test_schaerfen_macht_aus_weichem_quader_flache_ebenen():
    import trimesh
    from scipy import ndimage as ndi
    import pytest
    marching_cubes = pytest.importorskip("skimage.measure").marching_cubes
    from app.sharpen import sharpen

    vol = np.zeros((40, 40, 40), np.float32); vol[8:32, 10:30, 12:28] = 1
    v, f, _, _ = marching_cubes(ndi.gaussian_filter(vol, 2.5), 0.5)  # abgerundeter Quader
    v = (v - 20) / 20
    out, faces, lab = sharpen(v, f)
    assert 6 <= lab.max() + 1 <= 14
    edges = trimesh.Trimesh(out, faces, process=False)
    # nach dem Schärfen liegen die Dreiecke deutlich ebener: viele Normalen liegen nahe an den 6 Achsen
    n = edges.face_normals
    assert (np.abs(n).max(1) > 0.97).mean() > 0.75
