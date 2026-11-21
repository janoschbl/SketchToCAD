/** Oberflächen-Segmentierung der Zieldaten (procad): Flächen anklicken, auswählen, färben, exportieren.
 *  Daten: public/segdemo/objects.json (erzeugt von lab/segment_surfaces.py). */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

type M64 = { v: string; f: string; s: string; n: number };
type Surf = { id: number; name: string; part: string; cls: string; kind: string; area: number; normal: number[] };
type Obj = { seed: number; shape: string; name: string; surfaces: Surf[]; exact: M64; vox64: M64 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

// Farben je Klasse/Art (Art schlägt Klasse)
const KIND_COL: Record<string, number> = { dachflaeche: 0xb5483b, giebel: 0xd9a07a, glas: 0x6fa8dc, tuerblatt: 0x8b5a2b, laibung: 0xbdbdbd, mantel: 0x9fb8c8 };
const CLS_COL: Record<string, number> = { wand: 0xf0e7d3, dach: 0xa8574a, schornstein: 0x6b4f45, fenster: 0x6fa8dc, tuer: 0x8b5a2b, platte: 0xc49a6c, bein: 0x8b6b4a, koerper: 0xcfd8dc, merkmal: 0x90a4ae };
const classColor = (s: Surf) => (s.kind === 'unten' && s.cls === 'wand' ? 0x8a8a8a : KIND_COL[s.kind] ?? CLS_COL[s.cls] ?? 0xcccccc);
const uniqueColor = (i: number) => new THREE.Color().setHSL(((i * 137.508) % 360) / 360, 0.55, 0.62).getHex();

// Gruppen für Schnellauswahl
const GROUPS: [string, (s: Surf) => boolean][] = [
  ['Dachflächen', (s) => s.kind === 'dachflaeche'], ['Giebel', (s) => s.kind === 'giebel'], ['Wände', (s) => s.cls === 'wand' && s.kind === 'seite'],
  ['Boden', (s) => s.kind === 'unten' && s.cls === 'wand'], ['Dachüberstand', (s) => s.kind === 'unten' && s.cls === 'dach'], ['Glas', (s) => s.kind === 'glas'], ['Fenster', (s) => s.cls === 'fenster'], ['Türen', (s) => s.cls === 'tuer'], ['Schornstein', (s) => s.cls === 'schornstein'],
  ['Mäntel', (s) => s.kind === 'mantel'], ['Oberseiten', (s) => s.kind === 'oben'],
];

// ---------- Szene ----------
const canvas = $<HTMLCanvasElement>('v3');
const r = new THREE.WebGLRenderer({ canvas, antialias: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, -4, 6); scene.add(sun);
const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 100); cam.up.set(0, 0, 1); cam.position.set(4.2, -4.6, 3.2);
const ctl = new OrbitControls(cam, canvas); ctl.enableDamping = true;
const root = new THREE.Group(); scene.add(root);
const resize = () => { const e = canvas.parentElement!; r.setSize(e.clientWidth, e.clientHeight, false); cam.aspect = e.clientWidth / e.clientHeight; cam.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(canvas.parentElement!); resize();
(function loop() { ctl.update(); r.render(scene, cam); requestAnimationFrame(loop); })();

// ---------- Zustand ----------
let objs: Obj[] = [], cur = 0, grid: 'exact' | 'vox64' = 'exact', paint: 'surface' | 'class' | 'gray' = 'surface', multi = false;
let meshes: THREE.Mesh[] = [], outlines: THREE.LineSegments[] = [];
const custom = new Map<string, number>(); // `${seed}:${sid}` -> Farbe (vom Nutzer)
const hidden = new Set<number>(); const sel = new Set<number>(); let hover = -1;
const key = (sid: number) => `${objs[cur].seed}:${sid}`;
const S = () => objs[cur].surfaces;

function baseColor(s: Surf) {
  const c = custom.get(key(s.id)); if (c !== undefined) return c;
  return paint === 'surface' ? uniqueColor(s.id) : paint === 'class' ? classColor(s) : 0xd8d8d8;
}

function build() {
  root.clear(); meshes.forEach((m) => m.geometry.dispose()); outlines.forEach((o) => o.geometry.dispose()); meshes = []; outlines = [];
  sel.clear(); hidden.clear(); hover = -1;
  const o = objs[cur], m = o[grid];
  const V = new Float32Array(b64(m.v)), F = new Uint32Array(b64(m.f)), L = new Uint16Array(b64(m.s));
  const per: number[][] = S().map(() => []);
  for (let t = 0; t < m.n; t++) per[L[t]]?.push(t);
  S().forEach((s, i) => {
    const map = new Map<number, number>(), pos: number[] = [], idx: number[] = [];
    for (const t of per[i]) for (let k = 0; k < 3; k++) { const v = F[3 * t + k]; let j = map.get(v); if (j === undefined) { j = map.size; map.set(v, j); pos.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]); } idx.push(j); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    mesh.userData.sid = s.id; mesh.name = s.name; root.add(mesh); meshes.push(mesh);
    const ol = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: grid === 'exact' ? 0.55 : 0 }));
    ol.userData.sid = s.id; root.add(ol); outlines.push(ol);
  });
  $('segstat').textContent = `${o.name} · ${S().length} Flächen · ${m.n.toLocaleString('de')} Dreiecke (${grid === 'exact' ? 'exaktes Ziel-Mesh' : '64³-Gitter wie Modellausgabe, Labels vom nächsten Ziel-Flächenpunkt'})`;
  list(); refresh();
}

