// Zeichenfläche des KI-Studios (512² logische Pixel = Bildkoordinaten des Backends).
// Striche sind Vektoren; Radierstriche (erase) löschen nur Striche, nie das unterlegte Bild.
// v = Projektversion, mit der der Strich ins Modell kam (0 = Grundskizze); v > Projektversion = „neu“.
// id/o: stabile ID und Reihenfolge für den Live-Sync (mehrere Personen zeichnen gleichzeitig, nichts geht verloren).
export type Stroke = { w: number; c: string; pts: [number, number][]; v?: number; part?: string; erase?: boolean; id?: string; o?: number };
/** Andere Personen im Studio: Strich in Arbeit + Zeiger. */
export type RemotePen = { name: string; color: string; live: Stroke[] | null; hover: [number, number] | null };
export type PadTool = 'pen' | 'eraser' | 'select' | 'line' | 'rect' | 'ellipse';
const SHAPES: PadTool[] = ['line', 'rect', 'ellipse'];

/** Form als Polylinie (so landet sie wie ein Strich beim Backend). */
function shapePts(t: PadTool, a: [number, number], b: [number, number], square: boolean): [number, number][] {
  let [x1, y1] = b;
  if (square && t !== 'line') { const d = Math.max(Math.abs(x1 - a[0]), Math.abs(y1 - a[1])); x1 = a[0] + Math.sign(x1 - a[0] || 1) * d; y1 = a[1] + Math.sign(y1 - a[1] || 1) * d; }
  if (t === 'line') return [a, [x1, y1]];
  if (t === 'rect') return [a, [x1, a[1]], [x1, y1], [a[0], y1], a];
  const cx = (a[0] + x1) / 2, cy = (a[1] + y1) / 2, rx = Math.abs(x1 - a[0]) / 2, ry = Math.abs(y1 - a[1]) / 2;
  return Array.from({ length: 65 }, (_, i) => { const t2 = (i / 64) * Math.PI * 2; return [cx + rx * Math.cos(t2), cy + ry * Math.sin(t2)] as [number, number]; });
}
export const N = 512;

