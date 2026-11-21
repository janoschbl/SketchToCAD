import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { bbox, strokeBB, type El, type Engine, type ImageEl, type ModelEl, type Shape, type Stroke } from '../engine';
import { decodePts, dq, encodePts, q } from './codec';
import type { Object3D } from 'three';
import type { ModelScene } from '../viewer';

/**
 * Live-Sync der Zeichenfläche.
 *
 * Drei Kanäle mit unterschiedlichem Datenprofil:
 *  1. Dokument (Yjs-CRDT, persistent): ein Y.Map je Element, es werden nur geänderte Felder
 *     übertragen. Positionen als Festkomma-Ganzzahlen, Striche binär (siehe codec.ts).
 *  2. Flüchtig (Hocuspocus-Stateless, nie gespeichert): Cursor + Strich/Form in Arbeit,
 *     gebündelt auf max. 30 Hz, Punkte inkrementell als Deltas.
 *  3. Presence (Yjs-Awareness): Name, Farbe, Auswahl – ändert sich selten.
 * Bilder und GLB-Modelle liegen inhaltsadressiert (sha256) als Blob auf dem Server;
 * im Dokument steht nur der Hash.
 */

export type SyncStatus = 'connecting' | 'connected' | 'offline';
export type Peer = { id: number; name: string; color: string; cursor: { x: number; y: number } | null; shown: { x: number; y: number } | null; sel: number[]; draft: Stroke | Shape | null; draftKey: number; draftK: number; draftLast: number[] };
export type SyncedComment = { id: string; n: number; anchor: { elId: number | null; u: number; v: number; wx: number; wy: number }; text: string; status: 'draft' | 'open' | 'sent' };

type Rec = Record<string, unknown>;
type DraftOp = (string | number | null)[];

const LOCAL = Symbol('local');
const TICK_MS = 33;
const PEER_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4'];
const ANIMALS = ['Fuchs', 'Dachs', 'Otter', 'Luchs', 'Biber', 'Falke', 'Igel', 'Wal', 'Uhu', 'Hase', 'Elch', 'Robbe'];

