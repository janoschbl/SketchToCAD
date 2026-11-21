/**
 * Kompakte Binärkodierung für Strich-Punkte [x, y, druck, x, y, druck, …].
 *
 * Format: varint n | int8 k | u8 druckModus | Punkte
 *  - Raster = 2^-k Welteinheiten, aus dem Punktabstand des Strichs gewählt
 *    (≈ 1/8 Abstand), damit auch bei starkem Zoom gezeichnete Striche exakt bleiben.
 *  - x/y als Zickzack-Varint-Deltas zum Vorgänger → typisch 1 Byte je Koordinate.
 *  - Druck: Modus 0 = konstant (1 Byte für alle), Modus 1 = Delta je Punkt (0..255).
 * Ergebnis: ~2–3 Byte pro Punkt statt ~25 Byte als JSON.
 */

class W {
  buf = new Uint8Array(64);
  n = 0;
  byte(b: number) {
    if (this.n === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf[this.n++] = b;
  }
  uvar(v: number) { while (v > 127) { this.byte((v & 127) | 128); v = Math.floor(v / 128); } this.byte(v); }
  svar(v: number) { this.uvar(v >= 0 ? v * 2 : -v * 2 - 1); }
  done() { return this.buf.slice(0, this.n); }
}

class R {
  i = 0;
  constructor(private b: Uint8Array) {}
  byte() { return this.b[this.i++]; }
  uvar() { let v = 0, m = 1, c: number; do { c = this.b[this.i++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  svar() { const u = this.uvar(); return u % 2 ? -(u + 1) / 2 : u / 2; }
}

function pickK(pts: number[]) {
  const d: number[] = [];
  for (let i = 3; i < pts.length; i += 3) { const s = Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2]); if (s > 0) d.push(s); }
  if (!d.length) return 4;
  d.sort((a, b) => a - b);
  const step = d[d.length >> 1] / 8;
  return Math.max(-4, Math.min(16, Math.round(-Math.log2(step))));
}

export function encodePts(pts: number[]): Uint8Array {
  const n = pts.length / 3, k = pickK(pts), s = 2 ** k, w = new W();
  w.uvar(n); w.byte(k & 255);
  const p0 = pts[2];
  let constP = true;
  for (let i = 5; i < pts.length; i += 3) if (pts[i] !== p0) { constP = false; break; }
  w.byte(constP ? 0 : 1);
  if (constP) w.byte(Math.round(p0 * 255));
  let px = 0, py = 0, pp = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const x = Math.round(pts[i] * s), y = Math.round(pts[i + 1] * s);
    w.svar(x - px); w.svar(y - py); px = x; py = y;
    if (!constP) { const p = Math.round(pts[i + 2] * 255); w.svar(p - pp); pp = p; }
  }
  return w.done();
}

export function decodePts(b: Uint8Array): number[] {
  const r = new R(b), n = r.uvar(), k = (r.byte() << 24) >> 24, s = 2 ** -k, constP = r.byte() === 0;
  const p0 = constP ? r.byte() / 255 : 0;
  const out = new Array<number>(n * 3);
  let x = 0, y = 0, p = 0;
  for (let i = 0; i < n; i++) {
    x += r.svar(); y += r.svar();
    if (!constP) p += r.svar();
    out[i * 3] = x * s; out[i * 3 + 1] = y * s; out[i * 3 + 2] = constP ? p0 : p / 255;
  }
  return out;
}

/** Festkomma für Positionen/Größen: 1/100 Welteinheit → Yjs speichert Ganzzahlen als Varint statt float64. */
export const q = (v: number) => Math.round(v * 100);
export const dq = (v: number) => v / 100;
