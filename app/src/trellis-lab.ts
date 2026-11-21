// Testseite Skizze → Bild → 3D, erweiterbar. Backend: lab/trellis_lab/server_local.py (Heim-PC, Vite-Proxy /trellis-api).
// Erweitern: Nach dem ersten 3D-Modell ist der Lauf ein Projekt aus Teilen. Neue Striche (Version > Projektversion)
// werden live einem Teil zugeordnet (/plan) und beim Anwenden (/edit) entsteht nur dieses eine Teil neu.
// three.js wird erst bei Bedarf geladen, damit die Zeichenfläche auch ohne WebGL/three funktioniert.
type Three = typeof import('three');

const API = '/trellis-api';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PART_COLORS = ['#ff7a00', '#1f5fe0', '#2ea043', '#8a3ab9', '#e02020', '#0aa5a5', '#c0a000', '#f078b4'];

type Cls = { name: string; label: string; count: number; group: string };
type Part = { id: string; name: string; kind: string; parent: string | null; version: number; url: string; mask_url: string; state: string; intact: boolean; sha: string };
type Project = { id: string; version: number; subject: string; image: string; parts: Part[]; history: any[]; sketch: string | null };
let classes: Cls[] = [];
let selected: Cls | null = null;
let runId = '';
let pick = 0;
let last3dKey = '';
let project: Project | null = null;

// ---------- Klassenliste ----------
function renderClasses() {
  const q = $<HTMLInputElement>('q').value.trim().toLowerCase();
  const list = $('classlist');
  list.innerHTML = '';
  for (const g of ['LVIS', 'Fabelwesen']) {
    const items = classes.filter((c) => c.group === g && (!q || c.label.toLowerCase().includes(q)));
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'ph';
    h.textContent = g === 'LVIS' ? `LVIS-Klassen (${items.length}) · Anzahl Objekte` : `Fabelwesen (Stichwort in Name/Tags)`;
    list.append(h);
    for (const c of items) {
      const el = document.createElement('div');
      el.className = 'it' + (selected?.name === c.name ? ' on' : '');
      el.innerHTML = `<span></span><small>${c.count.toLocaleString('de-DE')}</small>`;
      el.querySelector('span')!.textContent = c.label;
      el.onclick = () => {
        selected = c;
        $<HTMLInputElement>('subject').value = c.label;
        renderClasses();
      };
      list.append(el);
    }
  }
}

// ---------- Zeichenfläche ----------
const cv = $<HTMLCanvasElement>('draw');
const ctx = cv.getContext('2d')!;
// v = Projektversion, in der der Strich zum Modell kam (0 = Grundskizze); part = Teil, das er erzeugt hat
type Stroke = { w: number; c: string; pts: [number, number][]; v?: number; part?: string };
let strokes: Stroke[] = [];
let cur: Stroke | null = null;
const COLORS = ['#000000', '#7a4a1e', '#e02020', '#f08c14', '#f0d828', '#2ea043', '#1f5fe0', '#6ec0f0', '#8a3ab9', '#f078b4', '#8c8c8c'];
let color = COLORS[0];
const brush = $<HTMLInputElement>('brush');
const showBrush = () => ($('brushv').textContent = `${brush.value} px`);
brush.oninput = showBrush;
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'sw' + (c === color ? ' on' : '');
  b.style.background = c;
  b.title = c;
  b.onclick = () => {
    color = c;
    document.querySelectorAll('#palette .sw').forEach((x) => x.classList.toggle('on', x === b));
    if (c !== '#000000' && +brush.value < 14) brush.value = '18';
    if (c === '#000000' && +brush.value > 10) brush.value = '6';
    showBrush();
  };
  $('palette').append(b);
}

const isNew = (s: Stroke) => !!project && (s.v ?? 0) > project.version;
const newStrokes = () => strokes.filter(isNew);
let underlay: HTMLImageElement | null = null;
let overlay: HTMLCanvasElement | null = null; // eingefärbte Teil-Maske, einmal berechnet
let segOverlay: HTMLCanvasElement | null = null; // alle Segmente farbig
const imgCache = new Map<string, HTMLImageElement>();
function loadImg(url: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(url);
  if (hit?.complete) return Promise.resolve(hit);
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
    imgCache.set(url, im);
  });
}

