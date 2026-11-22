// Live-Sync des KI-Studios über dasselbe Yjs-Dokument wie der Canvas (Raum canvas:<room>).
// Alles, was im Studio passiert, sehen alle Personen im Raum sofort:
//  - Striche: Y.Map je Strich (id → JSON) – gleichzeitiges Zeichnen geht nicht verloren
//  - Zustand: Tier, 2 Versionen, gewählte Version, Projekt + Version, „arbeitet gerade“, Hinweis
//  - KI-Chat: Y.Array mit Nachrichten
//  - Flüchtig (Awareness): Strich in Arbeit + Zeiger, wer ist im Studio
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { myName, PEER_COLORS, type CanvasSync } from '@/sync/CanvasSync';
import type { RemotePen, Stroke } from './pad';

export type ChatMsg = { id: string; role: 'user' | 'ai'; text: string; by: string; color: string; t: number; status?: 'working' | 'done' | 'error'; detail?: string };
export type StudioPeer = RemotePen & { id: number };
export type Busy = { text: string; t0: number; by: string; client: number };

const LOCAL = Symbol('studio-local');
const round = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) });

export class StudioSync {
  readonly doc: Y.Doc;
  readonly provider: HocuspocusProvider;
  readonly state: Y.Map<string>;
  readonly strokes: Y.Map<string>;
  readonly chat: Y.Array<ChatMsg>;
  readonly me: { name: string; color: string };
  ready = false;
  onState?: (keys: Set<string>) => void;
  onStrokes?: () => void;
  onChat?: () => void;
  onPeers?: () => void;
  onReady?: () => void;

  private own = false;
  private seq = 0;
  private liveT = 0;
  private liveTimer = 0;
  private liveLast = '';
  private cleanup: (() => void)[] = [];

  /** Im Canvas: dessen Dokument mitbenutzen. Eigenständig (studio.html): eigene Verbindung zum selben Raum. */
  constructor(canvas: CanvasSync | null, room = 'default') {
    if (canvas) {
      this.doc = canvas.doc;
      this.provider = canvas.provider;
      this.me = canvas.me;
    } else {
      this.own = true;
      this.doc = new Y.Doc();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.provider = new HocuspocusProvider({ url: `${proto}://${location.host}/sync`, name: `canvas:${room}`, document: this.doc });
      this.me = { name: myName(), color: PEER_COLORS[this.doc.clientID % PEER_COLORS.length] };
      this.provider.setAwarenessField('u', this.me);
    }
    this.state = this.doc.getMap('studio');
    this.strokes = this.doc.getMap('studioStrokes');
    this.chat = this.doc.getArray('studioChat');

    const onState = (ev: Y.YMapEvent<string>, tr: Y.Transaction) => { if (tr.origin !== LOCAL) this.onState?.(ev.keysChanged); };
    const onStrokes = (_: unknown, tr: Y.Transaction) => { if (tr.origin !== LOCAL) this.onStrokes?.(); };
    const onChat = () => this.onChat?.();
    const onAw = () => this.onPeers?.();
    this.state.observe(onState);
    this.strokes.observe(onStrokes);
    this.chat.observe(onChat);
    this.provider.awareness?.on('change', onAw);
    this.cleanup.push(() => {
      this.state.unobserve(onState); this.strokes.unobserve(onStrokes); this.chat.unobserve(onChat);
      this.provider.awareness?.off('change', onAw);
    });
    this.provider.setAwarenessField('studio', { open: true, live: null, hover: null });

    const markReady = () => { if (this.ready) return; this.ready = true; this.onReady?.(); };
    if (canvas?.synced || (this.provider as any).isSynced || (this.provider as any).synced) queueMicrotask(markReady);
    else {
      this.provider.on('synced', markReady);
      this.cleanup.push(() => this.provider.off('synced', markReady));
      // offline: nach kurzer Zeit trotzdem lokal arbeiten
      const t = setTimeout(markReady, 2500);
      this.cleanup.push(() => clearTimeout(t));
    }
  }

  get clientId() { return this.doc.clientID; }

  destroy() {
    clearTimeout(this.liveTimer);
    this.provider.setAwarenessField('studio', null);
    this.cleanup.forEach((f) => f());
    if (this.own) { this.provider.destroy(); this.doc.destroy(); }
  }

  // ---------- Zustand ----------
  get<T>(k: string): T | undefined {
    const j = this.state.get(k);
    if (j === undefined) return undefined;
    try { return JSON.parse(j) as T; } catch { return undefined; }
  }
  set(k: string, v: unknown) {
    const j = JSON.stringify(v ?? null);
    if (this.state.get(k) === j) return;
    this.doc.transact(() => this.state.set(k, j), LOCAL);
  }
  hasContent() { return this.strokes.size > 0 || !!this.get('project') || !!this.get('gen'); }

  // ---------- Striche ----------
  readStrokes(): Stroke[] {
    const out: Stroke[] = [];
    for (const j of this.strokes.values()) { try { out.push(JSON.parse(j)); } catch { /* kaputter Eintrag */ } }
    return out.sort((a, b) => (a.o ?? 0) - (b.o ?? 0));
  }
  /** Lokale Striche (ohne den gerade gezeichneten) → Dokument; nur Unterschiede werden übertragen. */
  writeStrokes(list: Stroke[]) {
    const local = new Map(list.filter((s) => s.id).map((s) => [s.id!, s]));
    this.doc.transact(() => {
      for (const [id, s] of local) { const j = JSON.stringify(round(s)); if (this.strokes.get(id) !== j) this.strokes.set(id, j); }
      for (const id of [...this.strokes.keys()]) if (!local.has(id)) this.strokes.delete(id);
    }, LOCAL);
  }

  // ---------- Flüchtig: Strich in Arbeit + Zeiger (≤ 30 Hz) ----------
  setLive(live: Stroke[] | null, hover: [number, number] | null) {
    const send = () => {
      this.liveT = performance.now();
      const v = { open: true, live: live?.map(round) ?? null, hover: hover ? [Math.round(hover[0]), Math.round(hover[1])] : null };
      const j = JSON.stringify(v);
      if (j === this.liveLast) return;
      this.liveLast = j;
      this.provider.setAwarenessField('studio', v);
    };
    clearTimeout(this.liveTimer);
    const wait = 33 - (performance.now() - this.liveT);
    if (wait <= 0) send(); else this.liveTimer = window.setTimeout(send, wait);
  }
  peers(): StudioPeer[] {
    const out: StudioPeer[] = [];
    this.provider.awareness?.getStates().forEach((st: any, id: number) => {
      if (id === this.clientId || !st?.studio?.open) return;
      out.push({ id, name: st.u?.name ?? 'Guest', color: st.u?.color ?? '#888', live: st.studio.live ?? null, hover: st.studio.hover ?? null });
    });
    return out;
  }

  // ---------- KI-Chat ----------
  messages(): ChatMsg[] { return this.chat.toArray(); }
  push(m: Omit<ChatMsg, 'id' | 'by' | 'color' | 't'>): string {
    const id = `${this.clientId.toString(36)}-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    this.chat.push([{ ...m, id, by: this.me.name, color: this.me.color, t: Date.now() }]);
    return id;
  }
  update(id: string, patch: Partial<ChatMsg>) {
    const i = this.chat.toArray().findIndex((m) => m.id === id);
    if (i < 0) return;
    const m = { ...this.chat.get(i), ...patch };
    this.doc.transact(() => { this.chat.delete(i, 1); this.chat.insert(i, [m]); });
  }
  clearChat() { if (this.chat.length) this.chat.delete(0, this.chat.length); }
}