function myName() {
  try {
    const s = localStorage.getItem('stc-name');
    if (s) return s;
    const n = `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem('stc-name', n);
    return n;
  } catch { return 'Gast'; }
}

/** Lage eines 3D-Objekts (Position, Quaternion, Skalierung) als kompakter String. */
const trs = (o: Object3D) => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].map((v) => Math.round(v * 1e6) / 1e6).join(',');
function setTrs(o: Object3D, s: string) {
  const v = s.split(',').map(Number);
  if (v.length !== 10 || v.some((n) => !Number.isFinite(n))) return;
  o.position.set(v[0], v[1], v[2]); o.quaternion.set(v[3], v[4], v[5], v[6]); o.scale.set(v[7], v[8], v[9]);
}

const sameVal = (a: unknown, b: unknown) => a === b || (a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]));

export class CanvasSync {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  readonly yEls: Y.Map<Y.Map<unknown>>;
  readonly yComments: Y.Map<SyncedComment>;
  readonly peers = new Map<number, Peer>();
  status: SyncStatus = 'connecting';
  synced = false;
  readonly me: { name: string; color: string };

  onStatus?: (s: SyncStatus) => void;
  onPeers?: () => void;
  onComments?: (c: SyncedComment[]) => void;

  /** Zuletzt synchronisierter Stand je Element (verhindert Echos und erlaubt Feld-Diffs). */
  private cache = new Map<number, Rec>();
  private z = new Map<number, number>();
  private bytesOf = new WeakMap<number[], Uint8Array>();
  private uploadedRev = new WeakMap<ImageEl, number>();
  private uploading = new WeakSet<El>();
  /** Nach fehlgeschlagenem Upload erst später erneut versuchen (kein Dauerfeuer bei Server-Ausfall). */
  private retryAt = new WeakMap<El, number>();
  private loading = new Set<string>();
  private objs = new WeakMap<ModelScene, { list: Object3D[]; base: string[] }>();
  private timer: ReturnType<typeof setInterval>;
  private cleanup: (() => void)[] = [];
  // flüchtiger Kanal
  private ptr: { x: number; y: number } | null = null;
  private sentCursor = '';
  private draft: Stroke | Shape | null = null;
  private draftSent = 0;
  private draftK = 0;
  private draftLast = [0, 0, 0];
  private draftRect = '';

  constructor(private engine: Engine, private canvas: HTMLCanvasElement, room: string) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.yEls = this.doc.getMap('els');
    this.yComments = this.doc.getMap('comments');
    this.me = { name: myName(), color: PEER_COLORS[this.doc.clientID % PEER_COLORS.length] };
    // Element-IDs global eindeutig: clientID (32 Bit) · 2^20 + lokaler Zähler < 2^53
    engine.idBase = this.doc.clientID * 2 ** 20;

    this.provider = new HocuspocusProvider({
      url: `${proto}://${location.host}/sync`,
      name: `canvas:${room}`,
      document: this.doc,
      onStatus: ({ status }) => this.setStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'),
      onSynced: () => this.onFirstSync(),
      onStateless: ({ payload }) => this.onEphemeral(payload),
    });
    this.provider.setAwarenessField('u', this.me);
    this.provider.setAwarenessField('sel', []);

    this.yEls.observeDeep((evs, tr) => { if (tr.origin !== LOCAL) this.applyRemote(evs); });
    this.yComments.observe(() => this.onComments?.(this.comments()));
    this.provider.awareness?.on('change', () => this.onAwareness());

    const prevChange = engine.onChange, prevSel = engine.onSel;
    engine.onChange = () => { prevChange?.(); this.flush(); };
    engine.onSel = (ids) => { prevSel?.(ids); this.provider.setAwarenessField('sel', ids); };
    engine.onOverlay = (ctx, zoom) => this.drawPeers(ctx, zoom);
    this.cleanup.push(() => { engine.onChange = prevChange; engine.onSel = prevSel; engine.onOverlay = undefined; });

    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); this.ptr = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onLeave = () => { this.ptr = null; };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    this.cleanup.push(() => { canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); });

    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  destroy() {
    clearInterval(this.timer);
    this.cleanup.forEach((f) => f());
    this.provider.destroy();
    this.doc.destroy();
  }

  private setStatus(s: SyncStatus) { if (s !== this.status) { this.status = s; this.onStatus?.(s); } }

  private onFirstSync() {
    if (this.synced) return;
    this.synced = true;
    if (this.yEls.size === 0 && this.engine.els.length === 0) this.engine.seedDemo();
    this.flush();
    this.onComments?.(this.comments());
  }

  // ======================================================================
  // Dokument-Kanal: Engine → Yjs (Diff)
  // ======================================================================

  private toRec(e: El): Rec | null {
    const op = 'op' in e ? e.op : 100;
    switch (e.type) {
      case 'stroke': {
        let p = this.bytesOf.get(e.pts);
        if (!p) { p = encodePts(e.pts); this.bytesOf.set(e.pts, p); }
        return { t: 'stroke', p, c: e.color, sw: e.width, f: e.fill, ox: q(e.ox), oy: q(e.oy), op };
      }
      case 'text':
        return { t: 'text', x: q(e.x), y: q(e.y), w: q(e.w), h: q(e.h), s: e.text, c: e.color, sz: e.size, n: e.note, op };
      case 'image': {
        if (this.uploadedRev.get(e) !== e.rev) this.uploadImage(e);
        if (!e.blob) return null; // erst nach dem Upload anlegen
        return { t: 'image', x: q(e.x), y: q(e.y), w: q(e.w), h: q(e.h), b: e.blob, l: e.label, iw: e.cv.width, ih: e.cv.height };
      }
      case 'model':
        if (!e.src) { this.uploadModel(e); return null; }
        return { t: 'model', x: q(e.x), y: q(e.y), w: q(e.w), h: q(e.h), src: e.src, l: e.label, ...this.model3d(e.ms) };
      default:
        return { t: e.type, x: q(e.x), y: q(e.y), w: q(e.w), h: q(e.h), c: e.color, sw: e.width, f: e.fill, op };
    }
  }

  /**
   * 3D-Zustand eines Modells: Kamera (Drehung/Abstand) und nur die Objekte, die vom
   * Ausgangszustand abweichen (`o<i>` = Lage, '-' = gelöscht) – so bleibt der Datensatz klein.
   */
  private model3d(ms: ModelScene): Rec {
    const r: Rec = { cy: Math.round(ms.yaw * 1000), cp: Math.round(ms.pitch * 1000), cd: Math.round(ms.dist * 1000) };
    const { list, base } = this.objsOf(ms);
    list.forEach((o, i) => {
      if (!o.parent) r['o' + i] = '-';
      else { const t = trs(o); if (t !== base[i]) r['o' + i] = t; }
    });
    return r;
  }

  /** Objekte eines Modells in Ladereihenfolge – auf allen Clients gleich, dient als stabiler Schlüssel. */
  private objsOf(ms: ModelScene) {
    let o = this.objs.get(ms);
    if (!o) { const list = [...ms.root.children]; o = { list, base: list.map(trs) }; this.objs.set(ms, o); }
    return o;
  }

  private apply3d(el: ModelEl, r: Rec) {
    const ms = el.ms, e = this.engine;
    const mine = e.selection().includes(el.id);
    // nicht gegen die eigene laufende Geste ankämpfen
    if (!(mine && e.mode === 'orbit') && typeof r.cy === 'number') {
      ms.yaw = r.cy / 1000; ms.pitch = (r.cp as number) / 1000; ms.dist = (r.cd as number) / 1000;
      e.viewer.applyCam(ms);
    }
    const { list, base } = this.objsOf(ms);
    list.forEach((o, i) => {
      const v = r['o' + i] as string | undefined;
      if (v === '-') {
        if (!o.parent) return;
        if (e.partSelected(o)) e.deselect3d();
        o.removeFromParent();
        return;
      }
      if (!o.parent) ms.root.add(o);
      setTrs(o, v ?? base[i]);
    });
    e.viewer.refitIfResized(ms); // z. B. „Größe 10 cm“ auf einem anderen Gerät
    ms.dirty = true;
  }

  /** Ein anderer Client hat das Modell per Prompt geändert (gleiche ID, neue Quelle): Szene neu laden. */
  private swapModel(el: ModelEl, src: string) {
    el.src = src;
    this.loadModel(src).then((ms) => {
      if (el.src !== src) return; // inzwischen überholt
      ms.srcHash = src;
      ms.yaw = el.ms.yaw; ms.pitch = el.ms.pitch; ms.dist = el.ms.dist;
      if (this.engine.selection().includes(el.id)) this.engine.deselect3d();
      el.ms = ms;
      el.glb = undefined;
      const m = this.yEls.get(String(el.id));
      if (m) this.apply3d(el, this.readRec(m));
      this.engine.viewer.applyCam(ms);
      this.engine.refresh();
    }).catch((err) => console.warn(err));
  }

  /** z-Wert für ein neues Element an Position i – zwischen den Nachbarn mit bekanntem z. */
  private zFor(i: number) {
    const els = this.engine.els;
    let lo: number | undefined, hi: number | undefined;
    for (let j = i - 1; j >= 0 && lo === undefined; j--) lo = this.z.get(els[j].id);
    for (let j = i + 1; j < els.length && hi === undefined; j++) hi = this.z.get(els[j].id);
    if (lo !== undefined && hi !== undefined) return (lo + hi) / 2;
    if (lo !== undefined) return lo + 1;
    if (hi !== undefined) return hi - 1;
    return 0;
  }

  /**
   * Schreibt lokale Änderungen ins Yjs-Dokument – nur Felder, die sich seit dem letzten
   * Stand geändert haben. `only`: während einer Geste nur diese IDs prüfen (billig, 30 Hz).
   */
  flush(only?: number[]) {
    const els = this.engine.els;
    this.doc.transact(() => {
      const ids = only ? new Set(only) : null;
      const seen = new Set<number>();
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (ids && !ids.has(el.id)) continue;
        seen.add(el.id);
        const rec = this.toRec(el);
        if (!rec) continue;
        const key = String(el.id);
        const old = this.cache.get(el.id);
        if (!old) {
          const z = this.zFor(i);
          const m = new Y.Map<unknown>();
          for (const k in rec) m.set(k, rec[k]);
          m.set('z', z);
          this.yEls.set(key, m);
          this.z.set(el.id, z);
          this.cache.set(el.id, rec);
          continue;
        }
        const m = this.yEls.get(key);
        if (!m) continue;
        for (const k in rec) if (!sameVal(rec[k], old[k])) m.set(k, rec[k]);
        for (const k in old) if (!(k in rec)) m.delete(k);
        this.cache.set(el.id, rec);
      }
      if (!ids) for (const id of [...this.cache.keys()]) if (!seen.has(id)) {
        this.yEls.delete(String(id));
        this.cache.delete(id);
        this.z.delete(id);
      }
    }, LOCAL);
  }

  // ---------- Blobs ----------
  private async putBlob(body: Blob | ArrayBuffer, type: string): Promise<string> {
    const r = await fetch('/blobs', { method: 'POST', headers: { 'Content-Type': type }, body });
    if (!r.ok) throw new Error(`Blob-Upload fehlgeschlagen: ${r.status}`);
    return (await r.json()).hash;
  }

  private failed(el: El, err: unknown) {
    console.warn(err);
    this.retryAt.set(el, Date.now() + 5000);
    setTimeout(() => { if (this.engine.els.includes(el)) this.flush(); }, 5100);
  }

  private uploadImage(el: ImageEl) {
    if (this.uploading.has(el) || (this.retryAt.get(el) ?? 0) > Date.now()) return;
    this.uploading.add(el);
    const rev = el.rev;
    el.cv.toBlob(async (b) => {
      try {
        if (!b) { this.uploading.delete(el); return; }
        el.blob = await this.putBlob(b, b.type);
        this.uploadedRev.set(el, rev);
        this.uploading.delete(el);
        if (this.engine.els.includes(el)) this.flush();
      } catch (err) { this.uploading.delete(el); this.failed(el, err); }
    }, 'image/webp', 0.92);
  }

  private async uploadModel(el: ModelEl) {
    if (this.uploading.has(el) || !el.glb || (this.retryAt.get(el) ?? 0) > Date.now()) return;
    this.uploading.add(el);
    const ms = el.ms;
    try {
      const hash = await this.putBlob(el.glb, 'model/gltf-binary');
      ms.srcHash = hash;
      // Inzwischen per Undo/Redo eine andere Szene? Dann gehört der Hash nur zu `ms`.
      if (el.ms === ms) { el.src = hash; el.glb = undefined; }
      this.uploading.delete(el);
      if (this.engine.els.includes(el)) this.flush();
    } catch (err) { this.uploading.delete(el); this.failed(el, err); }
  }

  private async paintBlob(el: ImageEl, hash: string, iw: number, ih: number) {
    const r = await fetch(`/blobs/${hash}`);
    const bmp = await createImageBitmap(await r.blob());
    if (el.blob !== hash) { bmp.close(); return; } // inzwischen überholt
    el.cv.width = iw; el.cv.height = ih;
    const ctx = el.cv.getContext('2d')!;
    ctx.clearRect(0, 0, iw, ih);
    ctx.drawImage(bmp, 0, 0, iw, ih);
    bmp.close();
    this.engine.invalidate();
  }

  // ======================================================================
  // Dokument-Kanal: Yjs → Engine
  // ======================================================================

  private readRec(m: Y.Map<unknown>): Rec { const r: Rec = {}; m.forEach((v, k) => { if (k !== 'z') r[k] = v; }); return r; }

  private applyRemote(evs: Y.YEvent<any>[]) {
    const ids = new Set<string>();
    for (const ev of evs) {
      if (ev.target === this.yEls) ev.changes.keys.forEach((_, k) => ids.add(k));
      else if (ev.path.length) ids.add(String(ev.path[0]));
    }
    let order = false;
    for (const key of ids) {
      const id = Number(key), m = this.yEls.get(key);
      const el = this.engine.els.find((e) => e.id === id);
      if (!m) {
        if (el) this.engine.els.splice(this.engine.els.indexOf(el), 1);
        this.cache.delete(id); this.z.delete(id);
        continue;
      }
      const rec = this.readRec(m), z = m.get('z') as number;
      if (z !== this.z.get(id)) { this.z.set(id, z); order = true; }
      if (el) this.patch(el, rec);
      else { this.create(id, key, rec); continue; }
      this.cache.set(id, rec);
    }
    if (order) this.sort();
    this.engine.refresh();
  }

  private sort() {
    const zOf = (e: El) => this.z.get(e.id) ?? Infinity;
    this.engine.els.sort((a, b) => zOf(a) - zOf(b) || a.id - b.id);
  }

  private patch(el: El, r: Rec) {
    const o = el as any;
    if ('x' in r) { o.x = dq(r.x as number); o.y = dq(r.y as number); o.w = dq(r.w as number); o.h = dq(r.h as number); }
    if ('op' in r) o.op = r.op;
    switch (el.type) {
      case 'stroke':
        el.ox = dq(r.ox as number); el.oy = dq(r.oy as number);
        el.color = r.c as string; el.width = r.sw as number; el.fill = r.f as string | null;
        if (this.bytesOf.get(el.pts) !== r.p && !sameVal(this.bytesOf.get(el.pts), r.p)) this.setPts(el, r.p as Uint8Array);
        el.path = null; el.fp = null;
        break;
      case 'text': el.text = r.s as string; el.color = r.c as string; el.size = r.sz as number; el.note = r.n as string | null; break;
      case 'image':
        el.label = r.l as string;
        if (el.blob !== r.b) { el.blob = r.b as string; this.uploadedRev.set(el, el.rev); this.paintBlob(el, el.blob, r.iw as number, r.ih as number); }
        break;
      case 'model':
        el.label = r.l as string;
        if (typeof r.src === 'string' && r.src !== el.src) this.swapModel(el, r.src);
        else this.apply3d(el, r);
        break;
      default: el.color = r.c as string; el.width = r.sw as number; el.fill = r.f as string | null;
    }
  }

  private setPts(s: Stroke, p: Uint8Array) {
    s.pts = decodePts(p);
    this.bytesOf.set(s.pts, p);
    strokeBB(s);
  }

  private create(id: number, key: string, r: Rec) {
    const t = r.t as El['type'];
    if (t === 'stroke') {
      const s: Stroke = { type: 'stroke', id, op: 100, pts: [], color: '', width: 1, fill: null, ox: 0, oy: 0, path: null, fp: null, bb: [0, 0, 0, 0] };
      this.setPts(s, r.p as Uint8Array);
      this.insert(s, r);
    } else if (t === 'text') {
      this.insert({ type: 'text', id, op: 100, x: 0, y: 0, w: 0, h: 0, text: '', color: '', size: 20, note: null }, r);
    } else if (t === 'image') {
      const cv = document.createElement('canvas');
      cv.width = r.iw as number; cv.height = r.ih as number;
      const el: ImageEl = { type: 'image', id, x: 0, y: 0, w: 0, h: 0, cv, label: '', rev: 0 };
      this.uploadedRev.set(el, 0);
      this.insert(el, r);
    } else if (t === 'model') {
      if (this.loading.has(key)) return;
      this.loading.add(key);
      this.loadModel(r.src as string).then((ms) => {
        this.loading.delete(key);
        const m = this.yEls.get(key);
        if (!m || this.engine.els.some((e) => e.id === id)) return;
        this.insert({ type: 'model', id, x: 0, y: 0, w: 0, h: 0, ms, label: '', src: r.src as string }, this.readRec(m));
        this.sort();
        this.engine.refresh();
      }).catch((err) => { this.loading.delete(key); console.warn(err); });
    } else {
      this.insert({ type: t as Shape['type'], id, op: 100, x: 0, y: 0, w: 0, h: 0, color: '', width: 1, fill: null }, r);
    }
  }

  private insert(el: El, r: Rec) {
    this.patch(el, r);
    this.engine.els.push(el);
    this.cache.set(el.id, r);
  }

  private async loadModel(src: string) {
    if (src.startsWith('demo:')) return this.engine.viewer.demo(Number(src.slice(5)));
    const r = await fetch(`/blobs/${src}`);
    return this.engine.viewer.loadGLB(await r.arrayBuffer());
  }

  // ======================================================================
  // Kommentare
  // ======================================================================

  comments(): SyncedComment[] { return [...this.yComments.values()]; }

  /** Schreibt alle nicht-Entwurf-Kommentare; Entwürfe bleiben lokal. */
  setComments(list: SyncedComment[]) {
    const keep = list.filter((c) => c.status !== 'draft');
    this.doc.transact(() => {
      const ids = new Set(keep.map((c) => c.id));
      for (const id of [...this.yComments.keys()]) if (!ids.has(id)) this.yComments.delete(id);
      for (const c of keep) {
        const old = this.yComments.get(c.id);
        if (!old || JSON.stringify(old) !== JSON.stringify(c)) this.yComments.set(c.id, c);
      }
    }, LOCAL);
  }

  // ======================================================================
  // Flüchtiger Kanal: Cursor + Entwürfe (30 Hz, inkrementell)
  // ======================================================================

  private tick() {
    const e = this.engine;
    // laufende Verschiebung/Größenänderung live, aber nur für die betroffenen Elemente
    if (e.mode === 'move' || e.mode === 'resize' || e.mode === 'orbit') this.flush(e.selection());

    let cursor: number[] | 0 | null = null;
    const w = this.ptr ? e.screenToWorld(this.ptr.x, this.ptr.y) : null;
    const k = Math.ceil(Math.log2(e.cam.z * 2)); // ~0,5 Bildschirm-Pixel Genauigkeit
    const c = w ? [Math.round(w.x * 2 ** k), Math.round(w.y * 2 ** k), k] : 0;
    const cs = JSON.stringify(c);
    if (cs !== this.sentCursor) { this.sentCursor = cs; cursor = c; }

    const ops: DraftOp[] = [];
    const cur = e.cur;
    if (cur !== this.draft) {
      if (this.draft) ops.push(['e', this.draft.id]);
      this.draft = cur; this.draftSent = 0; this.draftRect = ''; this.draftLast = [0, 0, 0];
      if (cur) {
        this.draftK = k;
        ops.push(['s', cur.id, cur.type, cur.color, cur.width, cur.op, cur.fill, k]);
      }
    }
    if (cur?.type === 'stroke') {
      const n = cur.pts.length / 3;
      if (n > this.draftSent) {
        const s = 2 ** this.draftK, out: number[] = [];
        let [lx, ly, lp] = this.draftLast;
        for (let i = this.draftSent; i < n; i++) {
          const x = Math.round(cur.pts[i * 3] * s), y = Math.round(cur.pts[i * 3 + 1] * s), p = Math.round(cur.pts[i * 3 + 2] * 100);
          out.push(x - lx, y - ly, p - lp); lx = x; ly = y; lp = p;
        }
        ops.push(['p', cur.id, this.draftSent, ...out]);
        this.draftLast = [lx, ly, lp]; this.draftSent = n;
      }
    } else if (cur) {
      const s = 2 ** this.draftK, r = [cur.x, cur.y, cur.w, cur.h].map((v) => Math.round(v * s));
      const rs = r.join(',');
      if (rs !== this.draftRect) { this.draftRect = rs; ops.push(['r', cur.id, ...r]); }
    }

    if (cursor === null && !ops.length) return;
    if (this.status !== 'connected') return;
    this.provider.sendStateless(JSON.stringify(ops.length ? [this.doc.clientID, cursor, ops] : [this.doc.clientID, cursor]));
  }

  private peer(id: number): Peer {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, name: 'Gast', color: PEER_COLORS[id % PEER_COLORS.length], cursor: null, shown: null, sel: [], draft: null, draftKey: 0, draftK: 0, draftLast: [0, 0, 0] };
      this.peers.set(id, p);
    }
    return p;
  }

  private onEphemeral(payload: string) {
    let msg: [number, number[] | 0 | null, DraftOp[]?];
    try { msg = JSON.parse(payload); } catch { return; }
    const [id, c, ops] = msg;
    if (typeof id !== 'number' || id === this.doc.clientID) return;
    const known = this.peers.has(id), p = this.peer(id);
    if (c === 0) p.cursor = null;
    else if (Array.isArray(c)) { const s = 2 ** -c[2]; p.cursor = { x: c[0] * s, y: c[1] * s }; }
    for (const op of ops ?? []) this.applyDraftOp(p, op);
    this.engine.invalidate();
    // Cursor werden auf dem Canvas gezeichnet → React nur bei neuen Teilnehmern neu rendern
    if (!known) this.onPeers?.();
  }

  private applyDraftOp(p: Peer, op: DraftOp) {
    const [kind, key] = op as [string, number];
    if (kind === 's') {
      const [, , type, color, width, opac, fill, k] = op as [string, number, string, string, number, number, string | null, number];
      p.draftKey = key; p.draftK = k; p.draftLast = [0, 0, 0];
      p.draft = type === 'stroke'
        ? { type: 'stroke', id: key, op: opac, pts: [], color, width, fill: null, ox: 0, oy: 0, path: null, fp: null, bb: [0, 0, 0, 0] }
        : { type: type as Shape['type'], id: key, op: opac, x: 0, y: 0, w: 0, h: 0, color, width, fill };
      return;
    }
    if (key !== p.draftKey || !p.draft) return;
    if (kind === 'e') {
      // kurz stehen lassen, bis das Dokument-Update da ist (kein Flackern)
      const d = p.draft;
      setTimeout(() => { if (p.draft === d) { p.draft = null; this.engine.invalidate(); } }, 200);
      return;
    }
    const s = 2 ** -p.draftK;
    if (kind === 'p' && p.draft.type === 'stroke') {
      const i0 = op[2] as number, d = p.draft;
      if (i0 !== d.pts.length / 3) { p.draft = null; return; } // Lücke → verwerfen
      let [x, y, pr] = p.draftLast;
      for (let i = 3; i + 2 < op.length; i += 3) {
        x += op[i] as number; y += op[i + 1] as number; pr += op[i + 2] as number;
        d.pts.push(x * s, y * s, pr / 100);
      }
      p.draftLast = [x, y, pr];
      d.path = null;
    } else if (kind === 'r' && p.draft.type !== 'stroke') {
      const d = p.draft;
      d.x = (op[2] as number) * s; d.y = (op[3] as number) * s; d.w = (op[4] as number) * s; d.h = (op[5] as number) * s;
    }
  }

  // ======================================================================
  // Presence (Awareness)
  // ======================================================================

  private onAwareness() {
    const states = this.provider.awareness?.getStates();
    if (!states) return;
    for (const [id, st] of states) {
      if (id === this.doc.clientID) continue;
      const p = this.peer(id);
      if (st.u) { p.name = st.u.name; p.color = st.u.color; }
      p.sel = Array.isArray(st.sel) ? st.sel : [];
    }
    for (const id of [...this.peers.keys()]) if (!states.has(id)) this.peers.delete(id);
    this.engine.invalidate();
    this.onPeers?.();
  }

  /** Mauszeiger der anderen – direkt im Canvas (kein React-Render je Paket), weich nachgeführt. */
  private drawCursors(ctx: CanvasRenderingContext2D, zoom: number) {
    let moving = false;
    for (const p of this.peers.values()) {
      const c = p.cursor;
      if (!c) { p.shown = null; continue; }
      if (!p.shown) p.shown = { ...c };
      else {
        p.shown.x += (c.x - p.shown.x) * 0.45; p.shown.y += (c.y - p.shown.y) * 0.45;
        if (Math.abs(c.x - p.shown.x) * zoom > 0.3 || Math.abs(c.y - p.shown.y) * zoom > 0.3) moving = true;
        else { p.shown.x = c.x; p.shown.y = c.y; }
      }
      ctx.save();
      ctx.translate(p.shown.x, p.shown.y);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.beginPath();
      ctx.moveTo(2, 1.5); ctx.lineTo(15.5, 8.2); ctx.lineTo(9.2, 9.6); ctx.lineTo(6.4, 15.8); ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.fillStyle = p.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
      ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      ctx.fill(); ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(p.name).width;
      ctx.beginPath(); ctx.roundRect(14, 16, tw + 12, 18, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(p.name, 20, 25.5);
      ctx.restore();
    }
    if (moving) requestAnimationFrame(() => this.engine.invalidate());
  }

  private drawPeers(ctx: CanvasRenderingContext2D, zoom: number) {
    if (!this.peers.size) return;
    let byId: Map<number, El> | null = null;
    for (const p of this.peers.values()) {
      if (p.draft?.type === 'stroke' && p.draft.pts.length < 6) { /* noch zu kurz */ }
      else if (p.draft) this.engine.drawElement(ctx, p.draft);
      if (!p.sel.length) continue;
      byId ??= new Map(this.engine.els.map((e) => [e.id, e]));
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      const pad = 7 / zoom;
      for (const id of p.sel) {
        const el = byId.get(id);
        if (!el) continue;
        const b = bbox(el);
        ctx.beginPath();
        ctx.roundRect(b[0] - pad, b[1] - pad, b[2] - b[0] + pad * 2, b[3] - b[1] + pad * 2, 6 / zoom);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    this.drawCursors(ctx, zoom);
  }
}
