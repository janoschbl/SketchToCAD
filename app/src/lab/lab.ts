/** SketchLab: zeichnen → eigenes Modell (live, GPU-Server per Proxy /lab-api) und MeshPad zum Vergleich. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateMesh } from '../lib/magic';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Mesh64 = { v: string; f: string; n: number };

// ---------- 3D-Viewer ----------
class Viewer {
  scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100); r: THREE.WebGLRenderer; ctl: OrbitControls;
  mesh?: THREE.Mesh; ghost?: THREE.LineSegments; ghostOn = false;
  constructor(canvas: HTMLCanvasElement, private zUp: boolean) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true }); this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xffffff);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.4); d.position.set(3, -4, 5); this.scene.add(d);
    if (zUp) this.cam.up.set(0, 0, 1);
    this.ctl = new OrbitControls(this.cam, canvas); this.ctl.enableDamping = true;
    this.setView(35, 25); new ResizeObserver(() => this.resize()).observe(canvas.parentElement!); this.resize();
    const loop = () => { this.ctl.update(); this.r.render(this.scene, this.cam); requestAnimationFrame(loop); }; loop();
  }
  resize() { const e = this.r.domElement.parentElement!; this.r.setSize(e.clientWidth, e.clientHeight, false); this.cam.aspect = e.clientWidth / e.clientHeight; this.cam.updateProjectionMatrix(); }
  /** Kamera wie beim Trainingsdatensatz: Azimut 0 = +X, Elevation über der Bodenebene, Z oben. */
  setView(azDeg: number, elDeg: number, dist = 6.5) {
    const a = THREE.MathUtils.degToRad(azDeg), e = THREE.MathUtils.degToRad(elDeg);
    if (this.zUp) this.cam.position.set(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)).multiplyScalar(dist);
    else this.cam.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist);
    this.ctl.target.set(0, 0, 0); this.cam.lookAt(0, 0, 0); this.ctl.update();
  }
  private geo(pos: Float32Array, idx: Uint32Array) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g;
  }
  set(pos: Float32Array, idx: Uint32Array, fit = false) {
    if (this.mesh) { this.mesh.geometry.dispose(); this.scene.remove(this.mesh); this.mesh = undefined; }
    if (!idx.length) return;
    this.mesh = new THREE.Mesh(this.geo(pos, idx), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.85, side: THREE.DoubleSide }));
    this.scene.add(this.mesh);
    if (fit) { const b = new THREE.Box3().setFromObject(this.mesh), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
      this.mesh.position.sub(c); this.mesh.scale.setScalar(3 / s); }
  }
  setGhost(pos?: Float32Array, idx?: Uint32Array) {
    if (this.ghost) { this.ghost.geometry.dispose(); this.scene.remove(this.ghost); this.ghost = undefined; }
    if (!pos || !idx?.length) return;
    this.ghost = new THREE.LineSegments(new THREE.WireframeGeometry(this.geo(pos, idx)), new THREE.LineBasicMaterial({ color: 0x7aa7ff, transparent: true, opacity: 0.35 }));
    this.ghost.visible = this.ghostOn; this.scene.add(this.ghost);
  }
  showGhost(on: boolean) { this.ghostOn = on; if (this.ghost) this.ghost.visible = on; }
}
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
const decode = (m: Mesh64) => ({ pos: new Float32Array(m.n ? b64(m.v) : new ArrayBuffer(0)), idx: m.n ? new Uint32Array(b64(m.f)) : new Uint32Array(0) });

const v1 = new Viewer($('v1'), true), v2 = new Viewer($('v2'), false);

// ---------- Ansicht ----------
let az = 60, el = 35;
const AZ = [0, 60, 120, 180, 240, 300], EL = [15, 35];
function chips(host: HTMLElement, vals: number[], get: () => number, set: (v: number) => void) {
  const draw = () => { host.innerHTML = ''; vals.forEach((v) => { const b = document.createElement('button'); b.textContent = v + '°'; b.className = v === get() ? 'on' : ''; b.onclick = () => { set(v); draw(); v1.setView(az, el); schedule(true); }; host.appendChild(b); }); };
  draw(); return draw;
}
const redrawAz = chips($('az'), AZ, () => az, (v) => (az = v)); const redrawEl = chips($('el'), EL, () => el, (v) => (el = v));

