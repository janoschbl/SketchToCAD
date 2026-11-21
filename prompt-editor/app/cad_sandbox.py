"""KI-geschriebenen CadQuery-Code abgeschottet ausführen.

Schutzschichten:
1. Statische Prüfung (AST): nur 'cadquery' und 'math' importierbar, keine gefährlichen Namen
   (open, exec, eval, __import__, os, sys, subprocess …).
2. Ausführung in einem eigenen Python-Prozess mit Zeitlimit und leerer Umgebung.
Für den Produktivbetrieb zusätzlich: eigener Container ohne Netzwerk und mit Speicherlimit.
"""
from __future__ import annotations

import ast
import subprocess
import sys
import tempfile
from pathlib import Path

import trimesh

ERLAUBTE_IMPORTS = {"cadquery", "math"}
VERBOTEN = {"open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "getattr", "setattr",
            "delattr", "input", "breakpoint", "os", "sys", "subprocess", "shutil", "socket", "pathlib", "importlib"}

RUNNER = r"""
import sys, cadquery as cq
code = open(sys.argv[1], encoding="utf-8").read()
ns = {"__name__": "ki_teil"}
exec(compile(code, "<ki-code>", "exec"), ns)
r = ns.get("result")
if r is None:
    raise SystemExit("Der Code legt kein 'result' an.")
cq.exporters.export(r, sys.argv[2], tolerance=0.2, angularTolerance=0.2)
"""


class CadError(Exception):
    pass


def pruefe(code: str):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise CadError(f"Syntaxfehler im KI-Code: {e}")
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ERLAUBTE_IMPORTS:
                    raise CadError(f"Import nicht erlaubt: {a.name}")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ERLAUBTE_IMPORTS:
                raise CadError(f"Import nicht erlaubt: {node.module}")
        elif isinstance(node, ast.Name) and node.id in VERBOTEN:
            raise CadError(f"Name nicht erlaubt: {node.id}")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise CadError(f"Zugriff nicht erlaubt: {node.attr}")


def code_zu_mesh(code: str, timeout_s: int = 90) -> trimesh.Trimesh:
    pruefe(code)
    with tempfile.TemporaryDirectory() as d:
        src, out, runner = Path(d) / "teil.py", Path(d) / "teil.stl", Path(d) / "run.py"
        src.write_text(code, encoding="utf-8")
        runner.write_text(RUNNER, encoding="utf-8")
        try:
            r = subprocess.run([sys.executable, "-I", str(runner), str(src), str(out)], cwd=d,
                               capture_output=True, text=True, timeout=timeout_s, env={"PATH": "/usr/bin:/bin"})
        except subprocess.TimeoutExpired:
            raise CadError(f"KI-Code hat das Zeitlimit von {timeout_s} s überschritten.")
        if r.returncode != 0 or not out.exists():
            raise CadError("KI-Code ist fehlgeschlagen: " + (r.stderr.strip().splitlines() or ["unbekannt"])[-1])
        mesh = trimesh.load(out, force="mesh")
    mesh.apply_scale(0.001)  # mm → m
    return mesh
