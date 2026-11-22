import * as THREE from 'three';
import { Viewer, type ModelScene } from './viewer';

export type Tool = 'select' | 'hand' | 'pen' | 'eraser' | 'rect' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'text' | 'note' | 'bucket' | 'comment' | 'imgErase' | 'magic';
export type ElType = 'stroke' | 'rect' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'text' | 'image' | 'model';
/**
 * Ort eines Kommentar-Pins. Auf 3D-Modellen zusätzlich: getroffenes Teil, Textur-UV (glTF, v nach unten)
 * und Punkt in Modellkoordinaten (Meter) – der Pin folgt so dem Modell beim Drehen und nach Änderungen.
 */
export type CommentAnchor = { elId: number | null; u: number; v: number; wx: number; wy: number; part?: string; uv?: [number, number] | null; p?: [number, number, number] };
export type ModelDims = { laenge: number; breite: number; hoehe: number };
export type SizeAxis = 'laenge' | 'breite' | 'hoehe';
/** 3D-Dateien, die der Canvas annimmt; alles außer GLB/glTF wandelt der Prompt-Server in GLB um. */
export const MODEL_EXT = /\.(glb|gltf|obj|usd|usda|usdc)$/i;
export type TextRequest = { wx: number; wy: number; sx: number; sy: number; note: boolean };

export type Stroke = { type: 'stroke'; id: number; op: number; pts: number[]; color: string; width: number; fill: string | null; ox: number; oy: number; path: Path2D | null; fp: Path2D | null; bb: number[] };
export type Shape = { type: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow'; id: number; op: number; x: number; y: number; w: number; h: number; color: string; width: number; fill: string | null };
export type TextEl = { type: 'text'; id: number; op: number; x: number; y: number; w: number; h: number; text: string; color: string; size: number; note: string | null };
/** rev: Zähler für Pixeländerungen (Radieren, Freistellen) – die Sync-Schicht lädt dann eine neue Blob-Version hoch. */
export type ImageEl = { type: 'image'; id: number; x: number; y: number; w: number; h: number; cv: HTMLCanvasElement; label: string; rev: number; blob?: string };
/** src: 'demo:<seed>' oder sha256 einer hochgeladenen GLB-Datei; glb: Rohdaten bis zum Upload. */
export type ModelEl = { type: 'model'; id: number; x: number; y: number; w: number; h: number; ms: ModelScene; label: string; src: string; glb?: ArrayBuffer; /** KI-Studio-Projekt, aus dem das Modell stammt */ studio?: string };
export type El = Stroke | Shape | TextEl | ImageEl | ModelEl;
/** Im Modell angeklickte Teile (eins oder mehrere): Namen und die Muster, unter denen sie der Prompt-Editor kennt. */
export type PartRef = { modelId: number; names: string[]; patterns: string[]; logos: boolean };
type Boxy = ImageEl | ModelEl;
type Op = { undo(): void; redo(): void };
type Pt = { x: number; y: number };

const PALETTE = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const BG_PALETTE = ['#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];

export function bbox(e: El): number[] {
  if (e.type === 'stroke') return [e.bb[0] + e.ox, e.bb[1] + e.oy, e.bb[2] + e.ox, e.bb[3] + e.oy];
  return [Math.min(e.x, e.x + e.w), Math.min(e.y, e.y + e.h), Math.max(e.x, e.x + e.w), Math.max(e.y, e.y + e.h)];
}

export function strokeBB(s: Stroke) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    a = Math.min(a, s.pts[i]); c = Math.max(c, s.pts[i]);
    b = Math.min(b, s.pts[i + 1]); d = Math.max(d, s.pts[i + 1]);
  }
  const r = s.width;
  s.bb = [a - r, b - r, c + r, d + r];
}

function buildPath(s: Stroke): Path2D {
  const p = s.pts, n = p.length / 3, path = new Path2D();
  if (n === 1) { path.arc(p[0], p[1], s.width / 2, 0, 7); return path; }
  const L: number[] = [], R: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], len = Math.hypot(dx, dy) || 1;
    const r = s.width * 0.5 * (0.35 + 0.65 * p[i * 3 + 2]);
    const nx = (-dy / len) * r, ny = (dx / len) * r;
    L.push(p[i * 3] + nx, p[i * 3 + 1] + ny);
    R.push(p[i * 3] - nx, p[i * 3 + 1] - ny);
  }
  path.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) path.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) path.lineTo(R[i], R[i + 1]);
  path.closePath();
  return path;
}

function polyPath(s: Stroke): Path2D {
  const path = new Path2D();
  path.moveTo(s.pts[0], s.pts[1]);
  for (let i = 3; i < s.pts.length; i += 3) path.lineTo(s.pts[i], s.pts[i + 1]);
  path.closePath();
  return path;
}

function isClosed(s: Stroke) {
  const n = s.pts.length / 3;
  if (n < 10) return false;
  const diag = Math.hypot(s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]);
  return Math.hypot(s.pts[0] - s.pts[(n - 1) * 3], s.pts[1] - s.pts[(n - 1) * 3 + 1]) < diag * 0.25;
}

function pip(pts: number[], x: number, y: number) {
  let inside = false;
  const n = pts.length / 3;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 3], yi = pts[i * 3 + 1], xj = pts[j * 3], yj = pts[j * 3 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function diamondPts(b: number[]) {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return [cx, b[1], 0, b[2], cy, 0, cx, b[3], 0, b[0], cy, 0];
}

function polyEdgeDist(p: number[], x: number, y: number) {
  let d = Infinity;
  const n = p.length / 3;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; d = Math.min(d, segDist(x, y, p[i * 3], p[i * 3 + 1], p[j * 3], p[j * 3 + 1])); }
  return d;
}

function hit(e: El, x: number, y: number, tol: number, solid = true): boolean {
  const b = bbox(e);
  if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) return false;
  if (e.type === 'text') return true;
  if (e.type === 'line' || e.type === 'arrow') return segDist(x, y, e.x, e.y, e.x + e.w, e.y + e.h) <= e.width / 2 + tol;
  if (e.type === 'diamond') { const p = diamondPts(b); return (!!e.fill && pip(p, x, y)) || polyEdgeDist(p, x, y) <= e.width / 2 + tol; }
  if (e.type === 'model' || e.type === 'image') return solid || x < b[0] + tol * 2 || x > b[2] - tol * 2 || y < b[1] + tol * 2 || y > b[3] - tol * 2;
  if (e.type === 'stroke') {
    const lx = x - e.ox, ly = y - e.oy;
    if (e.fill && isClosed(e) && pip(e.pts, lx, ly)) return true;
    const r = e.width / 2 + tol;
    for (let i = 0; i + 3 < e.pts.length; i += 3)
      if (segDist(lx, ly, e.pts[i], e.pts[i + 1], e.pts[i + 3], e.pts[i + 4]) <= r) return true;
    return e.pts.length === 3 && Math.hypot(lx - e.pts[0], ly - e.pts[1]) <= r;
  }
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, rx = (b[2] - b[0]) / 2 || 1, ry = (b[3] - b[1]) / 2 || 1;
  const r = e.width / 2 + tol;
  if (e.type === 'ellipse') {
    const v = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return e.fill ? v <= 1 + r / Math.min(rx, ry) : Math.abs(v - 1) * Math.min(rx, ry) <= r;
  }
  if (e.fill) return true;
  return x < b[0] + r || x > b[2] - r || y < b[1] + r || y > b[3] - r;
}

function fillable(e: El, x: number, y: number): boolean {
  if (e.type === 'model' || e.type === 'image' || e.type === 'text' || e.type === 'line' || e.type === 'arrow') return false;
  const b = bbox(e);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  if (e.type === 'rect') return true;
  if (e.type === 'diamond') return pip(diamondPts(b), x, y);
  if (e.type === 'ellipse') return Math.hypot((x - (b[0] + b[2]) / 2) / ((b[2] - b[0]) / 2 || 1), (y - (b[1] + b[3]) / 2) / ((b[3] - b[1]) / 2 || 1)) <= 1;
  if (e.type !== 'stroke') return false;
  return isClosed(e) && pip(e.pts, x - e.ox, y - e.oy);
}

const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const NOTE_PAD = 14;
const SHAPE_TOOLS: Tool[] = ['rect', 'diamond', 'ellipse', 'arrow', 'line'];

