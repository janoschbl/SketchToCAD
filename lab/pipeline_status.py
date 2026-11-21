"""Brücke Laptop -> Dashboard (Heim-PC): Phasen-Fortschritt + ETA + frisch erzeugte Skizzen.

Liest alle 10 s die Logs der Datenerzeugung auf dem Laptop und den neuesten Trainingslauf auf dem
Heim-PC (runs/*/status.json außer base) und schreibt ~/dev/sketchlab/web/pipeline.json sowie
web/gen.png (Kontaktbogen der zuletzt erzeugten Skizzen).

  systemd-run --user --unit sketchlab-bridge lab/.venv/bin/python lab/pipeline_status.py
"""
import glob, io, json, os, re, subprocess, time
from PIL import Image

LAB = os.path.dirname(os.path.abspath(__file__))
SSH = ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", "-i", os.path.expanduser("~/.ssh/meshpad_ed25519"), "janosch@100.86.99.105"]
WEB = "dev/sketchlab/web"
PROCAD_TOTAL = 60000


def tail(path, n=4000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - n))
            return f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return []


def procad_phase():
    lines = tail(f"{LAB}/out/procad_v1.log")
    ph = dict(name="Skizzen erzeugen (procad, 60k)", state="wait", progress=0, eta_s=None, weight=1)
    for l in reversed(lines):
        if l.startswith("fertig"):
            return dict(ph, state="done", progress=1, eta_s=0)
        m = re.match(r"(\d+) Skizzen, \d+ Fehler, ([\d.]+)/s", l)
        if m:
            n, r = int(m[1]), float(m[2])
            return dict(ph, state="run", progress=n / PROCAD_TOTAL, eta_s=(PROCAD_TOTAL - n) / max(r, 1e-6), detail=f"{n} Skizzen · {r:.0f}/s")
    return ph


def real_phase():
    lines = tail(f"{LAB}/data_real.log")
    ph = dict(name="Echtdaten: CAD2Sketch + DifferSketching", state="wait", progress=0, eta_s=None, weight=1)
    for l in reversed(lines):
        if l.startswith("fertig"):
            return dict(ph, state="done", progress=1, eta_s=0, detail=l)
        m = re.match(r"(\d+)/(\d+) Jobs, (\d+) Ansichten, (\d+) Skizzen, (\d+)s", l)
        if m:
            a, b, v, s, t = map(int, m.groups())
            return dict(ph, state="run", progress=a / b, eta_s=t / max(a, 1) * (b - a), detail=f"{a}/{b} Objekte · {v} Ansichten · {s} Skizzen")
    return ph


def train_phase():
    ph = dict(name="Training (RTX 2070)", state="wait", progress=0, eta_s=None, weight=3)
    try:
        out = subprocess.run(SSH + ["cd ~/dev/sketchlab/runs && f=$(ls -t */status.json 2>/dev/null | grep -v '^base/' | head -1); [ -n \"$f\" ] && echo $f && cat $f"],
                             capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return ph
    if not out.strip():
        return ph
    name, js = out.split("\n", 1)
    try:
        j = json.loads(js)
    except Exception:
        return ph
    run = name.split("/")[0]
    subprocess.run(SSH + [f"cd {WEB} && [ \"$(readlink status.json)\" = ../runs/{run}/status.json ] || "
                          f"(mkdir -p ../runs/{run}/preview && ln -sfn ../runs/{run}/status.json status.json && ln -sfn ../runs/{run}/preview preview)"],
                   timeout=15, check=False)
    p = j["step"] / j["total"] if j.get("total") else 0
    st = "done" if j.get("state") == "done" else "run"
    return dict(ph, state=st, progress=1 if st == "done" else p, eta_s=0 if st == "done" else j.get("eta_s"),
                detail=f"{name.split('/')[0]} · Epoche {j.get('epoch')}/{j.get('epochs')}", run=name.split("/")[0])


def newest_sketches(n=24):
    dirs = sorted(d for d in glob.glob(f"{LAB}/out/procad_v1/[0-9]*") if os.path.isdir(d))
    fs = []
    for d in dirs[-2:]:
        fs += glob.glob(f"{d}/*_?.png")
    fs = sorted(fs, key=os.path.getmtime)[-n:]
    if not fs:
        return None
    t, cols = 96, 12
    sheet = Image.new("RGB", (cols * t, ((len(fs) + cols - 1) // cols) * t), "white")
    for i, f in enumerate(fs):
        try:
            sheet.paste(Image.open(f).convert("RGB").resize((t, t), Image.LANCZOS), ((i % cols) * t, (i // cols) * t))
        except Exception:
            pass
    b = io.BytesIO(); sheet.save(b, "PNG"); return b.getvalue()


def push(name, data):
    subprocess.run(SSH + [f"cat > {WEB}/.{name}.tmp && mv {WEB}/.{name}.tmp {WEB}/{name}"], input=data, timeout=20, check=False)


def main():
    k = 0
    while True:
        phases = [procad_phase(), real_phase(), train_phase()]
        tr = phases[-1]
        push("pipeline.json", json.dumps(dict(name="Modell v2 (procad + CAD2Sketch + DifferSketching)", updated=time.time(),
                                             phases=phases, train_run=tr.get("run"))).encode())
        if k % 3 == 0 and phases[0]["state"] != "done" or k == 0:
            img = newest_sketches()
            if img:
                push("gen.png", img)
        k += 1
        time.sleep(10)


if __name__ == "__main__":
    main()
