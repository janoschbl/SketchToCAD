import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { makeRevealUniforms, patchReveal, type RevealUniforms } from './reveal';
import type { Sfx, Sparks } from './fx';

export type Edge = [THREE.Vector3, THREE.Vector3];
const V = THREE.Vector3;

/** Rote Tinte – der Magic Pen von MeshPad erwartet rote Striche, also skizziert auch das Dorf rot. */
export const INK = new THREE.Color('#ff4b2b');

export interface SketchObj {
  id: string;
  label?: string;
  group: THREE.Group;
  center: THREE.Vector3;
  state: 'hidden' | 'active' | 'done' | 'gone';
  u: RevealUniforms;
  minY: number;
  maxY: number;
  strokes?: number;
}

// ---------------------------------------------------------------- Kanten → Skizze

const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
function edgesGeo(g: THREE.BufferGeometry) {
  let e = edgeCache.get(g);
  if (!e) { e = new THREE.EdgesGeometry(g, 28); edgeCache.set(g, e); }
  return e;
}

/** Kanten eines (gebackenen) Objekts in Weltkoordinaten – das, was man mit dem Stift zeichnen würde. */
export function edgesOf(root: THREE.Object3D): Edge[] {
  root.updateWorldMatrix(true, true);
  const out: Edge[] = [];
  const push = (geo: THREE.BufferGeometry, m: THREE.Matrix4) => {
    const p = edgesGeo(geo).attributes.position;
    for (let i = 0; i < p.count; i += 2) {
      const a = new V().fromBufferAttribute(p, i).applyMatrix4(m);
      const b = new V().fromBufferAttribute(p, i + 1).applyMatrix4(m);
      if (a.distanceToSquared(b) > 1e-6) out.push([a, b]);
    }
  };
  const tmp = new THREE.Matrix4();
  for (const s of (root.userData.ink ?? []) as { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[]) push(s.geo, tmp.multiplyMatrices(root.matrixWorld, s.m));
  for (const mesh of (root.userData.live ?? []) as THREE.Mesh[]) push(mesh.geometry, mesh.matrixWorld);
  return out;
}

export interface SketchPlan { segs: Float32Array; keys: Float32Array; count: number; edges: number }

/**
 * Handgezeichnete Skizze: jede Kante wird zu einem leicht wackligen Strich mit Überschwinger.
 * Alle Striche wachsen GLEICHZEITIG (sortiert nach "Zeichen-Zeitpunkt"), grob von unten nach oben –
 * wie das Wireframe, das sich bei igloo.inc zusammenzieht, nur in Stift-Optik.
 */
export function buildSketch(edges: Edge[], sequential = false): SketchPlan {
  if (sequential) edges = penOrder(edges);
  let tCursor = 0;
  const penPos = edges.length ? edges[0][0].clone() : new V();
  let minY = Infinity, maxY = -Infinity;
  for (const [a, b] of edges) { minY = Math.min(minY, a.y, b.y); maxY = Math.max(maxY, a.y, b.y); }
  const hY = Math.max(0.5, maxY - minY);
  const tmpSegs: number[] = [], tmpKeys: number[] = [];
  const dir = new V(), perp = new V(), perp2 = new V(), up = new V(0, 1, 0), p = new V(), q = new V(), a2 = new V(), b2 = new V();
  const point = (out: THREE.Vector3, u: number, amp: number, f: number, ph: number, ph2: number) => {
    out.lerpVectors(a2, b2, u);
    const w1 = amp * (Math.sin(u * Math.PI * f + ph) * 0.7 + Math.sin(u * Math.PI * f * 2.3 + ph2) * 0.3);
    return out.addScaledVector(perp, w1).addScaledVector(perp2, amp * 0.6 * Math.sin(u * Math.PI * f * 1.3 + ph2));
  };
  for (const [a0, b0] of edges) {
    // parallel: immer von unten nach oben; sequenziell: so, wie der Pinsel sie der Reihe nach zieht
    const [a, b] = sequential || a0.y <= b0.y ? [a0, b0] : [b0, a0];
    dir.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.divideScalar(len);
    perp.crossVectors(dir, Math.abs(dir.y) > 0.9 ? new V(1, 0, 0) : up).normalize();
    perp2.crossVectors(dir, perp).normalize();
    const over = Math.min(0.14, len * 0.08);
    a2.copy(a).addScaledVector(dir, -over * Math.random());
    b2.copy(b).addScaledVector(dir, over * (0.4 + Math.random()));
    const amp = Math.min(0.045, len * 0.025);
    const f = 1 + Math.random() * 1.5, ph = Math.random() * 6.28, ph2 = Math.random() * 6.28;
    const steps = Math.max(2, Math.ceil(len / 0.12));
    let start = ((a.y - minY) / hY) * 0.45 + Math.random() * 0.15;
    let span = 0.25 + Math.random() * 0.2;
    if (sequential) {
      // Zeit = Strichlänge + ein Stück "Luftweg" des Pinsels zum nächsten Strich
      tCursor += Math.min(1.2, penPos.distanceTo(a)) * 0.35;
      start = tCursor; span = len; tCursor += len;
      penPos.copy(b);
    }
    point(p, 0, amp, f, ph, ph2);
    for (let s = 1; s <= steps; s++) {
      point(q, s / steps, amp, f, ph, ph2);
      tmpSegs.push(p.x, p.y, p.z, q.x, q.y, q.z);
      tmpKeys.push(start + span * (s / steps));
      p.copy(q);
    }
  }
  const n = tmpKeys.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => tmpKeys[x] - tmpKeys[y]);
  const segs = new Float32Array(n * 6), keys = new Float32Array(n);
  const maxKey = n ? tmpKeys[order[n - 1]] : 1;
  order.forEach((src, i) => {
    for (let k = 0; k < 6; k++) segs[i * 6 + k] = tmpSegs[src * 6 + k];
    keys[i] = tmpKeys[src] / maxKey;
  });
  return { segs, keys, count: n, edges: edges.length };
}