function drawStrokes(c: CanvasRenderingContext2D, list: Stroke[], glow = false) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const s of list) {
    c.save();
    if (glow) { c.shadowColor = '#ff7a00'; c.shadowBlur = 10; }
    c.strokeStyle = s.c;
    c.lineWidth = s.w;
    c.beginPath();
    s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (s.pts.length === 1) c.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    c.stroke();
    c.restore();
  }
}
// eingefärbte Teil-Maske (weiß = Teil) als Overlay
function tinted(img: HTMLImageElement, col: string) {
  const o = document.createElement('canvas');
  o.width = cv.width; o.height = cv.height;
  const c = o.getContext('2d')!;
  c.drawImage(img, 0, 0, o.width, o.height);
  const d = c.getImageData(0, 0, o.width, o.height);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
  for (let i = 0; i < d.data.length; i += 4) {
    const on = d.data[i] > 127;
    d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = on ? 70 : 0;
  }
  c.putImageData(d, 0, 0);
  return o;
}
function redraw() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (project && underlay && $<HTMLInputElement>('underlay').checked) {
    // Im Projekt ist das Bild die Grundlage (Teile, Masken, Bearbeitung beziehen sich darauf), nicht die alte Skizze,
    // die die KI evtl. frei interpretiert hat → Bild kräftig, alte Striche blass.
    ctx.globalAlpha = 0.75;
    ctx.drawImage(underlay, 0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
  }
  if (segOverlay && $<HTMLInputElement>('showsegs').checked) ctx.drawImage(segOverlay, 0, 0);
  if (overlay) ctx.drawImage(overlay, 0, 0);
  ctx.globalAlpha = project && underlay && $<HTMLInputElement>('underlay').checked ? 0.2 : 1;
  drawStrokes(ctx, strokes.filter((s) => !isNew(s)));
  ctx.globalAlpha = 1;
  drawStrokes(ctx, newStrokes(), true);
  if (project) $('newcount').textContent = `${newStrokes().length} neue Striche`;
}
function exportBlob(list: Stroke[], white: boolean): Promise<Blob> {
  const o = document.createElement('canvas');
  o.width = cv.width; o.height = cv.height;
  const c = o.getContext('2d')!;
  if (white) { c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); }
  drawStrokes(c, list);
  return new Promise((r) => o.toBlob((b) => r(b!), 'image/png'));
}
function pos(e: PointerEvent): [number, number] {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height];
}
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  cur = { w: +brush.value, c: color, pts: [pos(e)], v: project ? project.version + 1 : 0 };
  strokes.push(cur);
  redraw();
});
cv.addEventListener('pointermove', (e) => {
  if (!cur) return;
  cur.pts.push(pos(e));
  redraw();
});
const end = () => {
  if (cur && project) schedulePlan();
  cur = null;
};
cv.addEventListener('pointerup', end);
cv.addEventListener('pointercancel', end);
$('undo').onclick = () => {
  // im Projekt nur neue Striche zurücknehmen, das Modell bleibt
  if (project && !isNew(strokes[strokes.length - 1] ?? ({} as Stroke))) return;
  strokes.pop();
  redraw();
  if (project) schedulePlan();
};
$('clear').onclick = () => {
  strokes = project ? strokes.filter((s) => !isNew(s)) : [];
  redraw();
  if (project) schedulePlan();
};
$<HTMLInputElement>('underlay').onchange = redraw;
$<HTMLInputElement>('showsegs').onchange = redraw;
$<HTMLSelectElement>('action').onchange = () => schedulePlan();
$<HTMLSelectElement>('target').onchange = () => schedulePlan();
async function buildSegOverlay(p: Project) {
  const o = document.createElement('canvas');
  o.width = cv.width; o.height = cv.height;
  const c = o.getContext('2d')!;
  for (const q of p.parts) c.drawImage(tinted(await loadImg(`${API}/${q.mask_url}`), partColor(q)), 0, 0);
  segOverlay = o;
}
redraw();