// ---------- Zeichnen ----------
const cv = $<HTMLCanvasElement>('draw'), cx = cv.getContext('2d')!;
let strokes: [number, number][][] = [], cur: [number, number][] | null = null, bg: HTMLImageElement | null = null;
function repaint() {
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 512, 512); if (bg) cx.drawImage(bg, 0, 0, 512, 512);
  cx.strokeStyle = '#000'; cx.lineWidth = 3.2; cx.lineCap = cx.lineJoin = 'round';
  for (const s of cur ? [...strokes, cur] : strokes) { cx.beginPath(); s.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y))); if (s.length === 1) cx.lineTo(s[0][0] + 0.01, s[0][1]); cx.stroke(); }
}
const pt = (e: PointerEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 512, ((e.clientY - r.top) / r.height) * 512]; };
cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; repaint(); });
cv.addEventListener('pointermove', (e) => { if (!cur) return; for (const ev of e.getCoalescedEvents?.() ?? [e]) cur.push(pt(ev)); repaint(); schedule(false); });
const end = () => { if (!cur) return; strokes.push(cur); cur = null; repaint(); schedule(true); };
cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
$('undo').onclick = () => { strokes.pop(); repaint(); schedule(true); };
$('clear').onclick = () => { strokes = []; bg = null; repaint(); v1.set(new Float32Array(0), new Uint32Array(0)); v1.setGhost(); $('stat1').textContent = ''; $('sketchstat').textContent = ''; };
repaint();

function exportPng(): Promise<Blob> {
  const o = document.createElement('canvas'); o.width = o.height = 256; const c = o.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 256); c.drawImage(cv, 0, 0, 256, 256);
  return new Promise((res) => o.toBlob((b) => res(b!), 'image/png'));
}

// ---------- Live-Vorhersage ----------
let timer = 0, last = 0, seq = 0, ctrl: AbortController | null = null;
function schedule(now: boolean) { clearTimeout(timer); const wait = now ? 0 : Math.max(0, 180 - (performance.now() - last)); timer = window.setTimeout(predict, wait); }
async function predict() {
  if (!strokes.length && !bg) return; last = performance.now(); ctrl?.abort(); ctrl = new AbortController(); const my = ++seq;
  try {
    const fd = new FormData(); fd.append('image', await exportPng(), 'sketch.png'); fd.append('az', String(az)); fd.append('el', String(el));
    const t0 = performance.now(); const r = await fetch('/lab-api/predict', { method: 'POST', body: fd, signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status === 502 ? 'Lab-Server auf dem Heim-PC nicht erreichbar' : 'Fehler ' + r.status);
    const j = await r.json(); if (my !== seq) return; const m = decode(j.mesh); v1.set(m.pos, m.idx); v1.setGhost();
    $('stat1').className = 'stat'; $('stat1').textContent = `Modell ${j.ms_model.toFixed(0)} ms · Server ${j.ms_total.toFixed(0)} ms · gesamt ${(performance.now() - t0).toFixed(0)} ms · ${j.mesh.n.toLocaleString('de')} Dreiecke`;
  } catch (e) { if ((e as Error).name !== 'AbortError') { $('stat1').className = 'stat err'; $('stat1').textContent = (e as Error).message; } }
}

// ---------- Testskizze aus dem Datensatz ----------
$('sample').onclick = async () => {
  $('stat1').textContent = 'lade…';
  try {
    const j = await (await fetch('/lab-api/sample?seed=' + Math.floor(Math.random() * 1e6))).json();
    az = j.az; el = j.el; redrawAz(); redrawEl(); strokes = []; ctrl?.abort(); seq++;
    bg = new Image(); await new Promise((res) => { bg!.onload = res; bg!.src = j.sketch; }); repaint(); v1.setView(az, el);
    const m = decode(j.mesh), g = decode(j.gt); v1.set(m.pos, m.idx); v1.setGhost(g.pos, g.idx);
    $('sketchstat').textContent = `Testskizze: ${j.name} (${j.category}) · Ansicht ${j.az}°/${j.el}°`;
    $('stat1').className = 'stat'; $('stat1').textContent = `IoU zum Original: ${j.iou.toFixed(2)} · Modell ${j.ms_model.toFixed(0)} ms · blau = Originalform (Knopf „Original zeigen")`;
  } catch (e) { $('stat1').className = 'stat err'; $('stat1').textContent = 'Fehler: ' + (e as Error).message; }
};
let ghost = false; $('gt').onclick = () => { ghost = !ghost; v1.showGhost(ghost); $('gt').classList.toggle('on', ghost); };
$('reset1').onclick = () => v1.setView(az, el);

// ---------- MeshPad (auf Knopfdruck) ----------
$('mp').onclick = async () => {
  if (!strokes.length && !bg) return; const b = $('mp') as HTMLButtonElement; b.disabled = true; const t0 = performance.now();
  $('stat2').className = 'stat'; $('stat2').textContent = 'MeshPad rechnet…';
  try {
    const m = await generateMesh(await exportPng(), 2, (i) => ($('stat2').textContent = `MeshPad rechnet… Variante ${i + 1}/2`));
    v2.set(new Float32Array(m.V), new Uint32Array(m.F), true); v2.setView(40, 25);
    $('stat2').textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s für 2 Varianten · ${m.faces.toLocaleString('de')} Dreiecke · ${m.boundary} offene Kanten (beste Variante)`;
  } catch (e) { $('stat2').className = 'stat err'; $('stat2').textContent = (e as Error).message; } finally { b.disabled = false; }
};