export class Pad {
  strokes: Stroke[] = [];
  redoStack: Stroke[][] = [];
  version: number | null = null; // Projektversion, null = noch kein Modell
  tool: PadTool = 'pen';
  color = '#000000';
  width = 6;
  mirror = false;
  /** n-zählige Drehsymmetrie um die Mitte (Seestern: 5); 0 = aus */
  radial = 0;
  /** Vorlage (nur Hilfslinien zum Nachzeichnen, nicht Teil der Skizze) */
  guide: [number, number][][] | null = null;
  underlay: HTMLImageElement | null = null;
  showSketch = false;
  overlays: HTMLCanvasElement[] = [];
  onStrokeEnd?: (kind: 'pen' | 'erase', strokes: Stroke[]) => void;
  onLasso?: (poly: [number, number][]) => void;
  onClick?: (x: number, y: number, add: boolean) => void;
  onChange?: () => void;
  /** Strich in Arbeit / Zeiger bewegt (für den Live-Sync, gedrosselt beim Aufrufer) */
  onLive?: () => void;
  remote: RemotePen[] = [];
  idPrefix = Math.random().toString(36).slice(2, 7);
  private seq = 0;

  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private cur: Stroke[] | null = null;
  private lasso: [number, number][] | null = null;
  private hover: [number, number] | null = null;
  private downAt: [number, number] | null = null;
  private shapeFrom: [number, number] | null = null;
  private raf = 0;

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = cv.height = N * dpr;
    this.layer.width = this.layer.height = N * dpr;
    cv.addEventListener('pointerdown', this.down);
    cv.addEventListener('pointermove', this.move);
    cv.addEventListener('pointerup', this.up);
    cv.addEventListener('pointercancel', this.up);
    cv.addEventListener('pointerleave', this.leave);
    this.draw();
  }

  private leave = () => { this.hover = null; this.onLive?.(); this.draw(); };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cv.removeEventListener('pointerdown', this.down);
    this.cv.removeEventListener('pointermove', this.move);
    this.cv.removeEventListener('pointerup', this.up);
    this.cv.removeEventListener('pointercancel', this.up);
    this.cv.removeEventListener('pointerleave', this.leave);
  }

  isNew = (s: Stroke) => this.version !== null && (s.v ?? 0) > this.version;
  newStrokes = () => this.strokes.filter((s) => this.isNew(s) && !s.erase);

  private pos(e: PointerEvent): [number, number] {
    const r = this.cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * N, ((e.clientY - r.top) / r.height) * N];
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }
    const p = this.pos(e);
    this.downAt = p;
    if (this.tool === 'select') { this.lasso = [p]; this.draw(); return; }
    const v = this.version === null ? 0 : this.version + 1;
    const erase = this.tool === 'eraser';
    const w = erase ? Math.max(this.width * 2, 12) : this.width;
    const s: Stroke = { w, c: erase ? '#ffffff' : this.color, pts: [p], v, erase: erase || undefined, ...this.stamp() };
    this.cur = [s];
    this.shapeFrom = SHAPES.includes(this.tool) ? p : null;
    for (const f of this.copies()) this.cur.push({ ...s, pts: [f(p)], ...this.stamp() });
    this.strokes.push(...this.cur);
    this.redoStack = [];
    this.draw();
  };

  private move = (e: PointerEvent) => {
    const p = this.pos(e);
    this.hover = p;
    this.onLive?.();
    if (this.lasso) this.lasso.push(p);
    else if (this.cur && this.shapeFrom) {
      this.cur[0].pts = shapePts(this.tool, this.shapeFrom, p, e.shiftKey);
      this.copies().forEach((f, i) => { if (this.cur![i + 1]) this.cur![i + 1].pts = this.cur![0].pts.map(f); });
    } else if (this.cur) {
      this.cur[0].pts.push(p);
      this.copies().forEach((f, i) => this.cur![i + 1]?.pts.push(f(p)));
    }
    this.draw();
  };

  private up = (e: PointerEvent) => {
    const p = this.pos(e);
    if (this.lasso) {
      const poly = this.lasso;
      this.lasso = null;
      const d = this.downAt!;
      if (poly.length < 4 || Math.hypot(p[0] - d[0], p[1] - d[1]) + poly.length < 8) this.onClick?.(p[0], p[1], e.shiftKey);
      else this.onLasso?.(poly);
      this.draw();
      return;
    }
    if (!this.cur) return;
    const done = this.cur;
    this.cur = null;
    if (this.shapeFrom && done[0].pts.length < 2) { this.strokes.splice(this.strokes.length - done.length, done.length); this.shapeFrom = null; this.draw(); return; }
    this.shapeFrom = null;
    this.onLive?.();
    this.onStrokeEnd?.(done[0].erase ? 'erase' : 'pen', done);
    this.onChange?.();
    this.draw();
  };

  stamp() { return { id: `${this.idPrefix}-${(this.seq++).toString(36)}`, o: Date.now() + this.seq / 1000 }; }
  /** Strich in Arbeit (nicht im Dokument, nur flüchtig geteilt) und Zeigerposition. */
  live() { return { cur: this.cur, hover: this.hover }; }
  /** Striche von außen setzen (Live-Sync); ein gerade gezeichneter eigener Strich bleibt erhalten. */
  setStrokes(list: Stroke[]) {
    const mine = this.cur ?? [];
    const ids = new Set(mine.map((s) => s.id));
    this.strokes = [...list.filter((s) => !ids.has(s.id)), ...mine];
    this.draw();
  }

  /** Transformationen der Symmetriekopien (ohne das Original): Spiegel an der Mittelachse oder Drehung um die Mitte. */
  private copies(): ((p: [number, number]) => [number, number])[] {
    if (this.radial > 1) {
      return Array.from({ length: this.radial - 1 }, (_, i) => {
        const a = (2 * Math.PI * (i + 1)) / this.radial, co = Math.cos(a), si = Math.sin(a);
        return ([x, y]: [number, number]): [number, number] => [N / 2 + (x - N / 2) * co - (y - N / 2) * si, N / 2 + (x - N / 2) * si + (y - N / 2) * co];
      });
    }
    return this.mirror ? [([x, y]) => [N - x, y]] : [];
  }

  /** Letzten Strich (inkl. Spiegelstrich) zurück. Im Projekt nur neue Striche. */
  undo(): boolean {
    const last = this.strokes.at(-1);
    if (!last || (this.version !== null && !this.isNew(last))) return false;
    let n = 1;
    for (let i = this.copies().length; i > 0; i--) {
      const o = this.strokes.at(-n - 1);
      if (o && o.pts.length === last.pts.length && o.v === last.v && !o.erase === !last.erase) n++; else break;
    }
    this.redoStack.push(this.strokes.splice(-n));
    this.onChange?.();
    this.draw();
    return true;
  }
  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.strokes.push(...s);
    this.onChange?.();
    this.draw();
    return true;
  }

  draw = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint());
  };

  private paint() {
    const c = this.ctx, k = this.cv.width / N;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    const project = this.version !== null;
    if (project && this.underlay) c.drawImage(this.underlay, 0, 0, N, N);
    for (const o of this.overlays) c.drawImage(o, 0, 0, N, N);
    // Strich-Ebene (Radierstriche löschen hier nur Striche)
    const L = this.layer.getContext('2d')!;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, this.layer.width, this.layer.height);
    L.setTransform(k, 0, 0, k, 0, 0);
    const old = this.strokes.filter((s) => !this.isNew(s));
    if (!project || this.showSketch) drawStrokes(L, old);
    else drawStrokes(L, old.filter((s) => s.erase)); // nur damit Radierer konsistent bleiben
    drawStrokes(L, this.strokes.filter(this.isNew), true);
    c.globalAlpha = project && this.showSketch ? 0.5 : 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.layer, 0, 0);
    c.globalAlpha = 1;
    c.setTransform(k, 0, 0, k, 0, 0);
    // Radierstrich im Projekt sichtbar machen, solange er läuft
    if (project && this.cur?.[0].erase) {
      c.save();
      c.globalAlpha = 0.45;
      drawStrokes(c, this.cur.map((s) => ({ ...s, erase: undefined, c: '#ff3b6b' })));
      c.restore();
    }
    if (this.lasso) {
      c.save();
      c.setLineDash([5, 4]);
      c.strokeStyle = '#5b5bff';
      c.fillStyle = 'rgba(91,91,255,0.08)';
      c.lineWidth = 1.5;
      c.beginPath();
      this.lasso.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    if (this.guide && !project) {
      c.save();
      c.setLineDash([7, 6]);
      c.strokeStyle = 'rgba(91,91,255,0.55)';
      c.lineWidth = 2;
      c.lineJoin = 'round';
      for (const g of this.guide) {
        c.beginPath();
        g.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
      }
      c.restore();
    }
    if (this.mirror || this.radial > 1) {
      c.save();
      c.setLineDash([3, 6]);
      c.strokeStyle = 'rgba(91,91,255,0.25)';
      c.beginPath();
      if (this.radial > 1) {
        for (let i = 0; i < this.radial; i++) {
          const a = -Math.PI / 2 + (2 * Math.PI * i) / this.radial;
          c.moveTo(N / 2, N / 2); c.lineTo(N / 2 + Math.cos(a) * N, N / 2 + Math.sin(a) * N);
        }
      } else { c.moveTo(N / 2, 0); c.lineTo(N / 2, N); }
      c.stroke();
      c.restore();
    }
    // Andere Personen: Strich in Arbeit (in ihrer Farbe umrandet) und Zeiger mit Namen
    for (const r of this.remote) {
      if (r.live?.length) {
        c.save();
        if (project && r.live[0].erase) { c.globalAlpha = 0.45; drawStrokes(c, r.live.map((s) => ({ ...s, erase: undefined, c: '#ff3b6b' }))); }
        else if (!r.live[0].erase) drawStrokes(c, r.live, project);
        c.restore();
      }
      if (r.hover) {
        const [x, y] = r.hover;
        c.save();
        c.fillStyle = r.color;
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3, y + 13); c.lineTo(x + 6.5, y + 8.5); c.lineTo(x + 12, y + 8); c.closePath();
        c.fill(); c.stroke();
        c.font = '600 10.5px system-ui, sans-serif';
        const tw = c.measureText(r.name).width;
        c.beginPath(); c.roundRect(x + 10, y + 13, tw + 10, 16, 8); c.fill();
        c.fillStyle = '#fff';
        c.fillText(r.name, x + 15, y + 24.5);
        c.restore();
      }
    }
    if (this.hover && this.tool !== 'select') {
      const r = (this.tool === 'eraser' ? Math.max(this.width * 2, 12) : this.width) / 2;
      c.save();
      c.strokeStyle = this.tool === 'eraser' ? '#ff3b6b' : 'rgba(0,0,0,0.35)';
      c.lineWidth = 1;
      c.beginPath(); c.arc(this.hover[0], this.hover[1], Math.max(r, 1.5), 0, Math.PI * 2);
      // Zeiger in der gewählten Farbe gefüllt → man sieht immer, womit man gerade malt
      if (this.tool !== 'eraser') { c.globalAlpha = 0.55; c.fillStyle = this.color; c.fill(); c.globalAlpha = 1; }
      c.stroke();
      c.restore();
    }
  }

  /** Striche als PNG (512²). white = weißer Grund (Skizze), sonst transparent (neue Striche / Maske). */
  png(list: Stroke[], white: boolean, solid?: string): Promise<Blob> {
    const o = document.createElement('canvas');
    o.width = o.height = N;
    const c = o.getContext('2d')!;
    if (white) { c.fillStyle = '#fff'; c.fillRect(0, 0, N, N); }
    drawStrokes(c, solid ? list.map((s) => ({ ...s, c: solid, erase: undefined })) : list, false, !white);
    return new Promise((r) => o.toBlob((b) => r(b!), 'image/png'));
  }
}