// ---------- Bewertung ----------
function rating(el: HTMLElement, key: () => string, label: string) {
  el.innerHTML = '';
  if (!runId) return;
  const t = document.createElement('span');
  t.textContent = label;
  el.append(t);
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.textContent = String(i);
    b.onclick = async () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      const fd = new FormData();
      fd.append('id', runId); fd.append('key', key()); fd.append('score', String(i));
      await fetch(`${API}/rate`, { method: 'POST', body: fd });
    };
    el.append(b);
  }
  const hint = document.createElement('span');
  hint.textContent = '(1 = unbrauchbar, 5 = passt genau zur Skizze)';
  el.append(hint);
}

async function errText(r: Response) {
  try { const j = await r.json(); return j.detail ?? JSON.stringify(j); } catch { return `${r.status} ${r.statusText}`; }
}

// ---------- Skizze → Bild ----------
$('go').onclick = async () => {
  const subject = $<HTMLInputElement>('subject').value.trim();
  const s1 = $('s1');
  if (!strokes.length) { s1.innerHTML = '<span class="err">Erst etwas zeichnen.</span>'; return; }
  if (!subject) { s1.innerHTML = '<span class="err">Bitte links ein Tier wählen oder eintippen.</span>'; return; }
  if (project && !confirm('Neue Bilder starten ein neues Projekt. Das aktuelle Projekt bleibt unter „Letzte Läufe“ erhalten. Weiter?')) return;
  setProject(null);
  strokes.forEach((s) => { s.v = 0; delete s.part; });
  const fd = new FormData();
  fd.append('sketch', await exportBlob(strokes, true), 'sketch.png');
  fd.append('strokes', JSON.stringify(strokes));
  fd.append('subject', subject);
  fd.append('cls', selected?.name ?? '');
  for (const k of ['seed', 'scale', 'strength', 'steps', 'n']) fd.append(k, $<HTMLInputElement>(k).value);
  const btn = $<HTMLButtonElement>('go');
  btn.disabled = true;
  s1.textContent = 'Erzeuge Bilder … (beim ersten Mal lädt das Modell, ~30 s)';
  const t = performance.now();
  try {
    const r = await fetch(`${API}/sketch2img`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    runId = j.id;
    pick = 0;
    showImages(j.images);
    $('aux').innerHTML = (j.control ? `<figure><img src="${API}/${j.control}"><figcaption>Form (ans ControlNet)</figcaption></figure>` : '') +
      (j.init ? `<figure><img src="${API}/${j.init}"><figcaption>Farben (Startbild)</figcaption></figure>` : '');
    s1.textContent = `Fertig in ${((performance.now() - t) / 1000).toFixed(1)} s.${j.colors?.length ? ' Erkannte Farben: ' + j.colors.join(', ') + '.' : ''} Prompt: „${j.prompt}“`;
    loadHistory();
  } catch (e) {
    s1.innerHTML = `<span class="err">${(e as Error).message}</span>`;
  } finally {
    btn.disabled = false;
  }
};

function showImages(urls: string[]) {
  const box = $('imgs');
  box.innerHTML = '';
  urls.forEach((u, i) => {
    const d = document.createElement('div');
    d.className = 'sq' + (i === pick ? ' on' : '');
    const im = document.createElement('img');
    im.src = `${API}/${u}`;
    d.append(im);
    d.onclick = () => {
      pick = i;
      box.querySelectorAll('.sq').forEach((x, k) => x.classList.toggle('on', k === i));
    };
    box.append(d);
  });
  $<HTMLButtonElement>('go3d').disabled = !urls.length;
  rating($('rate2d'), () => `img${pick}`, 'Bild passt zur Skizze?');
  $('rate3d').innerHTML = '';
  $('dl').innerHTML = '';
  $('pre').innerHTML = '<div class="empty" style="position:absolute;inset:0">–</div>';
  clearModel();
}

// ---------- Bild → 3D (Grundmodell = Teil „Körper“) ----------
$('go3d').onclick = async () => {
  const s2 = $('s2');
  if (project && !confirm('Ein neues Grundmodell setzt das Projekt (alle angebauten Teile) zurück. Weiter?')) return;
  const btn = $<HTMLButtonElement>('go3d');
  btn.disabled = true;
  s2.textContent = '3D läuft … (beim ersten Mal lädt das Modell, ~1 min)';
  const t = performance.now();
  const fd = new FormData();
  fd.append('id', runId); fd.append('image', String(pick)); fd.append('seed', $<HTMLInputElement>('tseed').value);
  try {
    const r = await fetch(`${API}/img2three`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    $('pre').innerHTML = `<img src="${API}/${j.pre}" />`;
    last3dKey = `img${pick}_s${$<HTMLInputElement>('tseed').value}`;
    rating($('rate3d'), () => last3dKey, '3D passt zur Skizze?');
    $('dl').innerHTML = `<a href="${API}/${j.glb}" download>GLB herunterladen</a>`;
    strokes.forEach((s) => { s.v = 0; s.part = 'p0'; });
    if (j.project) await setProject(j.project, 'p0');
    else await loadModel(`${API}/${j.glb}`);
    s2.textContent = `Fertig in ${((performance.now() - t) / 1000).toFixed(0)} s, in ${j.project?.parts.length ?? 1} Segmente zerlegt. Zeichne in der Skizze weiter, um ein Segment zu ändern oder etwas anzubauen.`;
    $<HTMLInputElement>('showsegs').checked = true;
    redraw();
  } catch (e) {
    s2.innerHTML = `<span class="err">${(e as Error).message}</span>`;
  } finally {
    btn.disabled = false;
  }
};

// ---------- Projekt / Erweitern ----------
const partColor = (p: Part) => PART_COLORS[parseInt(p.id.slice(1)) % PART_COLORS.length];

async function setProject(p: Project | null, flash?: string) {
  project = p;
  $('editbox').hidden = !p;
  $('parts').hidden = !p;
  overlay = null;
  if (!p) { underlay = null; redraw(); return; }
  $('ver').textContent = String(p.version);
  underlay = await loadImg(`${API}/${p.image}`).catch(() => null);
  $('precap').textContent = `Aktuelles 2D-Bild des Projekts (Version ${p.version})`;
  $('pre').innerHTML = `<img src="${API}/${p.image}" />`;
  // Zielteil-Auswahl
  const sel = $<HTMLSelectElement>('target');
  sel.innerHTML = '<option value="">Teil: automatisch</option>' + p.parts.map((q) => `<option value="${q.id}">${q.id} · ${escapeHtml(q.name)}</option>`).join('');
  renderParts();
  await buildSegOverlay(p).catch(() => (segOverlay = null));
  redraw();
  await loadParts(p, flash);
  $('plantext').innerHTML = newStrokes().length ? 'Prüfe …' : 'Zeichne etwas dazu. Neue Striche leuchten orange; erkannt wird, zu welchem Teil sie gehören.';
  if (newStrokes().length) schedulePlan();
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function renderParts() {
  const box = $('parts');
  if (!project) return;
  box.innerHTML = '';
  for (const q of project.parts) {
    const row = document.createElement('div');
    row.className = 'pr';
    const parent = project.parts.find((x) => x.id === q.parent);
    row.innerHTML = `<span class="dot" style="background:${partColor(q)}"></span><span class="nm"></span>` +
      `<small title="Prüfsumme ${q.sha}">v${q.version} · ${q.kind === 'tsr' ? 'KI' : 'schnell'}</small>` +
      `<span class="st ${q.state}">${q.state}${q.state === 'unverändert' && q.intact ? ' ✓' : ''}</span>`;
    row.querySelector('.nm')!.textContent = `${q.name}${parent ? ` → ${parent.name}` : ''}`;
    const ren = document.createElement('button');
    ren.textContent = 'umbenennen';
    ren.onclick = () => renamePart(q);
    row.append(ren);
    const eye = document.createElement('button');
    eye.textContent = 'ein/aus';
    eye.onclick = () => togglePart(q.id);
    row.append(eye);
    if (q.id !== 'p0') {
      const del = document.createElement('button');
      del.textContent = 'löschen';
      del.onclick = () => deletePart(q.id);
      row.append(del);
    }
    row.onmouseenter = async () => {
      overlay = tinted(await loadImg(`${API}/${q.mask_url}`), partColor(q));
      redraw();
      highlightPart(q.id, true);
    };
    row.onmouseleave = () => { overlay = null; redraw(); highlightPart(q.id, false); };
    box.append(row);
  }
}

let planTimer = 0;
let planSeq = 0;
function schedulePlan() {
  clearTimeout(planTimer);
  planTimer = window.setTimeout(runPlan, 250);
}
async function runPlan() {
  if (!project) return;
  const ns = newStrokes();
  $('newcount').textContent = `${ns.length} neue Striche`;
  if (!ns.length) {
    $('plantext').textContent = 'Zeichne etwas dazu. Neue Striche leuchten orange; erkannt wird, zu welchem Teil sie gehören.';
    overlay = null; redraw();
    return;
  }
  const seq = ++planSeq;
  const fd = new FormData();
  fd.append('id', project.id);
  fd.append('newstrokes', await exportBlob(ns, false), 'new.png');
  fd.append('action', $<HTMLSelectElement>('action').value);
  fd.append('target', $<HTMLSelectElement>('target').value);
  try {
    const r = await fetch(`${API}/plan`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    if (seq !== planSeq || !project) return;
    const ref = project.parts.find((q) => q.id === j.target);
    $('plantext').innerHTML = `Erkannt: <b>${escapeHtml(j.text)}</b>`;
    if (j.seg_url) { overlay = tinted(await loadImg(`${API}/${j.seg_url}`), '#ff00aa'); redraw(); }
    else if (ref) { overlay = tinted(await loadImg(`${API}/${ref.mask_url}`), partColor(ref)); redraw(); }
  } catch (e) {
    $('plantext').innerHTML = `<span class="err">${(e as Error).message}</span>`;
  }
}

$('apply').onclick = async () => {
  if (!project) return;
  const ns = newStrokes();
  const s3 = $('s3');
  if (!ns.length) { s3.innerHTML = '<span class="err">Erst etwas dazuzeichnen.</span>'; return; }
  const nv = project.version + 1;
  const fd = new FormData();
  fd.append('id', project.id);
  fd.append('sketch', await exportBlob(strokes, true), 'sketch.png');
  fd.append('newstrokes', await exportBlob(ns, false), 'new.png');
  fd.append('action', $<HTMLSelectElement>('action').value);
  fd.append('target', $<HTMLSelectElement>('target').value);
  fd.append('method', $<HTMLSelectElement>('method').value);
  fd.append('part_text', $<HTMLInputElement>('parttext').value);
  fd.append('strokes', JSON.stringify(strokes.map((s) => (isNew(s) ? { ...s, v: nv } : s))));
  const btn = $<HTMLButtonElement>('apply');
  btn.disabled = true;
  s3.textContent = 'KI generiert nur das betroffene Segment neu … (~10–30 s)';
  const t = performance.now();
  try {
    const r = await fetch(`${API}/edit`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    ns.forEach((s) => { s.v = nv; s.part = j.changed; });
    $<HTMLInputElement>('parttext').value = '';
    await setProject(j, j.changed);
    const ch = j.parts.find((q: Part) => q.id === j.changed);
    const others = j.parts.filter((q: Part) => q.id !== j.changed);
    const intact = others.every((q: Part) => q.state === 'unverändert');
    s3.innerHTML = `„${escapeHtml(ch?.name ?? j.changed)}“ ${ch?.state ?? ''} in ${((performance.now() - t) / 1000).toFixed(1)} s (${escapeHtml(j.info)})` +
      ` · ${others.length ? (intact ? `übrige ${others.length} Teile unverändert ✓ (Prüfsumme)` : '<span class="err">Achtung: andere Teile geändert</span>') : ''}`;
  } catch (e) {
    s3.innerHTML = `<span class="err">${(e as Error).message}</span>`;
  } finally {
    btn.disabled = false;
  }
};

$('undoEdit').onclick = async () => {
  if (!project) return;
  const fd = new FormData();
  fd.append('id', project.id);
  const r = await fetch(`${API}/undo`, { method: 'POST', body: fd });
  if (!r.ok) { $('s3').innerHTML = `<span class="err">${await errText(r)}</span>`; return; }
  const j = await r.json();
  // Striche der zurückgenommenen Änderung werden wieder „neu“ (zum Anpassen oder Wegnehmen)
  strokes.forEach((s) => { if ((s.v ?? 0) > j.version) { s.v = j.version + 1; delete s.part; } });
  $('s3').textContent = `Zurück auf Version ${j.version}. Die Striche der Änderung sind wieder als neu markiert.`;
  await setProject(j);
};

$('restart').onclick = () => {
  if (!confirm('Projekt verlassen und mit leerer Skizze beginnen? (Das Projekt bleibt unter „Letzte Läufe“.)')) return;
  setProject(null);
  strokes = [];
  runId = '';
  redraw();
  clearModel();
  $('imgs').innerHTML = '<div class="sq empty">noch kein Bild</div>';
};

async function renamePart(q: Part) {
  if (!project) return;
  const name = prompt('Name des Segments (englisch hilft der KI, z. B. tail, dorsal fin, head):', q.name.startsWith('Segment') ? '' : q.name);
  if (!name) return;
  const fd = new FormData();
  fd.append('id', project.id); fd.append('part', q.id); fd.append('name', name);
  const r = await fetch(`${API}/part_rename`, { method: 'POST', body: fd });
  if (r.ok) await setProject(await r.json());
}
async function deletePart(id: string) {
  if (!project) return;
  const fd = new FormData();
  fd.append('id', project.id); fd.append('part', id);
  const r = await fetch(`${API}/part_delete`, { method: 'POST', body: fd });
  if (!r.ok) { $('s3').innerHTML = `<span class="err">${await errText(r)}</span>`; return; }
  strokes = strokes.filter((s) => s.part !== id);
  await setProject(await r.json());
  $('s3').textContent = `Teil ${id} gelöscht, seine Striche sind entfernt.`;
}

// ---------- 3D-Ansicht ----------
const host = $('viewer');
let viewer: Promise<{ T: Three; scene: any; cam: any; controls: any; GLTFLoader: any }> | null = null;
let model: any = null; // Einzelmodell (alte Läufe ohne Projekt)
let group: any = null; // Projekt: ein Knoten pro Teil
const partNodes = new Map<string, { url: string; node: any }>();

function initViewer() {
  viewer ??= (async () => {
    const T = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    host.append(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color(0xf4f4f4);
    scene.add(new T.HemisphereLight(0xffffff, 0x888888, 2.2));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 3, 1);
    scene.add(sun);
    const cam = new T.PerspectiveCamera(35, 1, 0.01, 100);
    cam.position.set(1.6, 1.0, 1.6);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    const resize = () => { const w = host.clientWidth; renderer.setSize(w, w, false); cam.aspect = 1; cam.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(host);
    resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, cam); });
    return { T, scene, cam, controls, GLTFLoader };
  })();
  return viewer;
}

function clearModel() {
  if (!viewer) return;
  viewer.then((v) => {
    if (model) { v.scene.remove(model); model = null; }
    if (group) { v.scene.remove(group); group = null; partNodes.clear(); }
  });
}
async function loadModel(url: string) {
  const { T, scene, cam, controls, GLTFLoader } = await initViewer();
  const g = await new GLTFLoader().loadAsync(url);
  clearModel();
  model = g.scene;
  matte(model);
  const box = new T.Box3().setFromObject(model);
  const size = box.getSize(new T.Vector3()).length();
  model.position.sub(box.getCenter(new T.Vector3()));
  model.scale.setScalar(1.6 / size);
  model.position.multiplyScalar(1.6 / size);
  scene.add(model);
  controls.target.set(0, 0, 0);
  cam.position.set(1.4, 0.8, 1.4);
}
// Projekt: Teile liegen schon im gemeinsamen Bild-Koordinatensystem (Kamera der Skizze auf +X).
// Nur Teile mit neuer Datei werden geladen, alle anderen Knoten bleiben unberührt im Szenengraph.
async function loadParts(p: Project, flash?: string) {
  const { T, scene, cam, controls, GLTFLoader } = await initViewer();
  if (model) { scene.remove(model); model = null; }
  const first = !group;
  if (!group) { group = new T.Group(); scene.add(group); }
  const keep = new Set(p.parts.map((q) => q.id));
  for (const [id, n] of partNodes) if (!keep.has(id)) { group.remove(n.node); partNodes.delete(id); }
  for (const q of p.parts) {
    const url = `${API}/${q.url}`;
    const have = partNodes.get(q.id);
    if (have?.url === url) continue;
    const g = await new GLTFLoader().loadAsync(url);
    g.scene.name = q.id;
    matte(g.scene);
    if (have) group.remove(have.node);
    group.add(g.scene);
    partNodes.set(q.id, { url, node: g.scene });
  }
  if (first) { controls.target.set(0, 0, 0); cam.position.set(3.4, 0.25, 0); }
  if (flash) { highlightPart(flash, true); setTimeout(() => highlightPart(flash, false), 1600); }
}
// Teile haben kein eigenes Material → glTF-Standard wäre voll metallisch (ohne Umgebung fast schwarz). Matt machen.
function matte(root: any) {
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if ('metalness' in m) { m.metalness = 0; m.roughness = 0.85; m.needsUpdate = true; }
  });
}
function highlightPart(id: string, on: boolean) {
  const n = partNodes.get(id)?.node;
  if (!n) return;
  n.traverse((o: any) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m.emissive) { m.emissive.set(on ? 0xff7a00 : 0x000000); m.emissiveIntensity = on ? 0.35 : 0; }
  });
}
function togglePart(id: string) {
  const n = partNodes.get(id)?.node;
  if (n) n.visible = !n.visible;
}
$('frontview').onclick = async () => {
  const { cam, controls } = await initViewer();
  controls.target.set(0, 0, 0);
  cam.position.set(3.4, 0, 0);
};