function refresh() {
  meshes.forEach((m, i) => {
    const s = S()[i], mat = m.material as THREE.MeshStandardMaterial, on = sel.has(s.id);
    mat.color.setHex(baseColor(s));
    mat.emissive.setHex(on ? 0x553300 : i === hover ? 0x222222 : 0);
    m.visible = !hidden.has(s.id); outlines[i].visible = m.visible;
    const om = outlines[i].material as THREE.LineBasicMaterial; om.color.setHex(on ? 0xff7a00 : 0x222222); om.opacity = on ? 1 : grid === 'exact' ? 0.55 : 0; om.linewidth = 1;
  });
  document.querySelectorAll<HTMLElement>('#seglist .it').forEach((el) => {
    const id = +el.dataset.sid!; el.classList.toggle('on', sel.has(id)); el.classList.toggle('off', hidden.has(id));
    (el.querySelector('input') as HTMLInputElement).value = '#' + baseColor(S()[id]).toString(16).padStart(6, '0');
  });
  const n = sel.size; $('selinfo').textContent = n ? `${n} ausgewählt: ${[...sel].slice(0, 4).map((i) => S()[i].name).join(', ')}${n > 4 ? ' …' : ''}` : 'Nichts ausgewählt – Fläche anklicken';
  if (n) $<HTMLInputElement>('selcol').value = '#' + baseColor(S()[[...sel][0]]).toString(16).padStart(6, '0');
}

function list() {
  const host = $('seglist'); host.innerHTML = '';
  let lastPart = '';
  for (const s of S()) {
    if (s.part !== lastPart) { const h = document.createElement('div'); h.className = 'ph'; h.textContent = s.part; host.appendChild(h); lastPart = s.part; }
    const el = document.createElement('div'); el.className = 'it'; el.dataset.sid = String(s.id);
    const c = document.createElement('input'); c.type = 'color';
    c.oninput = () => { custom.set(key(s.id), parseInt(c.value.slice(1), 16)); refresh(); }; c.onclick = (e) => e.stopPropagation();
    const t = document.createElement('span'); t.textContent = s.name.replace(s.part + ' – ', '');
    const a = document.createElement('small'); a.textContent = s.area.toFixed(3);
    el.append(c, t, a); el.onclick = (e) => pick(s.id, e.shiftKey || e.metaKey || e.ctrlKey); host.appendChild(el);
  }
  const g = $('seggroups'); g.innerHTML = '';
  for (const [label, f] of GROUPS) {
    const ids = S().filter(f).map((s) => s.id); if (!ids.length) continue;
    const b = document.createElement('button'); b.textContent = `${label} (${ids.length})`;
    b.onclick = () => { if (!multi) sel.clear(); ids.forEach((i) => sel.add(i)); refresh(); }; g.appendChild(b);
  }
}