export function drawStrokes(c: CanvasRenderingContext2D, list: Stroke[], glow = false, eraseTransparent = true) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const s of list) {
    c.save();
    if (s.erase) {
      if (eraseTransparent) c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = '#fff';
    } else {
      if (glow) { c.shadowColor = '#ff7a00'; c.shadowBlur = 8; }
      c.strokeStyle = s.c;
    }
    c.lineWidth = s.w;
    c.beginPath();
    s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (s.pts.length === 1) c.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    c.stroke();
    c.restore();
  }
}

/** Polygon → Maske als PNG (weiß/deckend = innen). */
export function polyMask(poly: [number, number][]): Promise<Blob> {
  const o = document.createElement('canvas');
  o.width = o.height = N;
  const c = o.getContext('2d')!;
  c.fillStyle = '#fff';
  c.beginPath();
  poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
  return new Promise((r) => o.toBlob((b) => r(b!), 'image/png'));
}

export function inPoly(x: number, y: number, poly: [number, number][]) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** Weiße Maske (Bild) → halbtransparent eingefärbtes Overlay. */
export function tint(img: CanvasImageSource, col: string, alpha = 90): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = o.height = N;
  const c = o.getContext('2d')!;
  c.drawImage(img, 0, 0, N, N);
  const d = c.getImageData(0, 0, N, N);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
  for (let i = 0; i < d.data.length; i += 4) {
    const on = d.data[i] > 127 && d.data[i + 3] > 20;
    d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = on ? alpha : 0;
  }
  c.putImageData(d, 0, 0);
  return o;
}

/** Bild-Maske → Bool-Array 512² (für Klick-Auswahl von Segmenten). */
export function maskBits(img: CanvasImageSource): Uint8Array {
  const o = document.createElement('canvas');
  o.width = o.height = N;
  const c = o.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, 0, 0, N, N);
  const d = c.getImageData(0, 0, N, N).data;
  const out = new Uint8Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] > 127 ? 1 : 0;
  return out;
}

const cache = new Map<string, Promise<HTMLImageElement>>();
export function loadImg(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => { cache.delete(src); rej(new Error(`Image not loaded: ${src}`)); };
      im.src = src;
    });
    cache.set(src, p);
  }
  return p;
}