// ---------- Verlauf ----------
async function openProject(id: string) {
  const r = await fetch(`${API}/project/${id}`);
  if (!r.ok) return false;
  const p: Project = await r.json();
  if (p.sketch) {
    const sr = await fetch(`${API}/${p.sketch}`);
    if (sr.ok) {
      const list: Stroke[] = await sr.json();
      // ohne Versionsangabe gespeicherte Striche gehören zur Grundskizze
      strokes = list.map((s) => ({ ...s, v: Math.min(s.v ?? 0, p.version) }));
    }
  }
  clearModel();
  await setProject(p);
  return true;
}
async function loadHistory() {
  const r = await fetch(`${API}/history`);
  if (!r.ok) return;
  const runs = await r.json();
  const box = $('hist');
  box.innerHTML = runs.length ? '' : '<span class="stat">Noch keine Läufe.</span>';
  for (const m of runs) {
    if (!m.images?.length) continue;
    const f = document.createElement('figure');
    const glbs = Object.keys(m).filter((k) => k.startsWith('trellis_img')).length;
    f.innerHTML = `<img src="${API}/files/${m.id}/sketch.png" /><figcaption></figcaption>`;
    f.querySelector('figcaption')!.textContent = `${m.subject}${m.project ? ' · Projekt' : glbs ? ` · ${glbs}× 3D` : ''}`;
    f.title = m.prompt;
    f.onclick = async () => {
      runId = m.id;
      pick = 0;
      $<HTMLInputElement>('subject').value = m.subject;
      showImages(m.images.map((x: string) => `files/${m.id}/${x}`));
      if (m.project && (await openProject(m.id))) {
        $('s2').textContent = 'Projekt geöffnet: alte Skizze geladen. Zeichne dazu, um Teile anzubauen.';
        return;
      }
      setProject(null);
      const first = Object.keys(m).find((k) => k.startsWith('trellis_img'));
      if (first) {
        const tag = first.replace('trellis_', '');
        $('pre').innerHTML = `<img src="${API}/files/${m.id}/${tag}_pre.png" />`;
        loadModel(`${API}/files/${m.id}/${tag}.glb`);
        last3dKey = tag;
        rating($('rate3d'), () => last3dKey, '3D passt zur Skizze?');
      }
    };
    box.append(f);
  }
}

// ---------- Start ----------
(async () => {
  $<HTMLInputElement>('q').oninput = renderClasses;
  try {
    const [c, s] = await Promise.all([fetch(`${API}/classes`), fetch(`${API}/status`)]);
    classes = await c.json();
    const st = await s.json();
    $('tok').textContent = st.local ? 'lokal · Heim-PC' : st.token ? 'HF-Token aktiv' : 'ohne HF-Token';
    $('backend').textContent = `Skizze → Bild: ${st.sd}. Bild → 3D: ${st.trellis}.`;
    renderClasses();
    loadHistory();
  } catch {
    $('classlist').innerHTML = '<div class="stat err" style="padding:10px">Backend nicht erreichbar (lab/trellis_lab/server_local.py auf dem Heim-PC, Port 8790).</div>';
  }
})();