function copyCanvas(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

function measureText(text: string, size: number) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${size}px ${TEXT_FONT}`;
  const lines = text.split('\n');
  return { w: Math.max(8, ...lines.map((l) => ctx.measureText(l).width)), h: lines.length * size * 1.3 };
}

/** Hintergrund entfernen: Flutfüllung ab dem Bildrand mit der häufigsten Randfarbe als Referenz. */
function removeBackground(cv: HTMLCanvasElement, tol = 42) {
  const W = cv.width, H = cv.height, ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const counts = new Map<number, number>();
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  for (const i of border) {
    if (d[i * 4 + 3] < 10) continue;
    const k = ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = -1, bestN = 0;
  counts.forEach((n, k) => { if (n > bestN) { bestN = n; best = k; } });
  if (best < 0) return false;
  const br = ((best >> 8) & 15) * 16 + 8, bg = ((best >> 4) & 15) * 16 + 8, bb = (best & 15) * 16 + 8;
  const dist = (i: number) => Math.hypot(d[i * 4] - br, d[i * 4 + 1] - bg, d[i * 4 + 2] - bb);
  const seen = new Uint8Array(W * H), q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (const i of border) if (!seen[i] && (d[i * 4 + 3] < 10 || dist(i) < tol)) { seen[i] = 1; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = i % W;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
    for (const j of nb) if (j >= 0 && !seen[j] && (d[j * 4 + 3] < 10 || dist(j) < tol)) { seen[j] = 1; q[qt++] = j; }
  }
  if (!qt) return false;
  for (let k = 0; k < qt; k++) d[q[k] * 4 + 3] = 0;
  // weiche Kante: Nachbarn des entfernten Bereichs teilweise transparent
  for (let i = 0; i < W * H; i++) {
    if (seen[i]) continue;
    const x = i % W;
    if ((x > 0 && seen[i - 1]) || (x < W - 1 && seen[i + 1]) || (i >= W && seen[i - W]) || (i < W * (H - 1) && seen[i + W])) {
      const t = Math.min(1, Math.max(0, (dist(i) - tol) / (tol * 1.5)));
      d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (0.35 + 0.65 * t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

export class Engine {
  els: El[] = [];
  cam = { x: -420, y: -300, z: 1 };
  tool: Tool = 'pen';
  color = PALETTE[0];
  fillColor: string | null = '#a5d8ff';
  width = 4;
  opacity = 100;
  pressure = true;
  lock = false;
  continuous = false;
  onTool?: (t: Tool) => void;
  onObj?: (b: boolean) => void;
  /** Welches Teil eines Modells gerade angeklickt ist (null = keins). */
  onPart?: (p: PartRef | null) => void;
  onSel?: (ids: number[]) => void;
  onFrame?: () => void;
  onComment?: (a: CommentAnchor) => void;
  onTextRequest?: (r: TextRequest) => void;
  onImagePick?: () => void;
  onChange?: () => void;
  /** Wandelt OBJ/USD in GLB um (Prompt-Server); ohne Funktion nimmt der Canvas nur GLB/glTF an. */
  convertModel?: (f: File) => Promise<ArrayBuffer>;
  /** Fehler beim Laden einer Datei (z. B. glTF mit externen Dateien). */
  onError?: (title: string, body: string) => void;
  /** Wird im Welt-Koordinatensystem nach den Elementen gezeichnet (fremde Entwürfe, Auswahl anderer). */
  /** Magic Pen: aktuell gesammelte Skizzenstriche (Anzahl) – für die Schaltfläche „Erzeugen“. */
  onMagic?: (n: number) => void;
  readonly magic: Stroke[] = [];
  onOverlay?: (ctx: CanvasRenderingContext2D, zoom: number) => void;
  /** Basis für global eindeutige IDs (z. B. Yjs-clientID · 2^20), damit parallele Clients nicht kollidieren. */
  idBase = 0;

  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private W = 0;
  private H = 0;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private fps = 60;
  private drawMs = 0;
  private visible = 0;
  private nextId = 1;
  private sel: El | null = null; // primäres Element (Verschieben/Größe)
  private selSet: El[] = [];
  /** Element, das gerade gezogen/gezeichnet wird (noch nicht festgeschrieben). */
  cur: Stroke | Shape | null = null;
  private undoS: Op[] = [];
  private redoS: Op[] = [];
  readonly viewer = new Viewer();
  private hover: El | null = null;
  private active: ModelEl | null = null; // Modell, in dem Teile gewählt sind
  private activeObjs: any[] = []; // gewählte Teile (Top-Level-Objekte des Modells)
  private pickNames: string[] = []; // zusätzlich hervorgehoben (Rückfrage „Teil anklicken“)
  /** Mehrfachauswahl von Teilen ohne Umschalttaste (Handy/iPad): jeder Tipp fügt hinzu oder nimmt weg. */
  multiPart = false;
  onMulti?: (b: boolean) => void;
  private pickAdd = false;
  private ptrs = new Map<number, Pt>();
  mode: 'none' | 'pan' | 'draw' | 'move' | 'erase' | 'pinch' | 'orbit' | 'resize' | 'marquee' | 'imgErase' = 'none';
  private downPt: Pt = { x: 0, y: 0 };
  private moved = false;
  private lastScr: Pt = { x: 0, y: 0 };
  private ptrScr: Pt | null = null;
  private resizeFrom = { x: 0, y: 0, w: 0, h: 0 };
  private corner: 'nw' | 'ne' | 'sw' | 'se' = 'se';
  private hoverPickT = 0;
  private last: Pt = { x: 0, y: 0 };
  private pinch = { d: 1, cx: 0, cy: 0 };
  private moveTot = { x: 0, y: 0 };
  private marquee: { a: Pt; b: Pt; add: boolean } | null = null;
  private erased: { el: El; idx: number }[] = [];
  private imgErase: { el: ImageEl; before: HTMLCanvasElement; last: Pt } | null = null;
  private space = false;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    const on = (t: HTMLElement | Window, ev: string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, o);
      this.cleanup.push(() => t.removeEventListener(ev, fn));
    };
    on(canvas, 'pointerdown', (e) => this.onDown(e));
    on(canvas, 'pointermove', (e) => this.onMove(e));
    on(canvas, 'pointerup', (e) => this.onUp(e));
    on(canvas, 'pointercancel', (e) => this.onUp(e));
    on(canvas, 'pointerleave', () => { this.ptrScr = null; this.dirty = true; });
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'dragover', (e) => e.preventDefault());
    on(canvas, 'drop', (e) => this.onDrop(e));
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => { if (e.code === 'Space') this.space = false; });
    on(window, 'paste', (e) => this.onPaste(e));
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanup.forEach((f) => f());
    this.viewer.dispose(); // WebGL-Kontext sofort freigeben (Safari/iPad hat nur wenige)
  }

  private newId() { return this.idBase + this.nextId++; }

  /** Start-Modell für eine leere Zeichenfläche (nicht in der Undo-Historie). */
  seedDemo() { this.addModel(80, -250); this.undoS = []; this.onChange?.(); }

  invalidate() { this.dirty = true; }

  screenToWorld(x: number, y: number): Pt { return this.toWorld({ x, y }); }

  /** Nach fremden Änderungen: Auswahl/Hover bereinigen, neu zeichnen. */
  refresh() { this.pruneSel(); if (this.hover && !this.els.includes(this.hover)) this.hover = null; this.dirty = true; }

  drawElement(ctx: CanvasRenderingContext2D, e: El) { this.drawEl(ctx, e); }

  stats() {
    return { fps: Math.round(this.fps), ms: +this.drawMs.toFixed(1), total: this.els.length, visible: this.visible, zoom: this.cam.z };
  }

  // ---------- Kamera ----------
  private resize() {
    const p = this.canvas.parentElement!;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = p.clientWidth;
    this.H = p.clientHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.dirty = true;
  }

  private toWorld(p: Pt): Pt {
    return { x: this.cam.x + p.x / this.cam.z, y: this.cam.y + p.y / this.cam.z };
  }

  toScreen(x: number, y: number): Pt {
    return { x: (x - this.cam.x) * this.cam.z, y: (y - this.cam.y) * this.cam.z };
  }

  private zoomAt(sx: number, sy: number, f: number) {
    const c = this.cam, wx = c.x + sx / c.z, wy = c.y + sy / c.z;
    c.z = Math.max(0.01, Math.min(60, c.z * f));
    c.x = wx - sx / c.z;
    c.y = wy - sy / c.z;
    this.dirty = true;
  }

  setZoom(z: number) { this.zoomAt(this.W / 2, this.H / 2, z / this.cam.z); }

  fit() {
    if (!this.els.length) return;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const e of this.els) { const r = bbox(e); a = Math.min(a, r[0]); b = Math.min(b, r[1]); c = Math.max(c, r[2]); d = Math.max(d, r[3]); }
    const z = Math.min((this.W - 160) / (c - a || 1), (this.H - 160) / (d - b || 1), 4);
    this.cam.z = Math.max(0.01, z);
    this.cam.x = (a + c) / 2 - this.W / 2 / this.cam.z;
    this.cam.y = (b + d) / 2 - this.H / 2 / this.cam.z;
    this.dirty = true;
  }

  // ---------- Abfragen für die UI ----------
  private byId(id: number) { return this.els.find((e) => e.id === id) ?? null; }

  info(id: number): { id: number; type: ElType; label: string } | null {
    const e = this.byId(id);
    if (!e) return null;
    const names: Record<ElType, string> = { stroke: 'Sketch', rect: 'Rectangle', diamond: 'Diamond', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', text: 'Text', image: 'Image', model: '3D model' };
    const label = e.type === 'image' || e.type === 'model' ? e.label : e.type === 'text' ? (e.note ? 'Note' : 'Text') + ` “${e.text.slice(0, 18)}${e.text.length > 18 ? '…' : ''}”` : names[e.type];
    return { id, type: e.type, label };
  }

  /** Bildschirm-Rechteck [l, t, r, b] eines Elements (relativ zum Canvas). */
  screenBox(id: number): number[] | null {
    const e = this.byId(id);
    if (!e) return null;
    const b = bbox(e), a = this.toScreen(b[0], b[1]), c = this.toScreen(b[2], b[3]);
    return [a.x, a.y, c.x, c.y];
  }

  anchorPos(a: CommentAnchor): Pt | null {
    if (a.elId === null) return this.toScreen(a.wx, a.wy);
    const e = this.byId(a.elId);
    if (!e) return null;
    const b = bbox(e);
    let { u, v } = a;
    if (e.type === 'model' && a.p) {
      const q = this.viewer.project(e.ms, a.p, e.w / e.h);
      if (q) { u = Math.min(1, Math.max(0, q.x)); v = Math.min(1, Math.max(0, q.y)); }
    }
    return this.toScreen(b[0] + u * (b[2] - b[0]), b[1] + v * (b[3] - b[1]));
  }

  /** Teil und Textur-UV unter einem Pin – am aktuellen Modell neu bestimmt (Teilnamen können sich geändert haben). */
  resolvePin(a: CommentAnchor): { part?: string; uv?: [number, number] | null } {
    const e = a.elId !== null ? this.byId(a.elId) : null;
    if (e?.type === 'model' && a.p) {
      const q = this.viewer.project(e.ms, a.p, e.w / e.h);
      const h = q && this.viewer.hitInfo(e.ms, q.x * 2 - 1, -(q.y * 2 - 1), e.w / e.h);
      if (h) return { part: h.part, uv: h.uv };
    }
    return { part: a.part, uv: a.uv };
  }

  // ---------- 3D-Modelle: Maße, Ansichten, Hervorhebung ----------
  /** Echte Maße eines Modells in Metern (null, wenn es kein Modell ist). */
  modelDims(id: number): ModelDims | null {
    const e = this.byId(id);
    return e?.type === 'model' ? this.viewer.dims(e.ms) : null;
  }

  /** Alle Modelle auf dem Canvas mit Namen und Maßen – für „gleiche die Größe an“. */
  allModelDims(): ({ id: number; name: string } & ModelDims)[] {
    return this.els.filter((e): e is ModelEl => e.type === 'model').map((e) => ({ id: e.id, name: e.label, ...this.viewer.dims(e.ms) }));
  }

  /** Ansichten und Set-of-Marks-Bilder für die KI. */
  modelViews(id: number) {
    const e = this.byId(id);
    return e?.type === 'model' ? this.viewer.renderViews(e.ms) : null;
  }

  /** Zusätzliche Hervorhebung (Rückfrage „Teil anklicken“); die Auswahl bleibt dabei hervorgehoben. */
  highlightParts(id: number, names: string[]) {
    const e = this.byId(id);
    if (e?.type !== 'model') return;
    this.pickNames = names;
    this.refreshHighlight();
  }

  private refreshHighlight() {
    for (const e of this.els) {
      if (e.type !== 'model') continue;
      const mine = e === this.active ? this.activeObjs.map((o) => o.name as string) : [];
      this.viewer.highlight(e.ms, new Set([...mine, ...(this.sel === e || this.active === e ? this.pickNames : [])]));
    }
    this.dirty = true;
  }

  private partRef(): PartRef | null {
    const m = this.active;
    if (!m || !this.activeObjs.length) return null;
    return { modelId: m.id, names: this.activeObjs.map((o) => o.name), patterns: this.activeObjs.map((o) => this.viewer.partPattern(o)),
      logos: this.activeObjs.every((o) => this.viewer.isLogo(o)) };
  }

  /** Ist dieses Teil gerade ausgewählt? */
  partSelected(o: unknown) { return this.activeObjs.includes(o); }

  setMultiPart(b: boolean) { this.multiPart = b; this.onMulti?.(b); }

  /** Gewählte Teile gemeinsam vergrößern/verkleinern (Logos und andere Anbauteile). */
  scaleSelectedParts(f: number) {
    const m = this.active, objs = this.activeObjs.slice();
    if (!m || !objs.length || !(f > 0)) return;
    const snap = () => objs.map((o) => o.matrix.clone());
    const before = snap();
    this.viewer.scaleObjects(m.ms, objs, f);
    const after = snap();
    const apply = (ms: THREE.Matrix4[]) => { objs.forEach((o, i) => { o.matrix.copy(ms[i]); o.matrix.decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true); }); m.ms.dirty = true; this.dirty = true; };
    this.push({ undo: () => apply(before), redo: () => apply(after) });
  }

  /** Gewählte Teile aus dem Modell löschen (rückgängig machbar). */
  deleteSelectedParts() {
    const m = this.active, objs = this.activeObjs.slice();
    if (!m || !objs.length) return;
    if (objs.length >= m.ms.root.children.length) return; // mindestens ein Teil bleibt
    const recs = objs.map((o) => ({ o, i: m.ms.root.children.indexOf(o) })).sort((a, b) => a.i - b.i);
    this.deselect3d();
    for (const r of recs.slice().reverse()) r.o.removeFromParent();
    m.ms.dirty = true;
    this.push({
      undo: () => { for (const r of recs) m.ms.root.add(r.o); m.ms.dirty = true; this.dirty = true; },
      redo: () => { for (const r of recs) r.o.removeFromParent(); m.ms.dirty = true; this.dirty = true; },
    });
  }

  /**
   * Echte Größe setzen (lokal, ohne KI): alle Teile gemeinsam um die Bodenmitte skalieren, proportional.
   * Die Lage der Teile wird synchronisiert; rückgängig machbar.
   */
  setModelSize(id: number, axis: SizeAxis, meters: number) {
    const e = this.byId(id);
    if (e?.type !== 'model' || !(meters > 0)) return false;
    const d = this.viewer.dims(e.ms);
    if (!(d[axis] > 0)) return false;
    const f = meters / d[axis];
    const box = this.viewer.localBox(e.ms);
    const pivot = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    const kids = [...e.ms.root.children];
    const before = kids.map((k) => ({ p: k.position.clone(), s: k.scale.clone() }));
    for (const k of kids) { k.position.sub(pivot).multiplyScalar(f).add(pivot); k.scale.multiplyScalar(f); }
    const after = kids.map((k) => ({ p: k.position.clone(), s: k.scale.clone() }));
    const apply = (st: { p: THREE.Vector3; s: THREE.Vector3 }[]) => {
      kids.forEach((k, i) => { k.position.copy(st[i].p); k.scale.copy(st[i].s); });
      this.viewer.refit(e.ms);
      this.dirty = true;
    };
    apply(after);
    this.push({ undo: () => apply(before), redo: () => apply(after) });
    return true;
  }

  selection() { return this.selSet.map((e) => e.id); }

  /** PNG-Schnappschuss eines Elements inkl. allem, was darüber gezeichnet wurde (Markup). */
  snapshot(id: number, max = 768): string | null {
    const e = this.byId(id);
    if (!e) return null;
    const b = bbox(e), bw = b[2] - b[0], bh = b[3] - b[1];
    const s = Math.min(max / bw, max / bh, e.type === 'image' ? e.cv.width / bw : 2);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bw * s)); c.height = Math.max(1, Math.round(bh * s));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(s, 0, 0, s, -b[0] * s, -b[1] * s);
    const idx = this.els.indexOf(e);
    for (let i = idx; i < this.els.length; i++) {
      const o = this.els[i], ob = bbox(o);
      if (i === idx || (ob[2] > b[0] && ob[0] < b[2] && ob[3] > b[1] && ob[1] < b[3] && o.type !== 'model' && o.type !== 'image')) this.drawEl(ctx, o);
    }
    return c.toDataURL('image/png');
  }

  /** Mehrere Elemente (ohne 3D-Modelle) als ein PNG: Skizzen und Bilder als Referenz für den Prompt. */
  snapshotMany(ids: number[], max = 1024): string | null {
    const list = this.els.filter((e) => ids.includes(e.id) && e.type !== 'model');
    if (!list.length) return null;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const e of list) { const r = bbox(e); a = Math.min(a, r[0]); b = Math.min(b, r[1]); c = Math.max(c, r[2]); d = Math.max(d, r[3]); }
    const pad = 12, bw = c - a + pad * 2, bh = d - b + pad * 2;
    const s = Math.min(max / bw, max / bh, 2);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bw * s)); cv.height = Math.max(1, Math.round(bh * s));
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, (pad - a) * s, (pad - b) * s);
    for (const e of list) this.drawEl(ctx, e);
    return cv.toDataURL('image/png');
  }

  // ---------- Auswahl ----------
  private setSel(list: El[], primary: El | null = list[list.length - 1] ?? null) {
    const same = list.length === this.selSet.length && list.every((e, i) => e === this.selSet[i]);
    this.selSet = list;
    this.sel = primary;
    this.dirty = true;
    if (!same) this.onSel?.(list.map((e) => e.id));
  }

  select(ids: number[]) { this.setSel(ids.map((i) => this.byId(i)).filter((e): e is El => !!e)); }

  private pruneSel() {
    const list = this.selSet.filter((e) => this.els.includes(e));
    if (list.length !== this.selSet.length) this.setSel(list, this.sel && this.els.includes(this.sel) ? this.sel : list[0] ?? null);
  }

  // ---------- Eingabe ----------
  private pos(e: PointerEvent | MouseEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private press(e: PointerEvent) {
    if (!this.pressure) return 1;
    return e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.8;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.pos(e);
    if (e.altKey && this.hover?.type === 'model') { this.viewer.dolly(this.hover.ms, Math.exp(e.deltaY * 0.002)); this.dirty = true; this.onChange?.(); return; }
    const mouseWheel = e.deltaX === 0 && (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50) && !e.ctrlKey;
    if (e.ctrlKey || e.metaKey || mouseWheel) this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { this.cam.x += e.deltaX / this.cam.z; this.cam.y += e.deltaY / this.cam.z; this.dirty = true; }
  }

  private topHit(w: Pt, tol: number, solid = true, filter?: (e: El) => boolean) {
    for (let i = this.els.length - 1; i >= 0; i--) {
      const e = this.els[i];
      if ((!filter || filter(e)) && hit(e, w.x, w.y, tol, solid)) return e;
    }
    return null;
  }

  // ---------- 3D direkt auf dem Canvas ----------
  private zone(m: Boxy, p: Pt): 'corner' | 'border' | 'inside' {
    const c = this.cam, lx = p.x - (m.x - c.x) * c.z, ly = p.y - (m.y - c.y) * c.z, sw = m.w * c.z, sh = m.h * c.z;
    // Anfasser an allen vier Ecken (gezeichnet 5 px außerhalb des Elements)
    const R = 11;
    for (const [k, cx, cy] of [['nw', -5, -5], ['ne', sw + 5, -5], ['sw', -5, sh + 5], ['se', sw + 5, sh + 5]] as const) {
      if (Math.abs(lx - cx) < R && Math.abs(ly - cy) < R) { this.corner = k; return 'corner'; }
    }
    if (lx < 10 || ly < 10 || lx > sw - 10 || ly > sh - 10) return 'border';
    return 'inside';
  }

  /** Liegt der Bildschirmpunkt auf dem Modell selbst (nicht auf leerem Hintergrund der Box)? */
  private onModel(m: ModelEl, p: Pt) {
    const c = this.cam, lx = p.x - (m.x - c.x) * c.z, ly = p.y - (m.y - c.y) * c.z;
    return !!this.viewer.pick(m.ms, (lx / (m.w * c.z)) * 2 - 1, -(ly / (m.h * c.z)) * 2 + 1);
  }

  private startResize(el: Boxy) {
    this.mode = 'resize';
    this.resizeFrom = { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  /** Teil anklicken. Mit Umschalt/Strg/Cmd (oder Mehrfachmodus) kommt das Teil zur Auswahl dazu bzw. fällt heraus. */
  private select3d(m: ModelEl, obj: any, add: boolean) {
    this.viewer.nameParts(m.ms);
    if (this.active !== m) { this.activeObjs = []; }
    this.active = m;
    this.activeObjs = add ? (this.activeObjs.includes(obj) ? this.activeObjs.filter((o) => o !== obj) : [...this.activeObjs, obj]) : [obj];
    if (!this.activeObjs.length) { this.deselect3d(); return; }
    this.onObj?.(true);
    this.onPart?.(this.partRef());
    this.refreshHighlight();
  }

  deselect3d() {
    const m = this.active;
    if (!m) return;
    this.active = null;
    this.activeObjs = [];
    this.pickNames = [];
    this.viewer.highlight(m.ms, new Set());
    this.onObj?.(false);
    this.onPart?.(null);
    this.dirty = true;
  }

  private selectDown(e: PointerEvent, w: Pt, p: Pt) {
    this.moved = false;
    this.downPt = p;
    this.lastScr = p;
    this.last = w;
    this.moveTot = { x: 0, y: 0 };
    const one = this.selSet.length === 1 ? this.selSet[0] : null;
    if ((one?.type === 'model' || one?.type === 'image') && !e.shiftKey && this.zone(one, p) === 'corner') { this.sel = one; this.startResize(one); return; }
    const el = this.topHit(w, 6 / this.cam.z);
    if (this.active && this.active !== el) this.deselect3d();
    if (!el) {
      if (!e.shiftKey) this.setSel([]);
      this.marquee = { a: w, b: w, add: e.shiftKey };
      this.mode = 'marquee';
      return;
    }
    const partShift = (e.shiftKey || e.ctrlKey || e.metaKey) && el.type === 'model' && this.selSet.length === 1 && this.selSet[0] === el && this.zone(el, p) === 'inside';
    if (e.shiftKey && !partShift) {
      const has = this.selSet.includes(el);
      this.setSel(has ? this.selSet.filter((x) => x !== el) : [...this.selSet, el], has ? null : el);
      this.mode = 'none';
      return;
    }
    if (!this.selSet.includes(el)) this.setSel([el], el);
    else this.sel = el;
    if (el.type === 'image') {
      if (this.selSet.length === 1 && this.zone(el, p) === 'corner') this.startResize(el); else this.mode = 'move';
      return;
    }
    if (el.type !== 'model') { this.mode = 'move'; return; }
    const z = this.zone(el, p);
    if (z === 'corner') { this.startResize(el); return; }
    // Rand oder leerer Hintergrund in der Box = verschieben; auf dem Modell = drehen (Klick = Teil wählen)
    if (z === 'border' || !this.onModel(el, p)) { this.mode = 'move'; return; }
    this.pickAdd = e.shiftKey || e.ctrlKey || e.metaKey || this.multiPart;
    this.mode = 'orbit';
  }

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = this.pos(e);
    if (e.pointerType === 'touch') {
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size >= 2) { this.cur = null; this.imgErase = null; this.mode = 'pinch'; this.initPinch(); return; }
      // Ein Finger: Zeichen-/Aktionswerkzeuge arbeiten wie die Maus, Hand/Auswahl verschieben die Ansicht
      if (this.tool === 'hand' || this.tool === 'select') { this.mode = 'pan'; this.last = p; return; }
    }
    if (e.button === 1 || this.space || this.tool === 'hand') { this.mode = 'pan'; this.last = p; return; }
    if (e.button !== 0) return;
    const w = this.toWorld(p);
    switch (this.tool) {
      case 'pen': case 'magic': {
        const mg = this.tool === 'magic';
        const s: Stroke = { type: 'stroke', id: this.newId(), op: mg ? 100 : this.opacity, pts: [w.x, w.y, this.press(e)], color: mg ? '#7c5cff' : this.color, width: mg ? Math.max(1.5, Math.min(12, 3.5 / this.cam.z)) : this.width, fill: null, ox: 0, oy: 0, path: null, fp: null, bb: [0, 0, 0, 0] };
        this.cur = s; this.mode = 'draw'; break;
      }
      case 'rect': case 'ellipse': case 'diamond': case 'line': case 'arrow':
        this.cur = { type: this.tool, id: this.newId(), op: this.opacity, x: w.x, y: w.y, w: 0, h: 0, color: this.color, width: this.width, fill: this.tool === 'line' || this.tool === 'arrow' ? null : this.fillColor };
        this.mode = 'draw'; break;
      case 'text': case 'note':
        this.onTextRequest?.({ wx: w.x, wy: w.y, sx: p.x, sy: p.y, note: this.tool === 'note' });
        break;
      case 'comment': {
        const el = this.topHit(w, 4 / this.cam.z);
        const b = el ? bbox(el) : null;
        const u = b ? (w.x - b[0]) / (b[2] - b[0] || 1) : 0, v = b ? (w.y - b[1]) / (b[3] - b[1] || 1) : 0;
        const a: CommentAnchor = { elId: el?.id ?? null, u, v, wx: w.x, wy: w.y };
        if (el?.type === 'model') {
          const h = this.viewer.hitInfo(el.ms, u * 2 - 1, -(v * 2 - 1), el.w / el.h);
          if (h) { a.part = h.part; a.uv = h.uv; a.p = h.p; }
        }
        this.onComment?.(a);
        break;
      }
      case 'imgErase': {
        const el = this.topHit(w, 0, true, (x) => x.type === 'image') as ImageEl | null;
        if (el) { this.imgErase = { el, before: copyCanvas(el.cv), last: w }; this.mode = 'imgErase'; this.eraseImage(w); }
        break;
      }
      case 'select': this.selectDown(e, w, p); break;
      case 'eraser': this.mode = 'erase'; this.erased = []; this.eraseAt(w); break;
      case 'bucket': {
        for (let i = this.els.length - 1; i >= 0; i--) {
          const el = this.els[i];
          if ((el.type === 'stroke' || el.type === 'rect' || el.type === 'ellipse' || el.type === 'diamond') && fillable(el, w.x, w.y)) {
            const old = el.fill, nw = this.fillColor;
            el.fill = nw;
            this.push({ undo: () => { el.fill = old; this.dirty = true; }, redo: () => { el.fill = nw; this.dirty = true; } });
            break;
          }
        }
        break;
      }
    }
    this.dirty = true;
  }

  private brushR() { return 16 / this.cam.z; }

  private eraseImage(w: Pt) {
    const st = this.imgErase!, el = st.el, sx = el.cv.width / el.w, sy = el.cv.height / el.h;
    const ctx = el.cv.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineWidth = this.brushR() * 2 * sx;
    ctx.beginPath();
    ctx.moveTo((st.last.x - el.x) * sx, (st.last.y - el.y) * sy);
    ctx.lineTo((w.x - el.x) * sx + 0.01, (w.y - el.y) * sy);
    ctx.stroke();
    ctx.restore();
    st.last = w;
    this.dirty = true;
  }

  private initPinch() {
    const [a, b] = [...this.ptrs.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private onMove(e: PointerEvent) {
    const p = this.pos(e);
    this.ptrScr = p;
    if (this.tool === 'imgErase') this.dirty = true;
    if (this.mode === 'pinch' && this.ptrs.has(e.pointerId)) {
      this.ptrs.set(e.pointerId, p);
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.cam.x -= (cx - this.pinch.cx) / this.cam.z;
      this.cam.y -= (cy - this.pinch.cy) / this.cam.z;
      this.zoomAt(cx, cy, d / this.pinch.d);
      this.pinch = { d, cx, cy };
      return;
    }
    if (this.mode === 'pan') {
      this.cam.x -= (p.x - this.last.x) / this.cam.z;
      this.cam.y -= (p.y - this.last.y) / this.cam.z;
      this.last = p; this.dirty = true;
      return;
    }
    const w = this.toWorld(p);
    if (this.mode === 'imgErase') { this.eraseImage(w); return; }
    if (this.mode === 'marquee' && this.marquee) { this.marquee.b = w; this.dirty = true; return; }
    if (this.mode === 'orbit' && this.sel?.type === 'model') {
      if (Math.hypot(p.x - this.downPt.x, p.y - this.downPt.y) > 4) this.moved = true;
      this.viewer.orbit(this.sel.ms, p.x - this.lastScr.x, p.y - this.lastScr.y);
      this.lastScr = p;
      this.dirty = true;
      return;
    }
    if (this.mode === 'resize' && (this.sel?.type === 'model' || this.sel?.type === 'image')) {
      const el = this.sel, f = this.resizeFrom, k = this.corner;
      // Gegenüberliegende Ecke bleibt fest, Seitenverhältnis bleibt (Umschalt = frei bei 3D-Modellen)
      const ax = k === 'nw' || k === 'sw' ? f.x + f.w : f.x, ay = k === 'nw' || k === 'ne' ? f.y + f.h : f.y;
      let nw = Math.max(40, Math.abs(w.x - ax)), nh = Math.max(40, Math.abs(w.y - ay));
      if (!(e.shiftKey && el.type === 'model')) { const r = f.h / f.w; if (nh / nw > r) nw = nh / r; else nh = nw * r; }
      el.w = nw; el.h = nh;
      el.x = ax === f.x ? f.x : ax - nw;
      el.y = ay === f.y ? f.y : ay - nh;
      if (el.type === 'model') el.ms.dirty = true;
      this.dirty = true;
      return;
    }
    if (this.mode === 'none' && this.tool === 'select' && e.buttons === 0) { this.hoverAt(e, p, w); return; }
    if (this.mode === 'draw' && this.cur) {
      if (this.cur.type === 'stroke') {
        const s = this.cur, min = 1.2 / this.cam.z;
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
          const q = this.toWorld(this.pos(ev));
          const n = s.pts.length;
          if (Math.hypot(q.x - s.pts[n - 3], q.y - s.pts[n - 2]) >= min) s.pts.push(q.x, q.y, this.press(ev));
        }
        s.path = null;
      } else {
        this.cur.w = w.x - this.cur.x; this.cur.h = w.y - this.cur.y;
        if (e.shiftKey && this.cur.type !== 'line' && this.cur.type !== 'arrow') {
          const m = Math.max(Math.abs(this.cur.w), Math.abs(this.cur.h));
          this.cur.w = Math.sign(this.cur.w || 1) * m; this.cur.h = Math.sign(this.cur.h || 1) * m;
        }
      }
      this.dirty = true;
    } else if (this.mode === 'move' && this.selSet.length) {
      const dx = w.x - this.last.x, dy = w.y - this.last.y;
      for (const el of this.selSet) this.move(el, dx, dy);
      this.moveTot.x += dx; this.moveTot.y += dy; this.last = w;
      this.dirty = true;
    } else if (this.mode === 'erase') { this.eraseAt(w); this.dirty = true; }
  }

  private hoverAt(e: PointerEvent, p: Pt, w: Pt) {
    const el = this.topHit(w, 6 / this.cam.z);
    if (el !== this.hover) { this.hover = el; this.dirty = true; }
    let cur = 'default';
    const one = this.selSet.length === 1 ? this.selSet[0] : null;
    const cornerCur = () => (this.corner === 'nw' || this.corner === 'se' ? 'nwse-resize' : 'nesw-resize');
    if ((one?.type === 'model' || one?.type === 'image') && this.zone(one, p) === 'corner') cur = cornerCur();
    else if (el?.type === 'model') {
      const z = this.zone(el, p);
      if (z === 'border' || z === 'corner') cur = 'move';
      else {
        // Auf dem Modell = drehen (grab), leerer Hintergrund = verschieben; Raycast gedrosselt
        const now = performance.now();
        if (now - this.hoverPickT > 40) { this.hoverPickT = now; this.canvas.dataset.onModel = this.onModel(el, p) ? '1' : ''; }
        cur = this.canvas.dataset.onModel ? 'grab' : 'move';
      }
    } else if (el?.type === 'image') cur = 'move';
    else if (el) cur = 'move';
    this.canvas.style.cursor = cur;
  }

  private onUp(e: PointerEvent) {
    this.ptrs.delete(e.pointerId);
    if (this.mode === 'pinch') { if (this.ptrs.size < 2) this.mode = 'none'; return; }
    if (this.mode === 'orbit' && this.sel?.type === 'model' && !this.moved) {
      const m = this.sel, c = this.cam;
      const lx = this.downPt.x - (m.x - c.x) * c.z, ly = this.downPt.y - (m.y - c.y) * c.z;
      const obj = this.viewer.pick(m.ms, (lx / (m.w * c.z)) * 2 - 1, -(ly / (m.h * c.z)) * 2 + 1);
      if (obj) this.select3d(m, obj, this.pickAdd); else if (!this.pickAdd) this.deselect3d();
    } else if (this.mode === 'orbit' && this.sel?.type === 'model') {
      this.onChange?.(); // Endstand der Drehung synchronisieren
    } else if (this.mode === 'resize' && (this.sel?.type === 'model' || this.sel?.type === 'image')) {
      const m = this.sel, from = { ...this.resizeFrom }, to = { x: m.x, y: m.y, w: m.w, h: m.h };
      if (from.w !== to.w || from.h !== to.h) this.push({ undo: () => this.setBox(m, from), redo: () => this.setBox(m, to) });
    } else if (this.mode === 'marquee' && this.marquee) {
      const { a, b, add } = this.marquee;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if ((x1 - x0) * this.cam.z > 3 || (y1 - y0) * this.cam.z > 3) {
        const inside = this.els.filter((el) => { const r = bbox(el); return r[0] >= x0 && r[2] <= x1 && r[1] >= y0 && r[3] <= y1; });
        this.setSel(add ? [...this.selSet, ...inside.filter((el) => !this.selSet.includes(el))] : inside);
      }
      this.marquee = null;
    } else if (this.mode === 'imgErase' && this.imgErase) {
      const { el, before } = this.imgErase, after = copyCanvas(el.cv);
      el.rev++;
      this.push({ undo: () => this.paintCanvas(el, before), redo: () => this.paintCanvas(el, after) });
      this.imgErase = null;
    }
    if (this.mode === 'draw' && this.cur) {
      const c = this.cur;
      if (c.type === 'stroke') {
        if (c.pts.length === 3) c.pts.push(c.pts[0] + 0.01, c.pts[1], c.pts[2]);
        strokeBB(c);
        this.addEl(c);
        if (this.tool === 'magic') { this.magic.push(c); this.onMagic?.(this.magicStrokes().length); }
      } else if (Math.abs(c.w) > 3 || Math.abs(c.h) > 3) {
        this.addEl(c);
        if (!this.lock && SHAPE_TOOLS.includes(this.tool)) { this.setSel([c]); this.onTool?.('select'); }
      }
      this.cur = null;
    } else if (this.mode === 'move' && this.selSet.length && (this.moveTot.x || this.moveTot.y)) {
      const list = this.selSet.slice(), t = { ...this.moveTot };
      this.push({ undo: () => list.forEach((el) => this.move(el, -t.x, -t.y)), redo: () => list.forEach((el) => this.move(el, t.x, t.y)) });
    } else if (this.mode === 'erase' && this.erased.length) {
      const list = this.erased.slice().sort((a, b) => a.idx - b.idx);
      this.push({
        undo: () => { for (const r of list) this.restore(r.el, r.idx); },
        redo: () => { for (const r of list) this.drop(r.el); },
      });
      this.pruneSel();
    }
    this.mode = 'none';
    this.dirty = true;
  }

  private paintCanvas(el: ImageEl, src: HTMLCanvasElement) {
    const ctx = el.cv.getContext('2d')!;
    ctx.clearRect(0, 0, el.cv.width, el.cv.height);
    ctx.drawImage(src, 0, 0);
    el.rev++;
    this.dirty = true;
  }

  private setBox(el: Boxy, b: { x: number; y: number; w: number; h: number }) {
    el.x = b.x; el.y = b.y;
    this.setSize(el, b.w, b.h);
    this.onChange?.();
  }

  private setSize(el: Boxy, w: number, h: number) {
    el.w = w; el.h = h;
    if (el.type === 'model') el.ms.dirty = true;
    this.dirty = true;
  }

  private async onDrop(e: DragEvent) {
    e.preventDefault();
    const w = this.toWorld(this.pos(e));
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (MODEL_EXT.test(f.name)) await this.addModelFile(f, w);
      else if (f.type.startsWith('image/')) await this.addImage(f, w);
    }
  }

  private onPaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); this.addImage(f); }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    // Eingaben und die Prompt-Leiste samt Rückfrage-Chat behalten ihre Tasten (Esc, Pfeile, Enter).
    if (t?.closest?.('input, textarea, [contenteditable="true"], [data-promptbar]')) return;
    const k0 = e.key.toLowerCase();
    if (k0 === 'escape') { this.deselect3d(); this.setSel([]); if (this.tool !== 'select') this.onTool?.('select'); return; }
    if (this.active && this.activeObjs.length && !e.ctrlKey && !e.metaKey && (k0 === 'delete' || k0 === 'backspace')) { e.preventDefault(); this.deleteSelectedParts(); return; }
    if (e.code === 'Space') { this.space = true; e.preventDefault(); }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); this.setSel(this.els.slice()); return; }
    if ((k === 'delete' || k === 'backspace') && this.selSet.length) { this.removeEls(this.selSet.slice()); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'i') { this.onImagePick?.(); return; }
    const map: Record<string, Tool> = { v: 'select', 1: 'select', h: 'hand', p: 'pen', e: 'eraser', r: 'rect', d: 'diamond', o: 'ellipse', a: 'arrow', l: 'line', t: 'text', n: 'note', c: 'comment', g: 'bucket', x: 'imgErase' };
    if (map[k]) this.onTool?.(map[k]);
  }

  // ---------- Elemente / Undo ----------
  private move(e: El, dx: number, dy: number) {
    if (e.type === 'stroke') { e.ox += dx; e.oy += dy; } else { e.x += dx; e.y += dy; }
    this.dirty = true;
  }

  /** Entfernt ein Element, falls (noch) vorhanden – fremde Clients können es schon gelöscht haben. */
  private drop(el: El) { const i = this.els.indexOf(el); if (i >= 0) this.els.splice(i, 1); }

  /** Fügt ein Element wieder ein, falls es nicht schon da ist. */
  private restore(el: El, idx: number) { if (!this.els.includes(el)) this.els.splice(Math.min(idx, this.els.length), 0, el); }

  private push(op: Op) { this.undoS.push(op); this.redoS = []; this.dirty = true; this.onChange?.(); }

  private addEl(el: El) {
    this.els.push(el);
    this.push({ undo: () => { this.drop(el); this.pruneSel(); }, redo: () => { if (!this.els.includes(el)) this.els.push(el); } });
  }

  private removeEls(list: El[]) {
    const recs = list.map((el) => ({ el, idx: this.els.indexOf(el) })).filter((r) => r.idx >= 0).sort((a, b) => a.idx - b.idx);
    if (!recs.length) return;
    for (const r of recs.slice().reverse()) this.els.splice(r.idx, 1);
    this.pruneSel();
    this.push({
      undo: () => { for (const r of recs) this.restore(r.el, r.idx); },
      redo: () => { for (const r of recs) this.drop(r.el); this.pruneSel(); },
    });
  }

  deleteSelection() { this.removeEls(this.selSet.slice()); }

  private eraseAt(w: Pt) {
    for (let i = this.els.length - 1; i >= 0; i--) {
      if (hit(this.els[i], w.x, w.y, 8 / this.cam.z, false)) {
        this.erased.push({ el: this.els[i], idx: i });
        this.els.splice(i, 1);
      }
    }
  }

  undo() { const o = this.undoS.pop(); if (o) { o.undo(); this.redoS.push(o); this.dirty = true; this.pruneSel(); this.onChange?.(); } }
  redo() { const o = this.redoS.pop(); if (o) { o.redo(); this.undoS.push(o); this.dirty = true; this.pruneSel(); this.onChange?.(); } }

  clear() { this.els = []; this.setSel([]); this.undoS = []; this.redoS = []; this.dirty = true; }

  // ---------- Text & Notizen ----------
  addText(wx: number, wy: number, text: string, note: boolean) {
    const size = 20, m = measureText(text, size), pad = note ? NOTE_PAD : 0;
    const el: TextEl = { type: 'text', id: this.newId(), op: this.opacity, x: wx, y: wy, w: Math.max(m.w + pad * 2, note ? 160 : 0), h: Math.max(m.h + pad * 2, note ? 110 : 0), text, color: this.color, size, note: note ? '#fff3bf' : null };
    this.addEl(el);
    this.setSel([el]);
  }

  // ---------- Bilder ----------
  async addImage(f: Blob, at?: Pt) {
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();
    const c = at ?? this.toWorld({ x: this.W / 2, y: this.H / 2 });
    const w = Math.min(cv.width, 520 / this.cam.z), h = (w * cv.height) / cv.width;
    const el: ImageEl = { type: 'image', id: this.newId(), x: c.x - w / 2, y: c.y - h / 2, w, h, cv, label: `Image ${this.countType('image') + 1}`, rev: 0 };
    this.addEl(el);
    this.setSel([el]);
    this.onTool?.('select');
    return el.id;
  }

  /** Hintergrund des Bildes entfernen (rückgängig machbar). */
  removeBg(id: number) {
    const el = this.byId(id);
    if (el?.type !== 'image') return false;
    const before = copyCanvas(el.cv);
    if (!removeBackground(el.cv)) return false;
    el.rev++;
    const after = copyCanvas(el.cv);
    this.push({ undo: () => this.paintCanvas(el, before), redo: () => this.paintCanvas(el, after) });
    this.dirty = true;
    return true;
  }

  /** Größe ändern: Faktor relativ zur aktuellen Größe oder 'orig' (1 Bildpixel = 1 Welteinheit). */
  resizeEl(id: number, f: number | 'orig') {
    const el = this.byId(id);
    if (el?.type !== 'image' && el?.type !== 'model') return;
    const from = { w: el.w, h: el.h };
    const to = f === 'orig' && el.type === 'image' ? { w: el.cv.width, h: el.cv.height } : { w: el.w * (f === 'orig' ? 1 : f), h: el.h * (f === 'orig' ? 1 : f) };
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const apply = (s: { w: number; h: number }) => { el.x = cx - s.w / 2; el.y = cy - s.h / 2; this.setSize(el, s.w, s.h); };
    apply(to);
    this.push({ undo: () => apply(from), redo: () => apply(to) });
  }

  // ---------- Magic Pen ----------
  /** Noch vorhandene (nicht rückgängig gemachte) Magic-Striche. */
  magicStrokes() { return this.magic.filter((s) => this.els.includes(s)); }

  /** Skizze als quadratisches PNG (schwarz auf transparent) + Umriss in Weltkoordinaten. */
  magicSketch(): { png: Promise<Blob>; box: number[] } | null {
    const list = this.magicStrokes();
    if (!list.length) return null;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of list) { const b = bbox(s); box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]); }
    const side = Math.max(box[2] - box[0], box[3] - box[1], 8) * 1.2, PX = 512, k = PX / side;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = PX;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, PX / 2 - cx * k, PX / 2 - cy * k);
    for (const s of list) this.drawEl(ctx, { ...s, color: '#000', op: 100, fill: null, width: side / 100, path: null, fp: null });
    return { png: new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png')), box };
  }

  /** Erzeugtes Mesh als 3D-Modell rechts neben der Skizze einfügen; die Magic-Striche gelten danach als erledigt. */
  async addMesh(V: number[], F: number[], box: number[]) {
    const ms = this.viewer.fromMesh(V, F);
    const glb = await this.viewer.toGLB(ms);
    const h = Math.max(200, Math.min(520, box[3] - box[1])), w = (h * 4) / 3;
    const m = this.addModelFrom(ms, box[2] + 40, (box[1] + box[3]) / 2 - h / 2, '', glb);
    m.w = w; m.h = h; m.label = `Magic Pen ${this.countType('model')}`;
    this.magic.length = 0;
    this.onMagic?.(0);
    this.setSel([m]);
    this.onChange?.();
    this.dirty = true;
    return m.id;
  }

  /** Magic-Striche verwerfen (aus der Zeichnung löschen). */
  discardMagic() {
    this.removeEls(this.magicStrokes());
    this.magic.length = 0;
    this.onMagic?.(0);
  }

  // ---------- 3D ----------
  private countType(t: ElType) { return this.els.reduce((n, e) => n + (e.type === t ? 1 : 0), 0); }

  private addModelFrom(ms: ModelScene, x: number, y: number, src: string, glb?: ArrayBuffer): ModelEl {
    // Box eng ums Modell: Seitenverhältnis der Silhouette, längste Seite 300 px (vorher fest 380 × 285 mit viel Rand)
    const { aspect, dist } = this.viewer.tightFrame(ms);
    ms.dist = dist;
    this.viewer.applyCam(ms);
    const S = 300, w = aspect >= 1 ? S : S * aspect, h = aspect >= 1 ? S / aspect : S;
    // x/y sind die linke obere Ecke der alten 380 × 285-Box → Mitte beibehalten
    const m: ModelEl = { type: 'model', id: this.newId(), x: x + (380 - w) / 2, y: y + (285 - h) / 2, w, h, ms, label: `3D model ${this.countType('model') + 1}`, src, glb };
    this.addEl(m);
    return m;
  }

  /** Aktuelle Teile eines Modells als GLB (Eingabe für den Prompt-Editor). */
  async exportModel(id: number): Promise<ArrayBuffer | null> {
    const e = this.byId(id);
    return e?.type === 'model' ? this.viewer.exportParts(e.ms) : null;
  }

  /**
   * Ersetzt den Inhalt eines Modells durch das Ergebnis einer Prompt-Änderung. Das Element (ID, Lage, Größe,
   * Kamera, Kommentare) bleibt dasselbe; nur Szene und Quelle wechseln. Die Sync-Schicht lädt das neue GLB hoch,
   * ein Undo stellt die alte Szene samt alter Quelle wieder her.
   */
  async replaceModel(id: number, glb: ArrayBuffer): Promise<number | null> {
    const el = this.byId(id);
    if (el?.type !== 'model') return null;
    const ms = await this.viewer.loadGLB(glb.slice(0));
    if (!this.els.includes(el)) return null; // inzwischen gelöscht
    ms.yaw = el.ms.yaw; ms.pitch = el.ms.pitch; ms.dist = el.ms.dist;
    this.viewer.applyCam(ms);
    if (this.active === el) this.deselect3d();
    if (el.src) el.ms.srcHash ??= el.src;
    const before = { ms: el.ms, glb: el.glb };
    const after = { ms, glb: glb as ArrayBuffer | undefined };
    const apply = (st: typeof before) => {
      if (this.active === el) this.deselect3d();
      // Kamera mitnehmen: der Nutzer hat ggf. gedreht, seit die Änderung lief
      st.ms.yaw = el.ms.yaw; st.ms.pitch = el.ms.pitch; st.ms.dist = el.ms.dist;
      this.viewer.applyCam(st.ms);
      el.ms = st.ms;
      // Quelle = Hash nach dem Upload (setzt die Sync-Schicht an der Szene); bis dahin das GLB selbst.
      el.src = st.ms.srcHash ?? '';
      el.glb = el.src ? undefined : st.glb;
      el.ms.dirty = true;
      this.dirty = true;
      this.onChange?.();
    };
    apply(after);
    this.setSel([el]);
    this.push({ undo: () => apply(before), redo: () => apply(after) });
    return el.id;
  }

  /** 3D-Datei laden (GLB/glTF direkt, OBJ/USD über den Prompt-Server) und als Modell einfügen. */
  async addModelFile(f: File, at?: Pt): Promise<number | null> {
    const w = at ?? this.toWorld({ x: this.W / 2, y: this.H / 2 });
    try {
      let buf: ArrayBuffer;
      if (/\.glb$/i.test(f.name)) buf = await f.arrayBuffer();
      else if (/\.gltf$/i.test(f.name)) {
        const text = await f.text();
        const j = JSON.parse(text);
        const external = [...(j.buffers ?? []), ...(j.images ?? [])].some((x: any) => typeof x.uri === 'string' && !x.uri.startsWith('data:'));
        if (external) throw new Error('This glTF file references external files. Please export it as GLB.');
        buf = new TextEncoder().encode(text).buffer as ArrayBuffer;
      } else if (MODEL_EXT.test(f.name)) {
        if (!this.convertModel) throw new Error('OBJ and USD need the prompt server for conversion.');
        buf = await this.convertModel(f);
      } else throw new Error(`Format not supported: ${f.name}`);
      const ms = await this.viewer.loadGLB(buf.slice(0));
      const glb = /\.glb$/i.test(f.name) || !/\.gltf$/i.test(f.name) ? buf : await this.viewer.exportParts(ms);
      const m = this.addModelFrom(ms, w.x - 190, w.y - 142, '', glb);
      m.label = f.name.replace(/\.[^.]+$/, '').slice(0, 40) || m.label;
      this.setSel([m]);
      this.onTool?.('select');
      return m.id;
    } catch (err) {
      this.onError?.('Could not load the file', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** Merkt sich das KI-Studio-Projekt eines Modells (für „Im Studio bearbeiten“). */
  setModelStudio(id: number, project: string) {
    const e = this.byId(id);
    if (e?.type !== 'model') return;
    e.studio = project;
    this.onChange?.();
  }
  modelStudio(id: number) { const e = this.byId(id); return e?.type === 'model' ? e.studio ?? null : null; }

  addModel(x?: number, y?: number) {
    const w = this.toWorld({ x: this.W / 2, y: this.H / 2 });
    const seed = (this.nextId * 7 + (this.idBase % 97)) % 1000;
    return this.addModelFrom(this.viewer.demo(seed), x ?? w.x - 180, y ?? w.y - 135, `demo:${seed}`);
  }

  // ---------- Rendering ----------
  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.lastT) this.fps = this.fps * 0.9 + (1000 / (t - this.lastT)) * 0.1;
    this.lastT = t;
    if (this.dirty || this.continuous) {
      this.dirty = false;
      const t0 = performance.now();
      this.draw();
      this.drawMs = this.drawMs * 0.8 + (performance.now() - t0) * 0.2;
      this.onFrame?.();
    }
  };

  private drawEl(ctx: CanvasRenderingContext2D, e: El) {
    if (e.type === 'model') {
      const px = Math.max(96, Math.min(1280, Math.round((e.w * this.cam.z * this.dpr) / 32) * 32));
      ctx.drawImage(this.viewer.render(e.ms, e.w / e.h, px), e.x, e.y, e.w, e.h);
      return;
    }
    if (e.type === 'image') {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(e.cv, e.x, e.y, e.w, e.h);
      return;
    }
    if (e.type === 'stroke') {
      const off = e.ox || e.oy;
      ctx.globalAlpha = e.op / 100;
      if (off) { ctx.save(); ctx.translate(e.ox, e.oy); }
      if (e.fill && isClosed(e)) { ctx.fillStyle = e.fill; ctx.fill((e.fp ??= polyPath(e))); }
      ctx.fillStyle = e.color;
      ctx.fill((e.path ??= buildPath(e)));
      if (off) ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = e.op / 100;
    if (e.type === 'text') {
      const pad = e.note ? NOTE_PAD : 0;
      if (e.note) {
        ctx.save();
        ctx.shadowColor = 'rgba(60,50,0,0.16)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
        ctx.fillStyle = e.note;
        ctx.beginPath(); ctx.roundRect(e.x, e.y, e.w, e.h, 6); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = e.color;
      ctx.font = `${e.size}px ${TEXT_FONT}`;
      ctx.textBaseline = 'top';
      e.text.split('\n').forEach((l, i) => ctx.fillText(l, e.x + pad, e.y + pad + i * e.size * 1.3 + e.size * 0.12));
      ctx.globalAlpha = 1;
      return;
    }
    ctx.lineWidth = e.width;
    ctx.strokeStyle = e.color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (e.type === 'rect') ctx.roundRect(Math.min(e.x, e.x + e.w), Math.min(e.y, e.y + e.h), Math.abs(e.w), Math.abs(e.h), Math.min(8, Math.abs(e.w) / 4, Math.abs(e.h) / 4));
    else if (e.type === 'ellipse') ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, Math.abs(e.w / 2), Math.abs(e.h / 2), 0, 0, 7);
    else if (e.type === 'diamond') { const p = diamondPts(bbox(e)); ctx.moveTo(p[0], p[1]); for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); }
    else {
      const x2 = e.x + e.w, y2 = e.y + e.h;
      ctx.moveTo(e.x, e.y); ctx.lineTo(x2, y2);
      if (e.type === 'arrow') {
        const a = Math.atan2(e.h, e.w), L = Math.min(Math.hypot(e.w, e.h) * 0.35, 12 + e.width * 3);
        for (const s of [-1, 1]) { ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a + s * 0.5), y2 - L * Math.sin(a + s * 0.5)); }
      }
    }
    if (e.fill && e.type !== 'line' && e.type !== 'arrow') { ctx.fillStyle = e.fill; ctx.fill(); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private draw() {
    const { ctx, cam: c, dpr, W, H } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Punktraster
    let step = 24;
    while (step * c.z < 14) step *= 2;
    const s = step * c.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#c4c4ce';
    const ox = (Math.ceil(c.x / step) * step - c.x) * c.z, oy = (Math.ceil(c.y / step) * step - c.y) * c.z;
    for (let x = ox; x < W; x += s) for (let y = oy; y < H; y += s) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    // Welt
    ctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);
    const x1 = c.x + W / c.z, y1 = c.y + H / c.z;
    let vis = 0;
    for (const e of this.els) {
      const b = bbox(e);
      if (b[2] < c.x || b[0] > x1 || b[3] < c.y || b[1] > y1) continue;
      if ((b[2] - b[0]) * c.z < 0.6 && (b[3] - b[1]) * c.z < 0.6) continue;
      vis++;
      this.drawEl(ctx, e);
    }
    this.visible = vis;
    if (this.cur) this.drawEl(ctx, this.cur);
    this.onOverlay?.(ctx, c.z);
    // Auswahl
    const pad = 5 / c.z;
    for (const el of this.selSet) {
      if (!this.els.includes(el)) continue;
      const b = bbox(el);
      ctx.strokeStyle = 'rgba(105,101,219,0.6)';
      ctx.lineWidth = 1.25 / c.z;
      ctx.beginPath();
      ctx.roundRect(b[0] - pad, b[1] - pad, b[2] - b[0] + pad * 2, b[3] - b[1] + pad * 2, 6 / c.z);
      ctx.stroke();
    }
    if (this.tool === 'select' && this.hover && !this.selSet.includes(this.hover) && this.els.includes(this.hover)) {
      const b = bbox(this.hover);
      ctx.strokeStyle = 'rgba(105,101,219,0.25)';
      ctx.lineWidth = 1 / c.z;
      ctx.beginPath();
      ctx.roundRect(b[0] - pad, b[1] - pad, b[2] - b[0] + pad * 2, b[3] - b[1] + pad * 2, 6 / c.z);
      ctx.stroke();
    }
    const one = this.selSet.length === 1 ? this.selSet[0] : null;
    if ((one?.type === 'model' || one?.type === 'image') && this.els.includes(one)) {
      const b = bbox(one), h = 10 / c.z;
      ctx.save();
      ctx.shadowColor = 'rgba(40,40,90,0.3)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(105,101,219,0.8)';
      ctx.lineWidth = 1.25 / c.z;
      const pd = 5 / c.z;
      for (const [x, y] of [[b[0] - pd, b[1] - pd], [b[2] + pd, b[1] - pd], [b[0] - pd, b[3] + pd], [b[2] + pd, b[3] + pd]]) {
        ctx.beginPath();
        ctx.roundRect(x - h / 2, y - h / 2, h, h, 2.5 / c.z);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.marquee) {
      const { a, b } = this.marquee;
      ctx.fillStyle = 'rgba(105,101,219,0.06)';
      ctx.strokeStyle = 'rgba(105,101,219,0.7)';
      ctx.lineWidth = 1 / c.z;
      ctx.setLineDash([4 / c.z, 3 / c.z]);
      ctx.beginPath(); ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.tool === 'imgErase' && this.ptrScr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(this.ptrScr.x, this.ptrScr.y, 16, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (this.tool !== 'select') this.canvas.style.cursor = this.space || this.tool === 'hand' ? 'grab' : this.tool === 'bucket' ? 'cell' : this.tool === 'imgErase' ? 'none' : this.tool === 'text' || this.tool === 'note' ? 'text' : 'crosshair';
  }
}

export const COLORS = PALETTE;
export const BG_COLORS = BG_PALETTE;