/** Greedy-Reihenfolge: immer der nächstgelegene Strich, so dass der Pinsel kaum springt. */
function penOrder(edges: Edge[]): Edge[] {
  const left = edges.slice();
  left.sort((x, y) => Math.min(x[0].y, x[1].y) - Math.min(y[0].y, y[1].y));
  const out: Edge[] = [];
  let pen = left.length ? left[0][0].clone() : new V();
  while (left.length) {
    let bi = 0, flip = false, bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const [a, b] = left[i];
      // leicht bevorzugt: unten bleiben, dann nach oben arbeiten
      const da = a.distanceToSquared(pen) + a.y * 0.15, db = b.distanceToSquared(pen) + b.y * 0.15;
      if (da < bd) { bd = da; bi = i; flip = false; }
      if (db < bd) { bd = db; bi = i; flip = true; }
    }
    const [a, b] = left.splice(bi, 1)[0];
    const e: Edge = flip ? [b, a] : [a, b];
    out.push(e);
    pen = e[1];
  }
  return out;
}

function upperBound(arr: Float32Array, t: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

function makeInk(plan: SketchPlan, width = 2.6) {
  const g = new LineSegmentsGeometry();
  g.setPositions(plan.segs);
  g.instanceCount = 0;
  const m = new LineMaterial({ linewidth: width, transparent: true, depthWrite: false, worldUnits: false });
  m.color = INK.clone().multiplyScalar(1.3);
  const l = new LineSegments2(g, m);
  l.frustumCulled = false;
  l.renderOrder = 5;
  return l;
}

// ---------------------------------------------------------------- Generator

export interface Timing {
  sketch: number;  // Skizze wächst
  solid0: number;  // Modell beginnt zu materialisieren
  solid: number;   // Dauer Materialisieren
  fade0: number;   // Tinte verblasst ab
  fade: number;
}
export const FAST: Timing = { sketch: 0.7, solid0: 0.5, solid: 0.85, fade0: 1.15, fade: 0.55 };

interface Opts { timing?: Timing; sequential?: boolean; width?: number; /** nur die längsten N Kanten zeichnen (weniger Striche) */ maxEdges?: number; minLen?: number }
interface Running { obj: SketchObj; plan: SketchPlan; ink: LineSegments2; t: number; tm: Timing; seq: boolean; end: number }

/** Startet beliebig viele Objekte parallel: Skizze → Modell → Tinte verblasst. */
interface Dissolving { obj: SketchObj; plan: SketchPlan; ink: LineSegments2; t: number; dust?: Sparks }

export class Generator {
  private pending: { obj: SketchObj; opts: Opts }[] = [];
  private running: Running[] = [];
  private dissolving: Dissolving[] = [];
  onDone?: (o: SketchObj) => void;
  maxStartsPerFrame = 3;

  constructor(private scene: THREE.Scene, private sfx: Sfx, private sparks: Sparks) {}

  register(obj: SketchObj) {
    obj.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj.group);
    obj.minY = box.min.y; obj.maxY = box.max.y;
    obj.u = makeRevealUniforms(obj.minY - 0.05, '#ff8a4a', 0.5);
    obj.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = (m.material as THREE.Material).clone();
      patchReveal(m.material as THREE.Material, obj.u, 'height');
      m.userData.cast = m.castShadow;
      m.castShadow = false;
    });
  }

  start(obj: SketchObj, opts: Opts = {}) {
    if (obj.state !== 'hidden') return;
    obj.state = 'active';
    this.pending.push({ obj, opts });
  }

  /** Spitze des gerade gezeichneten Strichs (für den Pinsel), null wenn nicht (mehr) skizziert wird. */
  penTip(obj: SketchObj, out: THREE.Vector3): THREE.Vector3 | null {
    const r = this.running.find((x) => x.obj === obj);
    if (!r) return null;
    const n = r.ink.geometry.instanceCount;
    if (n <= 0) { const s = r.plan.segs; return out.set(s[0], s[1], s[2]); }
    const i = Math.min(n, r.plan.count) - 1;
    return out.set(r.plan.segs[i * 6 + 3], r.plan.segs[i * 6 + 4], r.plan.segs[i * 6 + 5]);
  }

  /** 0…1 Fortschritt der Skizze eines laufenden Objekts (1 = fertig skizziert oder nicht gefunden). */
  sketchProgress(obj: SketchObj) {
    const r = this.running.find((x) => x.obj === obj);
    return r ? Math.min(1, r.t / r.tm.sketch) : 1;
  }

  get activeCount() { return this.running.length + this.pending.length; }

  /**
   * Rückwärts: fertiges Modell wird wieder zur Skizze (von oben nach unten), dann radiert sich die
   * Skizze mit Feenstaub weg. Am Ende ist das Objekt 'gone'.
   */
  dissolve(obj: SketchObj, delay = 0, dust?: Sparks) {
    if (obj.state === 'gone') return;
    obj.state = 'active';
    const plan = buildSketch(edgesOf(obj.group));
    const ink = makeInk(plan, 2.8);
    ink.geometry.instanceCount = plan.count;
    (ink.material as LineMaterial).opacity = 0;
    this.scene.add(ink);
    obj.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = false; });
    this.dissolving.push({ obj, plan, ink, t: -delay, dust });
  }

  private updateDissolve(dt: number) {
    const D = { inkIn: 0.22, solid0: 0.1, solid: 0.7, erase0: 0.75, erase: 0.75 };
    this.dissolving = this.dissolving.filter((r) => {
      r.t += dt;
      if (r.t < 0) return true;
      const o = r.obj, mat = r.ink.material as LineMaterial;
      // 1) Tinte taucht über dem Modell auf
      const kin = Math.min(1, r.t / D.inkIn);
      // 2) Modell löst sich von oben nach unten in die Skizze auf
      const kr = THREE.MathUtils.clamp((r.t - D.solid0) / D.solid, 0, 1);
      const e = kr < 0.5 ? 2 * kr * kr : 1 - Math.pow(-2 * kr + 2, 2) / 2;
      o.u.uReveal.value = THREE.MathUtils.lerp(o.maxY + 0.6, o.minY - 0.05, e);
      if (kr >= 1) o.group.visible = false;
      // 3) Skizze radiert sich rückwärts weg, an der Radierstelle sprüht Feenstaub
      const ke = THREE.MathUtils.clamp((r.t - D.erase0) / D.erase, 0, 1);
      const left = upperBound(r.plan.keys, 1 - ke * ke * (3 - 2 * ke));
      r.ink.geometry.instanceCount = left;
      mat.opacity = kin * (1 - THREE.MathUtils.smoothstep(ke, 0.75, 1));
      if (ke > 0 && ke < 1 && left > 0 && r.dust) {
        for (let k = 0; k < 2; k++) {
          const i = Math.max(0, left - 1 - Math.floor(Math.random() * Math.min(left, 60)));
          r.dust.emit(new V(r.plan.segs[i * 6 + 3], r.plan.segs[i * 6 + 4], r.plan.segs[i * 6 + 5]), 1, 0.15, 1.1, 0.9);
        }
      }
      if (ke >= 1) {
        o.state = 'gone';
        o.group.visible = false;
        this.scene.remove(r.ink);
        r.ink.geometry.dispose(); mat.dispose();
        return false;
      }
      return true;
    });
  }

  update(dt: number) {
    this.updateDissolve(dt);
    for (let k = 0; k < this.maxStartsPerFrame && this.pending.length; k++) {
      const { obj, opts } = this.pending.shift()!;
      const seq = !!opts.sequential;
      let edges = edgesOf(obj.group);
      if (opts.minLen) edges = edges.filter(([a, b]) => a.distanceTo(b) >= opts.minLen!);
      if (opts.maxEdges && edges.length > opts.maxEdges) edges = edges.sort((x, y) => y[0].distanceTo(y[1]) - x[0].distanceTo(x[1])).slice(0, opts.maxEdges);
      const plan = buildSketch(edges, seq);
      obj.strokes = plan.edges;
      const ink = makeInk(plan, opts.width);
      this.scene.add(ink);
      const tm = opts.timing ?? FAST;
      this.running.push({ obj, plan, ink, t: 0, tm, seq, end: Math.max(tm.solid0 + tm.solid, tm.fade0 + tm.fade) });
    }
    let sketching = 0;
    this.running = this.running.filter((r) => {
      r.t += dt;
      const o = r.obj;
      // 1) Skizze: alle Striche wachsen parallel
      const ks = Math.min(1, r.t / r.tm.sketch);
      const drawn = upperBound(r.plan.keys, r.seq ? ks * ks * (3 - 2 * ks) * 0.4 + ks * 0.6 : 1 - Math.pow(1 - ks, 2));
      r.ink.geometry.instanceCount = drawn;
      if (ks < 1) {
        sketching++;
        if (!r.seq && drawn > 0 && Math.random() < dt * 50) {
          const i = Math.max(0, drawn - 1 - Math.floor(Math.random() * Math.min(drawn, 40)));
          this.sparks.emit(new V(r.plan.segs[i * 6 + 3], r.plan.segs[i * 6 + 4], r.plan.segs[i * 6 + 5]), 1, 0.05, 0.5, 0.7);
        }
      }
      // 2) Modell materialisiert sich von unten mit glühender Front
      const kr = THREE.MathUtils.clamp((r.t - r.tm.solid0) / r.tm.solid, 0, 1);
      const e = kr < 0.5 ? 2 * kr * kr : 1 - Math.pow(-2 * kr + 2, 2) / 2;
      o.u.uReveal.value = THREE.MathUtils.lerp(o.minY - 0.05, o.maxY + 0.6, e);
      // 3) Tinte verblasst
      (r.ink.material as LineMaterial).opacity = 1 - THREE.MathUtils.clamp((r.t - r.tm.fade0) / r.tm.fade, 0, 1);
      if (r.t >= r.end) {
        o.state = 'done';
        o.u.uReveal.value = 1e4;
        o.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = !!m.userData.cast; });
        this.scene.remove(r.ink);
        r.ink.geometry.dispose(); (r.ink.material as LineMaterial).dispose();
        if (o.label) {
          this.sfx.pop(0.9 + Math.random() * 0.3);
        }
        this.onDone?.(o);
        return false;
      }
      return true;
    });
    this.sfx.drawing(Math.min(1, sketching * 0.45));
  }

  /** Alles Laufende abbrechen und Tinte entfernen (Intro überspringen). */
  skipAll() {
    for (const r of [...this.running, ...this.dissolving]) {
      this.scene.remove(r.ink);
      r.ink.geometry.dispose(); (r.ink.material as LineMaterial).dispose();
    }
    for (const r of this.dissolving) { r.obj.state = 'gone'; r.obj.group.visible = false; }
    for (const r of this.running) r.obj.state = 'hidden';
    for (const p of this.pending) p.obj.state = 'hidden';
    this.running = []; this.dissolving = []; this.pending = [];
    this.sfx.drawing(0);
  }

  /** Sofort fertig (Debug / "alles zeigen"). */
  finish(obj: SketchObj) {
    obj.state = 'done';
    obj.u.uReveal.value = 1e4;
    obj.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = !!m.userData.cast; });
    this.onDone?.(obj);
  }
}
