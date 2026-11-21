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
from app import server

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


# ---------------------------------------------------------------- Hauptapp: Direktbearbeitung
TRUCK = Path(__file__).resolve().parent.parent / "data" / "testmodelle" / "cesium-milk-truck" / "CesiumMilkTruck.glb"


def edit_glb(auftrag, glb=None, **kw):
    glb = glb if glb is not None else make_testauto().export(file_type="glb")
    r = c.post("/api/edit-glb", files={"datei": ("modell.glb", glb, "model/gltf-binary")}, data={"auftrag": auftrag, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def load_v(res):
    return model_io.load_model(str(Path(os.environ["DATA_DIR"]) / res["session"] / f"v{res['version']}.glb"))


def test_edit_glb_aendert_hochgeladenes_modell_in_einmalsitzung():
    res = edit_glb("mach das rot", ausgewaehlt="spoiler")
    assert res["neue_version"] and res["aufrufe"][0]["ergebnis"] == ["spoiler"]
    assert len(res["teile"]) == 13
    assert (Path(os.environ["DATA_DIR"]) / res["session"] / ".adhoc").exists()
    assert c.get(res["glb_url"]).content.startswith(b"glTF")


def test_edit_glb_lehnt_falsches_format_ab():
    r = c.post("/api/edit-glb", files={"datei": ("x.txt", b"x", "text/plain")}, data={"auftrag": "x"})
    assert r.status_code == 400


def test_erstellen_von_grund_auf_gibt_es_nicht_mehr():
    assert c.post("/api/create", data={"auftrag": "Ein Tisch"}).status_code != 200
    assert not hasattr(planner, "plan_new")


def test_einmalsitzungen_laufen_ab_eigene_bleiben(monkeypatch):
    from app import server
    eigene = upload()["session"]
    adhoc = edit_glb("mach das rot", ausgewaehlt="spoiler")["session"]
    monkeypatch.setattr(server, "ADHOC_TTL_S", -1)
    server.prune_adhoc_sessions()
    assert not (Path(os.environ["DATA_DIR"]) / adhoc).exists()
    assert (Path(os.environ["DATA_DIR"]) / eigene).exists()


def test_echte_groesse_exakt_proportional_mit_bodenanker():
    vorher = make_testauto()
    lo0, hi0 = vorher.bounds
    res = edit_glb("make it 10 centimeter long")
    assert res["neue_version"], res
    lo, hi = load_v(res).bounds
    ext0, ext = hi0 - lo0, hi - lo
    i = 0 if ext0[0] >= ext0[2] else 2
    assert abs(ext[i] - 0.1) < 1e-6
    assert np.allclose(ext / ext[i], ext0 / ext0[i], atol=1e-6)  # Proportionen bleiben
    assert abs(lo[1] - lo0[1]) < 1e-6                           # Unterkante bleibt


def test_angleichen_an_einziges_anderes_modell_ohne_rueckfrage():
    modelle = [{"name": "Tisch", "laenge": 1.2, "breite": 0.8, "hoehe": 0.75}]
    res = edit_glb("mach ihn 10 cm lang und gleich die anderen größen an", modelle=json.dumps(modelle))
    assert [l["werkzeug"] for l in res["aufrufe"]] == ["gleiche_an", "setze_groesse"]
    assert "fehler" not in res["aufrufe"][0]


def test_angleichen_bei_mehreren_modellen_fragt_nach_modell_und_setzt_fort():
    modelle = [{"name": "Tisch", "laenge": 1.2, "breite": 0.8, "hoehe": 0.75},
               {"name": "Stuhl", "laenge": 0.5, "breite": 0.5, "hoehe": 0.9}]
    auftrag = "mach ihn 10 cm lang und gleich die anderen größen an"
    res = edit_glb(auftrag, modelle=json.dumps(modelle))
    assert not res["neue_version"] and res["rueckfragen"][0]["typ"] == "modell"
    verlauf = [{"rolle": "agent", "text": res["rueckfragen"][0]["frage"]},
               {"rolle": "nutzer", "text": "Stuhl", "modell": "Stuhl"}]
    weiter = edit(res["session"], auftrag, modelle=json.dumps(modelle), verlauf=json.dumps(verlauf))
    assert weiter["neue_version"] and weiter["aufrufe"][0]["argumente"]["referenz"] == "Stuhl"


def test_alles_weiss_fragt_mit_optionen_und_antwort_aendert_nur_die_karosserie():
    res = edit_glb("mach alles weiß")
    assert not res["neue_version"] and res["version"] == 1
    frage = res["rueckfragen"][0]
    assert frage["typ"] == "auswahl" and [o["label"] for o in frage["optionen"]] == ["Alles", "Nur Karosserie", "Ohne Räder und Glas"]
    sid = res["session"]
    vor = fps(sid, 1)
    option = frage["optionen"][1]
    verlauf = [{"rolle": "agent", "text": frage["frage"]}, {"rolle": "nutzer", "text": option["label"], "teile": option["teile"]}]
    weiter = edit(sid, "mach alles weiß", verlauf=json.dumps(verlauf))
    assert weiter["neue_version"]
    nach = fps(sid, 2)
    assert {n for n in vor if vor[n] != nach[n]} == {"karosserie"}


def test_oldtimer_baut_nichts_sondern_fragt():
    res = edit_glb("mach daraus ein echtes Modell eines Oldtimers")
    assert not res["neue_version"] and res["rueckfragen"]
    assert all(l["werkzeug"] == "frage_nach" for l in res["aufrufe"])


def test_rueckfrage_unterdrueckt_andere_werkzeuge(monkeypatch):
    from app import server
    scene = make_testauto()
    calls = [{"name": "faerbe", "arguments": {"teil": "*", "rgb": [1, 2, 3], "modus": "ersetzen"}},
             {"name": "frage_nach", "arguments": {"frage": "Wirklich alles?", "typ": "ja_nein", "optionen": [],
                                                  "standard": None, "einheit": None, "mehrfach": False}}]
    vor = {n: model_io.color_of(m) for n, m in scene.geometry.items()}
    log, fragen = server.apply_calls(scene, calls, None, {})
    assert [l["werkzeug"] for l in log] == ["frage_nach"] and fragen[0]["typ"] == "ja_nein"
    assert {n: model_io.color_of(m) for n, m in scene.geometry.items()} == vor


def test_schutzgrenze_fuer_grosse_umbauten():
    from app import server
    scene = make_testauto()
    block = {"form": "box", "quelle": None, "profil": None, "drehung": [0, 0, 0], "rgb": None, "groesse": [0.1, 0.1, 0.1]}
    calls = [{"name": "baue", "arguments": {"bezug": None, "teile": [
        {**block, "name": "kiste", "positionen": [[i / 40, 0, 0] for i in range(server.MAX_NEUE_TEILE + 1)]}]}}]
    log, _ = server.apply_calls(scene, calls, None, {})
    assert "Zu großer Umbau" in log[0]["fehler"] and len(scene.geometry) == 13


def test_anfrage_log_auch_ohne_neue_version():
    from app import server
    server.LOG_FILE.unlink(missing_ok=True)
    edit_glb("Mach es irgendwie schöner", modellname="3D-Modell 1")
    edit_glb("mach das rot", ausgewaehlt="spoiler")
    zeilen = [json.loads(l) for l in server.LOG_FILE.read_text().splitlines()]
    assert [z["neue_version"] for z in zeilen[-2:]] == [False, True]
    assert zeilen[-2]["rueckfragen"][0]["frage"] and zeilen[-2]["modellname"] == "3D-Modell 1"
    assert zeilen[-1]["aufrufe"][0]["werkzeug"] == "faerbe" and "dauer_s" in zeilen[-1] and zeilen[-1]["glb_bytes"] > 0
    assert "OPENAI_API_KEY" not in server.LOG_FILE.read_text()
    assert c.get("/api/log?limit=1").json()[0]["auftrag"] == "mach das rot"


def test_ratenlimit(monkeypatch):
    from app import server
    monkeypatch.setattr(server, "RATE_PER_MIN", 2)
    server._hits.clear()
    sid = upload()["session"]
    for _ in range(2):
        assert c.post(f"/api/{sid}/edit", data={"auftrag": "mach das rot", "ausgewaehlt": "spoiler"}).status_code == 200
    r = c.post(f"/api/{sid}/edit", data={"auftrag": "mach das rot", "ausgewaehlt": "spoiler"})
    assert r.status_code == 429 and "Zu viele" in r.json()["fehler"]
    server._hits.clear()


def test_ungueltiger_kontext_wird_abgelehnt():
    sid = upload()["session"]
    r = c.post(f"/api/{sid}/edit", data={"auftrag": "x", "verlauf": "{kaputt"})
    assert r.status_code == 400


def test_konvertieren_obj_zu_glb():
    obj = make_testauto().export(file_type="obj")
    r = c.post("/api/convert", files={"datei": ("auto.obj", obj, "text/plain")})
    assert r.status_code == 200 and r.content.startswith(b"glTF")


def test_anfrage_enthaelt_ansichten_marken_pins_und_verlauf():
    parts = [{"name": "teil_01", "mitte": [0, 0, 0], "groesse": [1, 1, 1], "farbe_rgb": None,
              "textur": [([240, 240, 240], 0.6), ([112, 176, 208], 0.04)]}]
    kontext = {"marken": {"teil_01": 1}, "ansichten": ["data:image/png;base64,BBBB"],
               "masse": {"laenge": 4.87, "breite": 2.79, "hoehe": 2.32},
               "modelle": [{"name": "Stuhl", "laenge": 0.5, "breite": 0.5, "hoehe": 0.9}],
               "pins": [{"n": 3, "teil": "teil_01", "bild": [0.42, 0.31], "farbe": [112, 176, 208], "text": "remove this logo"}],
               "verlauf": [{"rolle": "agent", "text": "Welches?"}, {"rolle": "nutzer", "text": "Das Logo"}]}
    req = planner.build_request(parts, "x", None, None, None, kontext)
    text = req["input"][0]["content"][0]["text"]
    assert text.startswith("1 teil_01") and "Textur: f0f0f0 60%, 70b0d0 4%" in text
    assert "Pin 3 (Teil teil_01, Bildposition 0.420/0.310, Texturfarbe dort 70b0d0): remove this logo" in text
    assert '"Stuhl": 0.5 m × 0.5 m × 0.9 m' in text and "Nutzer: Das Logo" in text and "Länge 4.87 m" in text
    assert req["input"][0]["content"][1]["image_url"] == "data:image/png;base64,BBBB"


# ---------------------------------------------------------------- Texturen (Milk Truck, CC BY 4.0)
def truck():
    return model_io.load_model(str(TRUCK), split=True)


def body(scene):
    return next(n for n, m in scene.geometry.items() if model_io.texture_of(m) is not None and m.extents[2] > 4)


def logo_texel(mesh):
    arr = np.asarray(model_io.texture_of(mesh).convert("RGB")).astype(int)
    blau = (abs(arr - [112, 176, 208]).sum(-1) < 60)
    return int(blau.sum())


def test_weiss_faerben_aendert_den_lack_und_haelt_dunkle_details():
    """Regression: „Karosserie weiß“ tat nichts, weil Weiß als Tönung (×1) wirkungslos ist."""
    from app import tools
    sc = truck(); n = body(sc)
    vorher = np.asarray(model_io.texture_of(sc.geometry[n]).convert("RGB")).astype(int)
    tools.faerbe(sc, n, [255, 255, 255], "auto", False)
    nachher = np.asarray(model_io.texture_of(sc.geometry[n]).convert("RGB")).astype(int)
    assert logo_texel(sc.geometry[n]) > 0.9 * logo_texel(truck().geometry[n])  # Logo bleibt ohne logos_entfernen
    dunkel = vorher.sum(-1) < 150
    assert (abs(nachher - vorher).sum(-1)[dunkel] == 0).mean() > 0.9


def test_blau_faerben_aendert_grundfarbe_und_behaelt_textur():
    from app import tools
    sc = truck(); n = body(sc)
    tools.faerbe(sc, n, [30, 70, 220], "auto", False)
    m = sc.geometry[n]
    tex = np.asarray(model_io.texture_of(m).convert("RGB")).astype(int)
    blau = (abs(tex - [30, 70, 220]).sum(-1) < 40).mean()
    assert blau > 0.15 and model_io.texture_of(m) is not None


def test_weiss_mit_logos_entfernen_uebermalt_logo_flach():
    from app import tools
    sc = truck(); n = body(sc)
    assert logo_texel(sc.geometry[n]) > 1000
    tools.faerbe(sc, n, [255, 255, 255], "auto", True)
    assert logo_texel(sc.geometry[n]) < 0.05 * logo_texel(truck().geometry[n])


def test_mehrere_teile_kommagetrennt():
    from app import tools
    sc = make_testauto()
    namen = list(sc.geometry)[:2]
    assert tools.match(sc, ",".join(namen)) == namen


def test_logo_entfernen_aendert_nur_das_logo():
    from app import server
    sc = truck(); n = body(sc)
    pal = {bytes(c).hex() for c, _ in model_io.texture_palette(sc.geometry[n])}
    assert any(h.startswith(("6", "7")) for h in pal)  # Blau des Logos taucht in der Palette auf
    vorher = np.asarray(model_io.texture_of(sc.geometry[n]).convert("RGB")).astype(int)
    assert logo_texel(sc.geometry[n]) > 1000
    calls = [{"name": "faerbe_bereich", "arguments": {"teil": n, "quellfarben": [[112, 176, 208], [80, 144, 48]],
                                                      "toleranz": 60, "bild_bereich": None, "ziel_rgb": None}}]
    log, _ = server.apply_calls(sc, calls, None, {})
    assert "fehler" not in log[0], log
    m = sc.geometry[n]
    nachher = np.asarray(model_io.texture_of(m).convert("RGB")).astype(int)
    assert logo_texel(m) < 0.05 * logo_texel(truck().geometry[n])
    geaendert = (abs(nachher - vorher).sum(-1) > 0).mean()
    assert 0.005 < geaendert < 0.2  # nur ein kleiner Teil der Textur
    # Bereiche weit weg vom Logo (dunkle Teile) bleiben unverändert
    dunkel = vorher.sum(-1) < 150
    assert (abs(nachher - vorher).sum(-1)[dunkel] == 0).mean() > 0.97


def test_grundlack_umfaerben_laesst_logo_stehen():
    from app import server
    sc = truck(); n = body(sc)
    blau_vorher = logo_texel(sc.geometry[n])
    calls = [{"name": "faerbe_bereich", "arguments": {"teil": n, "quellfarben": [[240, 240, 240]], "toleranz": 40,
                                                      "bild_bereich": None, "ziel_rgb": [135, 206, 235]}}]
    log, _ = server.apply_calls(sc, calls, None, {})
    assert "fehler" not in log[0], log
    assert logo_texel(sc.geometry[n]) >= blau_vorher * 0.9


def test_pin_bekommt_texturfarbe():
    from app import server
    sc = truck(); n = body(sc)
    kontext = {"pins": [{"n": 1, "teil": n, "bild": [0.08, 0.81], "text": "remove this logo"}]}
    server.enrich(sc, kontext)
    assert kontext["masse"]["laenge"] > 4.8 and kontext["pins"][0]["farbe"] is not None
    # Umkreis des Pins am Logo enthält Logo-Blau, auch wenn der Pin genau auf eine Linie trifft
    kontext = {"pins": [{"n": 1, "teil": n, "bild": [0.6021, 0.7877], "text": "remove this logo"}]}
    server.enrich(sc, kontext)
    assert any(abs(c[2] - 208) < 40 and c[0] < 150 for c, _ in kontext["pins"][0]["umgebung"])


def test_benenne_vergibt_sprechende_gruppennamen():
    from app import tools
    sc = make_testauto()
    neu = tools.benenne(sc, [{"teil": "spoiler", "name": "Heckflügel", "gruppe": "anbau"},
                             {"teil": "kabine", "name": "glas_dach", "gruppe": "glas"}])
    assert neu == ["anbau_heckfluegel", "glas_dach"]
    assert "anbau_heckfluegel" in sc.geometry and "spoiler" not in sc.geometry
    assert tools.match(sc, "glas_*") == ["glas_dach"]


def test_klebe_logo_am_pin_wird_eigenes_teil(monkeypatch):
    """Logo aus dem Netz (hier gefälscht) wird ein eigenes Teil `logo_*` am Pin; die Textur des Teils bleibt gleich."""
    from app import logos, surfaces
    import trimesh

    box = trimesh.creation.box((2.0, 1.0, 1.0))
    model_io.set_color(box, [250, 210, 20])
    box, uv = surfaces._chart_uv(box)
    atlas = Image.new("RGB", (768, 512), (250, 210, 20))
    box.visual = trimesh.visual.TextureVisuals(uv=uv, material=trimesh.visual.material.PBRMaterial(
        baseColorTexture=atlas, baseColorFactor=[255, 255, 255, 255]))
    sc = trimesh.Scene(); sc.add_geometry(box, node_name="karosserie", geom_name="karosserie")
    vorher = np.asarray(model_io.texture_of(sc.geometry["karosserie"]))

    logo = Image.new("RGBA", (200, 100), (0, 0, 0, 0))
    logo.paste((220, 0, 40, 255), (20, 20, 180, 80))
    monkeypatch.setattr(logos, "fetch", lambda marke, domain=None, symbol_first=False: (logo, "https://example.org/logo.png"))
    kontext = {"pins": [{"n": 1, "text": "füg hier einen sticker vom red bull logo hinzu", "teil": "karosserie",
                         "bild": [0.5, 0.75]}]}
    calls = planner.mock_plan(model_io.parts_list(sc), "Setze die Kommentare an den Pins um.", None, kontext)
    assert calls[0]["name"] == "klebe_logo" and calls[0]["arguments"]["marke"] == "red bull"
    log, fragen = server.apply_calls(sc, calls, None, {}, kontext=kontext)
    assert not fragen and "fehler" not in log[0], log
    assert log[0]["argumente"]["logo_quelle"] == "https://example.org/logo.png"
    assert log[0]["ergebnis"] == ["logo_red_bull"] and "logo_red_bull" in sc.geometry
    # Textur des Trägers unverändert, Logo eigenes Teil vor der Fläche (+z-Seite), eigenständig skalierbar
    assert np.array_equal(np.asarray(model_io.texture_of(sc.geometry["karosserie"])), vorher)
    deco = sc.geometry["logo_red_bull"]
    assert deco.bounds[0][2] > 0.49 and abs(deco.centroid[0]) < 0.1
    assert deco.visual.material.alphaMode == "BLEND"
    # überlebt Speichern und Laden, bleibt eigenes Teil
    import tempfile
    path = str(Path(tempfile.mkdtemp()) / "m.glb")
    model_io.save_glb(sc, path)
    re = model_io.load_model(path)
    assert "logo_red_bull" in re.geometry and "karosserie" in re.geometry
    assert re.geometry["logo_red_bull"].visual.material.alphaMode == "BLEND"
    b0 = re.geometry["logo_red_bull"].extents[0]
    from app import tools
    tools.skaliere(re, "logo_*", 2, 2, 2)
    assert abs(re.geometry["logo_red_bull"].extents[0] - 2 * b0) < 1e-6
    tools.loesche(re, "logo_*")
    assert "logo_red_bull" not in re.geometry


def test_symbol_ohne_schriftzug():
    from app import logos
    img = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    img.paste((200, 30, 30, 255), (10, 10, 90, 90))      # Symbol 80×80
    img.paste((20, 20, 20, 255), (130, 35, 390, 65))     # Schriftzug 260×30
    out = logos.symbol_only(img)
    assert out.size == (80, 80)
    # nur ein Block → unverändert
    solo = Image.new("RGBA", (80, 80), (10, 10, 10, 255))
    assert logos.symbol_only(solo).size == (80, 80)


def test_strip_background_weiss_wird_transparent():
    from app import logos
    img = Image.new("RGB", (100, 60), (255, 255, 255))
    img.paste((0, 0, 200), (30, 20, 70, 40))
    out = logos.strip_background(img.convert("RGBA"))
    assert out.size == (40, 20) and out.getpixel((0, 0))[3] == 255
