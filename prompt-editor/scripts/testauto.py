"""Erzeugt das Testauto (13 benannte Teile) als auto.glb zum Ausprobieren der App.
Start: python scripts/testauto.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import os
os.environ.setdefault("LLM_MODE", "mock")
from tests.test_app import make_testauto_glb
Path("auto.glb").write_bytes(make_testauto_glb())
print("auto.glb erstellt – im Browser in den Viewer ziehen.")
