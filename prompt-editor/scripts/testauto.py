"""Exportiert das Testauto als auto.glb."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.demo import make_testauto

make_testauto().export("auto.glb")
print("auto.glb erstellt – im Browser in den Viewer ziehen.")