function pick(sid: number, add: boolean) {
  if (add || multi) { sel.has(sid) ? sel.delete(sid) : sel.add(sid); } else { const only = sel.size === 1 && sel.has(sid); sel.clear(); if (!only) sel.add(sid); }
  refresh();
}

// ---------- Klick/Hover per Raycaster ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const hit = (e: PointerEvent) => {
  const b = canvas.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
  ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(meshes.filter((m) => m.visible), false)[0]; return h ? (h.object.userData.sid as number) : -1;
};
let down: [number, number] | null = null;
canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; down = null; // Drehen ≠ Klicken
  const sid = hit(e); if (sid < 0) { if (!multi) { sel.clear(); refresh(); } return; }
  pick(sid, e.shiftKey || e.metaKey || e.ctrlKey);
  document.querySelector(`#seglist .it[data-sid="${sid}"]`)?.scrollIntoView({ block: 'nearest' });
});
canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType !== 'mouse') return; const h = hit(e); if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? 'pointer' : ''; refresh(); } });

// ---------- Bedienelemente ----------
function seg(host: string, opts: [string, string][], get: () => string, set: (v: string) => void) {
  const el = $(host); const draw = () => { el.innerHTML = ''; for (const [v, l] of opts) { const b = document.createElement('button'); b.textContent = l; b.className = get() === v ? 'on' : ''; b.onclick = () => { set(v); draw(); }; el.appendChild(b); } }; draw();
}
seg('seggrid', [['exact', 'Exakt'], ['vox64', '64³ wie Modell']], () => grid, (v) => { grid = v as typeof grid; build(); });
seg('segpaint', [['surface', 'Je Fläche'], ['class', 'Je Klasse'], ['gray', 'Grau']], () => paint, (v) => { paint = v as typeof paint; refresh(); });
$('segmulti').onclick = () => { multi = !multi; $('segmulti').classList.toggle('on', multi); };
$('selcol').oninput = () => { const c = parseInt($<HTMLInputElement>('selcol').value.slice(1), 16); sel.forEach((i) => custom.set(key(i), c)); refresh(); };
$('selnone').onclick = () => { sel.clear(); refresh(); };
$('selhide').onclick = () => { sel.forEach((i) => hidden.add(i)); sel.clear(); refresh(); };
$('selonly').onclick = () => { if (!sel.size) return; S().forEach((s) => (sel.has(s.id) ? hidden.delete(s.id) : hidden.add(s.id))); refresh(); };
$('showall').onclick = () => { hidden.clear(); refresh(); };
$('resetcol').onclick = () => { S().forEach((s) => custom.delete(key(s.id))); refresh(); };
$('segexp').onclick = async () => {
  const ids = sel.size ? [...sel] : S().map((s) => s.id).filter((i) => !hidden.has(i));
  const g = new THREE.Group(); g.name = objs[cur].name;
  for (const i of ids) { const m = meshes[i].clone(); m.material = new THREE.MeshStandardMaterial({ color: baseColor(S()[i]), roughness: 0.8, side: THREE.DoubleSide }); m.name = S()[i].name; m.userData = { surface: S()[i] }; g.add(m); }
  g.rotation.x = -Math.PI / 2; // Z oben -> glTF Y oben
  const buf = (await new GLTFExporter().parseAsync(g, { binary: true })) as ArrayBuffer;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  a.download = `${objs[cur].shape}_${objs[cur].seed}${sel.size ? '_auswahl' : ''}.glb`; a.click(); URL.revokeObjectURL(a.href);
};
const objSel = $<HTMLSelectElement>('segobj');
objSel.onchange = () => { cur = +objSel.value; build(); };
$('segprev').onclick = () => { cur = (cur + objs.length - 1) % objs.length; objSel.value = String(cur); build(); };
$('segnext').onclick = () => { cur = (cur + 1) % objs.length; objSel.value = String(cur); build(); };

fetch('/segdemo/objects.json').then((x) => x.json()).then((d: { objects: Obj[] }) => {
  objs = d.objects; objSel.innerHTML = objs.map((o, i) => `<option value="${i}">${o.name} (${o.surfaces.length} Flächen)</option>`).join(''); build();
}).catch((e) => ($('segstat').textContent = 'Fehler beim Laden: ' + e.message));
