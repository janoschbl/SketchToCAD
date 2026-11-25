import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { IconMaximize, IconSparkles, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { Engine, COLORS, BG_COLORS, type Tool, type CommentAnchor, type TextRequest, type PartRef } from './engine';
import { Label } from '@/components/ui/label';
import type React from 'react';
import { Slider } from '@/components/ui/slider';
import WarmTooltip from '@/components/WarmTooltip';
import Toolbar from '@/components/Toolbar';
import ElementBar from '@/components/ElementBar';
import CommentPin, { type Comment } from '@/components/CommentPin';
import PromptBar, { type ContextItem } from '@/components/bui/PromptBar';
import AgentChat, { type ChatItem, type PickState } from '@/components/bui/AgentChat';
import {
  continueEdit, convertModel, editModel, fetchConfig, FALLBACK_CONFIG, PromptError,
  type EditArgs, type Frage, type Pin, type PromptResult, type VerlaufEintrag,
} from '@/lib/prompt';
import { CanvasSync, type SyncStatus } from '@/sync/CanvasSync';
import Presence from '@/components/Presence';
import { generateMesh } from '@/lib/magic';
import { lazy, Suspense } from 'react';

const Studio = lazy(() => import('@/studio/Studio'));

function roomName() {
  const r = new URLSearchParams(location.search).get('room');
  return r && /^[\w-]{1,64}$/.test(r) ? r : 'default';
}

const WIDTHS = ['S', 'M', 'L'];
const WIDTH_VALUES = [2, 4, 9];
const STYLE_TOOLS: Tool[] = ['pen', 'rect', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'note', 'bucket'];
const MARKUP_COLOR = '#e03131';
const MAGIC_SEEDS = 4;

function Swatch({ color, on, onClick, none }: { color?: string; on: boolean; onClick: () => void; none?: boolean }) {
  return (
    <button
      aria-label={color ?? 'transparent'}
      onClick={onClick}
      style={none ? undefined : { background: color }}
      className={`size-7 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-transform hover:scale-105 ${on ? 'shadow-[0_0_0_2px_#fff,0_0_0_3.5px_rgba(124,120,230,0.45)]' : ''} ${none ? 'bg-[conic-gradient(#d9d9de_25%,#fff_0_50%,#d9d9de_0_75%,#fff_0)] bg-[length:12px_12px]' : ''}`}
    />
  );
}

function IconChoice({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick}
      className={`flex size-9 items-center justify-center rounded-lg transition-colors ${on ? 'bg-[#e0dfff] text-[#3b37a5]' : 'bg-neutral-100/80 text-neutral-500 hover:bg-violet-50'}`}>
      {children}
    </button>
  );
}

type Toast = { id: number; title: string; body: string; ms?: number };

/** Offene Rückfrage: alles, was zum Fortsetzen des ursprünglichen Auftrags nötig ist. */
type Pending = {
  auftrag: string; verlauf: VerlaufEintrag[]; session: string | null; frage: Frage;
  modelKey: string; part: string | null; image: string | null; pins: Pin[]; commentIds: string[];
};
/** Chat-Verlauf pro Modell (Rückfragen und Antworten über der Prompt-Leiste). */
type Chat = { modelId: number; items: ChatItem[]; pending: Pending | null };
type RunArgs = Omit<Pending, 'frage'>;

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function isTyping(t: EventTarget | null) {
  return !!(t as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');
}

/** Bildschirm-Overlay (Pins, Kontextleiste, Text-Editor) – rendert bei jedem Canvas-Frame neu. */
function Overlay({ engine, children }: { engine: Engine; children: () => React.ReactNode }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    engine.onFrame = tick;
    window.addEventListener('resize', tick);
    return () => { engine.onFrame = undefined; window.removeEventListener('resize', tick); };
  }, [engine]);
  return <>{children()}</>;
}

function TextEditor({ engine, req, color, onDone }: { engine: Engine; req: TextRequest; color: string; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => { requestAnimationFrame(() => ref.current?.focus()); }, []);
  const p = engine.toScreen(req.wx, req.wy), z = engine.cam.z;
  const finish = (t: string | null) => { if (done.current) return; done.current = true; onDone(t); };
  return (
    <textarea
      ref={ref}
      rows={1}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finish(e.currentTarget.value.trim() || null); }
      }}
      onInput={(e) => { const t = e.currentTarget; t.style.height = '0px'; t.style.height = `${t.scrollHeight}px`; }}
      placeholder={req.note ? 'Note…' : 'Text…'}
      className="absolute z-30 resize-none overflow-hidden bg-transparent outline-none placeholder:text-neutral-300"
      style={{
        left: p.x, top: p.y, color, minWidth: 120 * z,
        fontSize: 20 * z, lineHeight: 1.3, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        ...(req.note ? { background: '#fff3bf', padding: 14 * z, borderRadius: 6 * z, minWidth: 160 * z, minHeight: 110 * z, boxShadow: '0 3px 10px rgba(60,50,0,0.16)' } : { padding: 0 }),
      }}
    />
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<Engine>();
  const [tool, setTool] = useState<Tool>('select');
  const [lock, setLock] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [fill, setFill] = useState<string | null>(null);
  const [widthIdx, setWidthIdx] = useState(1);
  const [pressure, setPressure] = useState('on');
  const [opacity, setOpacity] = useState(100);
  const [obj3d, setObj3d] = useState(false);
  const [stats, setStats] = useState({ zoom: 1 });
  const [selIds, setSelIds] = useState<number[]>([]);
  const [sync, setSync] = useState<CanvasSync>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [, bumpPeers] = useReducer((x: number) => x + 1, 0);
  // Kommentare: veröffentlichte liegen im Yjs-Dokument, Entwürfe nur lokal.
  const [sharedComments, setSharedComments] = useState<Comment[]>([]);
  const [draftComments, setDraftComments] = useState<Comment[]>([]);
  const comments = useMemo(() => [...sharedComments, ...draftComments].sort((a, b) => a.n - b.n), [sharedComments, draftComments]);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const syncRef = useRef<CanvasSync | undefined>(undefined);
  const setComments = useCallback((fn: (cs: Comment[]) => Comment[]) => {
    const next = fn(commentsRef.current);
    commentsRef.current = next;
    setDraftComments(next.filter((c) => c.status === 'draft'));
    const shared = next.filter((c) => c.status !== 'draft');
    if (syncRef.current) syncRef.current.setComments(shared);
    setSharedComments(shared);
  }, []);
  const [openComment, setOpenComment] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [textReq, setTextReq] = useState<TextRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [changeTick, bumpChange] = useReducer((x: number) => x + 1, 0);
  const [studio, setStudio] = useState<{ project?: string; modelId?: number } | null>(() => (new URLSearchParams(location.search).has('studio') ? {} : null));
  const [magicN, setMagicN] = useState(0);
  const [magicBusy, setMagicBusy] = useState<number | null>(null);
  const [magicErr, setMagicErr] = useState<string | null>(null);
  // Prompt: geklicktes Teil, Konfiguration des Prompt-Editor-Backends, laufende Anfrage, Rückfrage-Chat
  const [part, setPart] = useState<PartRef | null>(null);
  const [multiPart, setMultiPart] = useState(false);
  const [promptCfg, setPromptCfg] = useState(FALLBACK_CONFIG);
  const [busyId, setBusyId] = useState<number | null>(null); // Modell-ID, an dem die KI gerade arbeitet
  const promptBusy = useRef(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [pick, setPick] = useState<PickState | null>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const selIdsRef = useRef<number[]>([]);
  /** Rückfragen vom Typ „teil“/„modell“: Klicks im Canvas abfangen (aktuelle Handler, aus dem Engine-Callback gerufen). */
  const pickHandlers = useRef<{ sel: (ids: number[]) => boolean; part: (p: PartRef | null) => void }>({ sel: () => false, part: () => {} });
  const lockRef = useRef(lock);
  lockRef.current = lock;

  const magicBusyRef = useRef(false);
  const runMagic = useCallback(async () => {
    if (!engine || magicBusyRef.current) return;
    const sk = engine.magicSketch();
    if (!sk) return;
    magicBusyRef.current = true;
    setMagicErr(null);
    setMagicBusy(0);
    try {
      const png = await sk.png;
      const best = await generateMesh(png, MAGIC_SEEDS, setMagicBusy);
      await engine.addMesh(best.V, best.F, sk.box);
      setTool('select');
    } catch (err) {
      setMagicErr(err instanceof Error ? err.message : String(err));
    } finally {
      magicBusyRef.current = false;
      setMagicBusy(null);
    }
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || tool !== 'magic' || !magicN) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      e.preventDefault();
      runMagic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, magicN, runMagic]);

  const toast = useCallback((title: string, body: string, ms = 4500) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  useEffect(() => {
    const e = new Engine(canvasRef.current!);
    e.onTool = setTool;
    e.onObj = setObj3d;
    e.onSel = (ids) => { if (pickHandlers.current.sel(ids)) return; selIdsRef.current = ids; setSelIds(ids); };
    e.convertModel = convertModel;
    e.onError = (title, body) => toast(title, body, 9000);
    e.onMagic = setMagicN;
    e.onMulti = setMultiPart;
    e.onPart = (p) => {
      pickHandlers.current.part(p);
      setPart(p);
      setExcluded((x) => (x.has('part') ? new Set([...x].filter((k) => k !== 'part')) : x));
    };
    e.onChange = bumpChange;
    e.onImagePick = () => fileRef.current?.click();
    e.onTextRequest = (r) => setTextReq(r);
    e.onComment = (a: CommentAnchor) => {
      const n = commentsRef.current.reduce((m, x) => Math.max(m, x.n), 0) + 1;
      const c: Comment = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), n, anchor: a, text: '', status: 'draft' };
      setComments((cs) => [...cs.filter((x) => x.status !== 'draft' || x.text), c]);
      setOpenComment(c.id);
      if (!lockRef.current) setTool('select');
    };
    setEngine(e);
    const s = new CanvasSync(e, canvasRef.current!, roomName());
    s.onStatus = setSyncStatus;
    s.onPeers = bumpPeers;
    s.onComments = (cs) => setSharedComments(cs as Comment[]);
    syncRef.current = s;
    if (import.meta.env.DEV) (window as any).__stc = { engine: e, sync: s }; // Debug-Zugriff
    setSync(s);
    const id = setInterval(() => setStats(e.stats()), 250);
    return () => { clearInterval(id); s.destroy(); syncRef.current = undefined; e.destroy(); };
  }, []);

  useEffect(() => {
    if (!engine) return;
    engine.tool = tool; engine.color = color; engine.fillColor = fill; engine.width = WIDTH_VALUES[widthIdx];
    engine.opacity = opacity; engine.pressure = pressure === 'on'; engine.lock = lock;
  }, [engine, tool, color, fill, widthIdx, opacity, pressure, lock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.key.toLowerCase() === 'q') setLock((l) => !l);
      if (e.key.toLowerCase() === 'k') setStudio((o) => o ?? {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setExcluded(new Set()); }, [selIds]);

  // ---------- Prompt-Kontext ----------
  const selInfos = useMemo(() => (engine ? selIds.map((id) => engine.info(id)).filter((x): x is NonNullable<typeof x> => !!x) : []), [engine, selIds, changeTick]);
  const thumbs = useMemo(() => {
    const m = new Map<number, string | null>();
    if (engine) for (const i of selInfos) if (i.type === 'image' || i.type === 'model') m.set(i.id, engine.snapshot(i.id, 48));
    return m;
  }, [engine, selInfos, changeTick]);
  const ctxComments = comments.filter((c) => c.status === 'open' && c.text && (selIds.length ? c.anchor.elId !== null && selIds.includes(c.anchor.elId) : true));
  const activeInfos = selInfos.filter((i) => !excluded.has(`el-${i.id}`));
  const modelInfos = activeInfos.filter((i) => i.type === 'model');
  const refIds = activeInfos.filter((i) => i.type !== 'model').map((i) => i.id); // Skizzen/Bilder = Vorlage
  const partCtx = part && modelInfos.some((i) => i.id === part.modelId) && !excluded.has('part') ? part : null;
  const context: ContextItem[] = [
    ...selInfos.map((i) => ({ key: `el-${i.id}`, kind: 'element' as const, label: i.label, elType: i.type, thumb: thumbs.get(i.id) })),
    ...(part && selIds.includes(part.modelId) ? [{ key: 'part', kind: 'part' as const, label: part.names.length === 1 ? `Part: ${part.names[0]}` : `${part.names.length} parts: ${part.names.join(', ')}` }] : []),
    ...ctxComments.map((c) => ({ key: `c-${c.id}`, kind: 'comment' as const, label: c.text, n: c.n })),
  ].filter((c) => !excluded.has(c.key));
  // Die Leiste gibt es nur zum Ändern eines ausgewählten 3D-Modells.
  const showPrompt = selInfos.some((i) => i.type === 'model');
  const chatVisible = !!chat && chat.items.length > 0 && selIds.includes(chat.modelId);
  const mentionables = engine ? engine.els.filter((e) => e.type === 'image' || e.type === 'model').map((e) => ({ id: e.id, label: engine.info(e.id)!.label, elType: e.type })) : [];

  useEffect(() => {
    if (showPrompt && promptCfg.mode === 'unknown') fetchConfig().then(setPromptCfg).catch(() => {});
  }, [showPrompt, promptCfg.mode]);

  const markSent = (ids: string[]) => setComments((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, status: 'sent' } : c)));

  /** Ergebnis als kurzer Text für die Agent-Blase (und als Toast, falls der Chat nicht sichtbar ist). */
  const summary = (res: PromptResult): string => {
    const list = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} +${xs.length - 4}` : xs.join(', '));
    const stats = [res.stats, promptCfg.mode === 'mock' && 'test mode without AI'].filter(Boolean).join(' · ');
    const errs = res.errors.length ? ` ${res.errors.length} step(s) failed: ${res.errors.join(' · ')}` : '';
    if (res.glb) {
      const n = res.changed.length;
      const head = res.text || `Done: ${n} ${n === 1 ? 'part' : 'parts'} changed: ${list(res.changed)}.`;
      return `${head}${errs}${stats ? ` (${stats})` : ''}`;
    }
    return res.text || (res.errors.length ? `That didn’t work: ${res.errors.join(' · ')}` : 'I couldn’t find a matching change. Please describe more precisely what should change.');
  };

  const pushChat = (modelId: number, items: ChatItem[], pending?: Pending | null) => setChat((c) => {
    const base: Chat = c && c.modelId === modelId ? c : { modelId, items: [], pending: null };
    return { ...base, items: [...base.items, ...items].slice(-40), pending: pending === undefined ? base.pending : pending };
  });

  const endPick = (modelId?: number) => {
    setPick(null);
    if (engine && modelId !== undefined) engine.highlightParts(modelId, []);
  };

  /** Pin eines Kommentars für die KI: Teil und Texturposition unter dem Pin (frisch aufgelöst). */
  const pinOf = (c: Comment, text = c.text): Pin => {
    const r = engine?.resolvePin(c.anchor) ?? { part: c.anchor.part, uv: c.anchor.uv };
    return { n: c.n, text, teil: r.part ?? null, bild: r.uv ?? null };
  };

  /** Auftrag an einem Modell ausführen (neu oder als Fortsetzung nach einer Rückfrage). true = verarbeitet. */
  const runEdit = async (targetId: number, a: RunArgs): Promise<boolean> => {
    if (!engine || promptBusy.current) return false;
    promptBusy.current = true;
    setBusyId(targetId);
    const shown = () => selIdsRef.current.includes(targetId);
    try {
      const info = engine.info(targetId);
      let views: ReturnType<Engine['modelViews']> = null;
      try { views = engine.modelViews(targetId); } catch (err) { console.warn('Ansichten fehlgeschlagen', err); }
      const models = engine.allModelDims().map(({ id, ...m }) => ({ ...m, selbst: id === targetId }));
      const args: EditArgs = {
        prompt: a.auftrag, model: a.modelKey, part: a.part, image: a.image, views: views?.views, marks: views?.marken,
        verlauf: a.verlauf, models, pins: a.pins, label: info?.label,
      };
      let res = a.session ? await continueEdit(a.session, args) : null;
      if (!res) {
        const glb = await engine.exportModel(targetId);
        if (!glb) throw new PromptError('The model is no longer on the canvas.');
        res = await editModel({ ...args, glb });
      }
      if (res.glb && (await engine.replaceModel(targetId, res.glb)) === null) {
        toast('Model no longer exists', 'It was deleted while the AI was working on it.');
        return false;
      }
      if (res.question) {
        pushChat(targetId, [{ id: uid(), role: 'agent', text: res.question.frage }], { ...a, session: res.session, frage: res.question });
        if (!shown()) toast('Question', `${info?.label ?? 'Model'}: ${res.question.frage}`, 9000);
      } else {
        const text = summary(res);
        pushChat(targetId, [{ id: uid(), role: 'agent', text, tone: res.glb ? 'ok' : res.errors.length ? 'error' : 'info' }], null);
        endPick(targetId);
        if (!shown()) toast(res.glb ? 'Model updated' : 'Nothing changed', text, 9000);
      }
      if (res.glb) markSent(a.commentIds);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushChat(targetId, [{ id: uid(), role: 'agent', text: msg, tone: 'error' }]);
      if (!shown()) toast('Prompt failed', msg, 9000);
      return false;
    } finally {
      promptBusy.current = false;
      setBusyId(null);
    }
  };

  /** Antwort auf die offene Rückfrage: erscheint als Blase links, danach läuft der ursprüngliche Auftrag weiter. */
  const answer = (entry: VerlaufEintrag) => {
    const c = chatRef.current;
    if (!c?.pending || promptBusy.current) return;
    const { frage, ...p } = c.pending;
    pushChat(c.modelId, [{ id: uid(), role: 'user', text: entry.text }], null);
    endPick(c.modelId);
    runEdit(c.modelId, { ...p, verlauf: [...p.verlauf, { rolle: 'agent', text: frage.frage }, entry] });
  };

  const cancelQuestion = () => {
    const c = chatRef.current;
    if (!c?.pending) return;
    pushChat(c.modelId, [{ id: uid(), role: 'user', text: 'Abgebrochen' }], null);
    endPick(c.modelId);
  };

  // Rückfragen „Klick das Teil an“ / „Wähle ein anderes Modell“: Canvas-Klicks als Antwort einsammeln.
  pickHandlers.current = {
    sel: (ids) => {
      const c = chatRef.current, pk = pickRef.current;
      if (!engine || !c || pk?.kind !== 'modell') return false;
      const other = ids.find((id) => id !== c.modelId && engine.info(id)?.type === 'model');
      if (other === undefined) return false;
      setPick({ kind: 'modell', items: [{ key: String(other), label: engine.info(other)!.label }] });
      engine.select([c.modelId]);
      return true;
    },
    part: (p) => {
      const c = chatRef.current, pk = pickRef.current;
      if (!engine || !c || !p || pk?.kind !== 'teil' || p.modelId !== c.modelId) return;
      const multi = !!c.pending?.frage.mehrfach;
      const sel = p.patterns.map((key, i) => ({ key, label: p.names[i] }));
      const items = multi ? sel : sel.slice(-1);
      setPick({ kind: 'teil', items });
      engine.highlightParts(c.modelId, items.map((x) => x.key.replace(/__\*$/, '')));
    },
  };

  const sendFromBar = async (text: string, modelKey: string): Promise<boolean> => {
    if (!engine) return false;
    // Offene Rückfrage an diesem Modell: der Text ist die Antwort.
    if (chatVisible && chat?.pending) { if (text) answer({ rolle: 'nutzer', text }); return !!text; }
    if (modelInfos.length !== 1) {
      toast(modelInfos.length ? 'Several models selected' : 'No model selected',
        modelInfos.length ? 'Remove the chips of models that should stay unchanged, or select just one.' : 'Select a 3D model to change.');
      return false;
    }
    const targetId = modelInfos[0].id;
    const cs = ctxComments.filter((c) => !excluded.has(`c-${c.id}`));
    const onTarget = cs.filter((c) => c.anchor.elId === targetId);
    const elsewhere = cs.filter((c) => c.anchor.elId !== targetId);
    const auftrag = [text, ...elsewhere.map((c) => `Comment ${c.n}: ${c.text}`)].filter(Boolean).join('\n') || 'Apply the comments at the pins.';
    const shownText = [text, ...cs.map((c) => `Pin ${c.n}: ${c.text}`)].filter(Boolean).join('\n');
    pushChat(targetId, [{ id: uid(), role: 'user', text: shownText }], null);
    endPick(targetId);
    const ok = await runEdit(targetId, {
      auftrag, verlauf: [], session: null, modelKey, part: partCtx?.patterns.join(',') ?? null,
      image: refIds.length ? engine.snapshotMany(refIds, 1024) : null,
      pins: onTarget.map((c) => pinOf(c)), commentIds: cs.map((c) => c.id),
    });
    if (ok) setExcluded(new Set());
    return ok;
  };

  /** Kommentar-Pin einzeln ausführen: nur an einem 3D-Modell (der Pin sagt, wo am Modell). */
  const sendComment = async (c: Comment, text: string) => {
    if (!engine) return;
    const targetId = c.anchor.elId;
    if (targetId === null || engine.info(targetId)?.type !== 'model') {
      toast('No 3D model', 'Comments can only be run on a 3D model. Select a model and send the comment via the prompt bar.');
      return;
    }
    engine.select([targetId]);
    setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, text, status: x.status === 'draft' ? 'open' : x.status } : x)));
    setOpenComment(null);
    pushChat(targetId, [{ id: uid(), role: 'user', text: `Pin ${c.n}: ${text}` }], null);
    await runEdit(targetId, {
      auftrag: text, verlauf: [], session: null, modelKey: promptCfg.defaultModel, part: null, image: null,
      pins: [pinOf(c, text)], commentIds: [c.id],
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!engine || !files) return;
    for (const f of Array.from(files)) if (f.type.startsWith('image/')) await engine.addImage(f);
  };

  const onModelFiles = async (files: FileList | null) => {
    if (!engine || !files) return;
    for (const f of Array.from(files)) await engine.addModelFile(f);
  };

  const one = selIds.length === 1 ? selInfos[0] : undefined;
  // Echte Maße nur bei Änderungen neu messen (exakte Box über alle Vertices)
  const oneDims = useMemo(() => (engine && one?.type === 'model' ? engine.modelDims(one.id) : null), [engine, one?.id, one?.type, changeTick]);

  return (
    <div className="fixed inset-0 select-none touch-none text-sm">
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={modelFileRef} type="file" accept=".glb,.gltf,.obj,.usd,.usda,.usdc" multiple hidden onChange={(e) => { onModelFiles(e.target.files); e.target.value = ''; }} />

      {engine && (
        <Overlay engine={engine}>
          {() => {
            const box = one ? engine.screenBox(one.id) : null;
            const onScreen = box && box[2] > 0 && box[0] < window.innerWidth && box[3] > 0 && box[1] < window.innerHeight;
            return (
              <>
                {comments.map((c) => {
                  const p = engine.anchorPos(c.anchor);
                  if (!p) return null;
                  return (
                    <CommentPin
                      key={c.id} c={c} x={p.x} y={p.y} open={openComment === c.id}
                      onOpen={() => setOpenComment(c.id)}
                      onClose={() => setOpenComment((o) => (o === c.id ? null : o))}
                      onSave={(text) => { setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, text, status: x.status === 'draft' ? 'open' : x.status } : x))); setOpenComment((o) => (o === c.id ? null : o)); }}
                      onDelete={() => { setComments((cs) => cs.filter((x) => x.id !== c.id)); setOpenComment((o) => (o === c.id ? null : o)); }}
                      onSend={(text) => sendComment(c, text)}
                    />
                  );
                })}
                {busyId !== null && (() => {
                  const b = engine.screenBox(busyId);
                  return b ? <div className="pointer-events-none absolute animate-pulse rounded-[10px] bg-white/50 ring-2 ring-[#7c5cff]/50" style={{ left: b[0], top: b[1], width: b[2] - b[0], height: b[3] - b[1] }} /> : null;
                })()}
                {one && box && onScreen && (
                  <ElementBar
                    type={one.type} box={box} tool={tool}
                    onMarkup={() => { if (tool === 'pen') setTool('select'); else { setColor(MARKUP_COLOR); setTool('pen'); } }}
                    onComment={() => setTool(tool === 'comment' ? 'select' : 'comment')}
                    onErase={() => setTool(tool === 'imgErase' ? 'select' : 'imgErase')}
                    onRemoveBg={() => { if (!engine.removeBg(one.id)) toast('No background found', 'The image edge has no uniform background color.'); }}
                    onStudio={one.type === 'model' && engine.modelStudio(one.id) ? () => setStudio({ project: engine.modelStudio(one.id)!, modelId: one.id }) : undefined}
                    onDelete={() => engine.deleteSelection()}
                    parts={part && part.modelId === one.id ? { count: part.names.length, logos: part.logos } : null}
                    multi={multiPart}
                    onMulti={() => engine.setMultiPart(!multiPart)}
                    onPartScale={(f) => engine.scaleSelectedParts(f)}
                    onDeleteParts={() => engine.deleteSelectedParts()}
                    onClearParts={() => engine.deselect3d()}
                    dims={oneDims}
                    onSetSize={(axis, meters) => { if (!engine.setModelSize(one.id, axis, meters)) toast('Size not set', 'The model has no extent on this axis.'); }}
                  />
                )}
                {textReq && (
                  <TextEditor
                    key={`${textReq.wx},${textReq.wy}`} engine={engine} req={textReq} color={color}
                    onDone={(t) => { if (t) engine.addText(textReq.wx, textReq.wy, t, textReq.note); setTextReq(null); if (!lock) setTool('select'); }}
                  />
                )}
              </>
            );
          }}
        </Overlay>
      )}

      <Toolbar
        tool={tool} setTool={setTool} lock={lock} setLock={setLock}
        onImage={() => fileRef.current?.click()}
        onModel={() => engine?.addModel()}
        onModelFile={() => modelFileRef.current?.click()}
        onUndo={() => engine?.undo()} onRedo={() => engine?.redo()}
        onStudio={() => setStudio({})}
      />

      {/* Eigenschaften – nur bei Zeichenwerkzeugen */}
      {STYLE_TOOLS.includes(tool) && (
        <div className="absolute top-20 left-4 grid w-56 gap-4 rounded-[14px] bg-surface p-4 shadow-raised" style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'top left' }}>
          <div className="grid gap-2">
            <Label className="text-xs font-normal text-ink-2">Stroke</Label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => <Swatch key={c} color={c} on={color === c} onClick={() => setColor(c)} />)}
              <label className="relative ml-auto size-7 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)]" style={{ background: color }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute -inset-2 size-12 cursor-pointer opacity-0" />
              </label>
            </div>
          </div>
          {tool !== 'pen' && tool !== 'arrow' && tool !== 'line' && tool !== 'text' && tool !== 'note' && (
            <div className="grid gap-2">
              <Label className="text-xs font-normal text-ink-2">Background</Label>
              <div className="flex items-center gap-1.5">
                <Swatch none on={fill === null} onClick={() => setFill(null)} />
                {BG_COLORS.map((c) => <Swatch key={c} color={c} on={fill === c} onClick={() => setFill(c)} />)}
              </div>
            </div>
          )}
          {tool !== 'text' && tool !== 'note' && tool !== 'bucket' && (
            <div className="grid gap-2">
              <Label className="text-xs font-normal text-ink-2">Stroke width</Label>
              <div className="flex gap-2">
                {WIDTH_VALUES.map((w, i) => (
                  <IconChoice key={w} on={widthIdx === i} onClick={() => setWidthIdx(i)} label={WIDTHS[i]}>
                    <span className="block w-4 rounded-full bg-current" style={{ height: [1.5, 3, 5][i] }} />
                  </IconChoice>
                ))}
              </div>
            </div>
          )}
          {tool === 'pen' && (
            <div className="grid gap-2">
              <Label className="text-xs font-normal text-ink-2">Pressure</Label>
              <div className="flex gap-2">
                <IconChoice on={pressure === 'on'} onClick={() => setPressure('on')} label="Pressure">
                  <svg viewBox="0 0 20 10" className="w-5"><path d="M1 5 Q4 0 7 5 T13 5 T19 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </IconChoice>
                <IconChoice on={pressure === 'off'} onClick={() => setPressure('off')} label="Constant">
                  <svg viewBox="0 0 20 10" className="w-5"><path d="M1 5 Q4 0 7 5 T13 5 T19 5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                </IconChoice>
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-xs font-normal text-ink-2">Opacity</Label>
            <Slider value={[opacity]} min={0} max={100} onValueChange={(v) => setOpacity(v[0])} aria-label="Opacity" />
          </div>
        </div>
      )}

      {/* Zoom */}
      <div className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-[12px] bg-surface p-1 shadow-raised">
        <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.setZoom(engine.cam.z / 1.25)} aria-label="Zoom out"><IconZoomOut size={17} stroke={1.7} /></button>
        <span className="w-12 text-center text-[12.5px] text-ink-2 tabular-nums">{Math.round(stats.zoom * 100)}%</span>
        <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.setZoom(engine.cam.z * 1.25)} aria-label="Zoom in"><IconZoomIn size={17} stroke={1.7} /></button>
        <WarmTooltip content="Show all" side="top">
          <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.fit()} aria-label="Show all"><IconMaximize size={17} stroke={1.7} /></button>
        </WarmTooltip>
      </div>

      {/* Agent-Chat: kleines Fenster am Bildschirm (oben rechts, verschiebbar) */}
      {showPrompt && engine && chatVisible && chat && (
        <AgentChat
          items={chat.items}
          title={engine.info(chat.modelId)?.label ?? 'Agent'}
          frage={chat.pending?.frage ?? null}
          busy={busyId === chat.modelId}
          pick={pick}
          onAnswer={answer}
          onStartPick={(kind) => setPick((p) => (p?.kind === kind ? p : { kind, items: [] }))}
          onRemovePick={(key) => setPick((p) => {
            if (!p) return p;
            const items = p.items.filter((x) => x.key !== key);
            if (p.kind === 'teil') engine.highlightParts(chat.modelId, items.map((x) => x.key.replace(/__\*$/, '')));
            return { ...p, items };
          })}
          onCancel={cancelQuestion}
          onClose={() => { if (busyId === chat.modelId) return; endPick(chat.modelId); setChat(null); }}
        />
      )}

      {/* Prompt-Leiste: nur mit ausgewähltem 3D-Modell */}
      {showPrompt && engine && (
        <div className="absolute bottom-4 left-1/2 w-[min(600px,calc(100vw-32px))] -translate-x-1/2" style={{ animation: 'rise-in 260ms cubic-bezier(0.23,1,0.32,1) both' }}>
          <PromptBar
            context={context}
            mentionables={mentionables}
            onRemoveContext={(key) => setExcluded((s) => new Set(s).add(key))}
            onMention={(id) => engine.select([...selIds.filter((x) => x !== id), id])}
            onAttach={() => fileRef.current?.click()}
            onSend={sendFromBar}
            models={promptCfg.models}
            defaultModel={promptCfg.defaultModel}
            answering={chatVisible && !!chat?.pending}
            onClose={chatVisible && chat?.pending ? cancelQuestion : undefined}
            placeholder={partCtx ? `What should happen to ${partCtx.names.length === 1 ? `“${partCtx.names[0]}”` : `the ${partCtx.names.length} parts`}?` : 'What should change on the model? Click a part to narrow it down.'}
          />
        </div>
      )}

      {!showPrompt && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 max-w-[56vw] -translate-x-1/2 text-center text-xs text-neutral-500">
          {obj3d ? (<><b>Shift</b>+click more parts · <b>Del</b> delete · <b>Esc</b> deselect</>)
            : tool === 'select' && selIds.length ? 'Select a 3D model or drop a GLB file onto the canvas to change it with a prompt'
            : tool === 'select' ? 'Click = select · Shift = several · drag a frame = multi-select · drag & drop images and 3D files'
            : tool === 'comment' ? 'Click an image, model or sketch to place a comment pin'
            : tool === 'imgErase' ? 'Paint over an image to erase areas'
            : tool === 'magic' ? 'Magic Pen: sketch an object (ideally at an angle), then Enter or “Convert to 3D”'
            : 'Mouse/Pencil draws · fingers pan/zoom · Space = pan · wheel = zoom'}
        </div>
      )}

      {(tool === 'magic' || magicN > 0 || magicBusy !== null || magicErr) && (
        <div className="absolute bottom-14 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[14px] bg-surface py-1.5 pr-1.5 pl-3 text-[13px] text-ink-2 shadow-raised" style={{ animation: 'rise-in 260ms cubic-bezier(0.23,1,0.32,1) both' }}>
          <IconSparkles size={16} stroke={1.7} className="text-[#7c5cff]" />
          {magicBusy !== null ? (
            <span className="tabular-nums">Erzeuge Variante {Math.min(magicBusy + 1, MAGIC_SEEDS)} von {MAGIC_SEEDS} …</span>
          ) : magicErr ? (
            <span className="max-w-[320px] text-[#c92a2a]">{magicErr}</span>
          ) : magicN ? (
            <span>{magicN} {magicN === 1 ? 'stroke' : 'strokes'}</span>
          ) : (
            <span>Sketch an object</span>
          )}
          {magicBusy === null && magicN > 0 && (
            <>
              <button className="rounded-[10px] px-2.5 py-1.5 text-ink-2 hover:bg-hover" onClick={() => engine?.discardMagic()}>Verwerfen</button>
              <button className="rounded-[10px] bg-[#7c5cff] px-3 py-1.5 font-medium text-white transition-transform active:scale-[0.97]" onClick={runMagic}>
                {magicErr ? 'Try again' : 'Convert to 3D'}
              </button>
            </>
          )}
        </div>
      )}

      {studio && (
        <Suspense fallback={null}>
          <Studio
            key={studio.project ?? 'neu'}
            projectId={studio.project}
            sync={sync}
            onClose={() => setStudio(null)}
            onPlace={async (f, pid) => {
              if (!engine) return;
              // Aus dem Canvas geöffnet → dasselbe Modell ersetzen (Lage, Größe, Kommentare bleiben); sonst neu einfügen
              const back = studio.modelId != null && engine.modelStudio(studio.modelId) !== null;
              const id = back ? await engine.replaceModel(studio.modelId!, await f.arrayBuffer()) : await engine.addModelFile(f);
              if (id == null) throw new Error('Could not load the model onto the canvas');
              engine.setModelStudio(id, pid);
              setStudio(null);
              engine.select([id]);
              toast(back ? 'Model updated' : 'Model on the canvas', back ? 'The changes from the AI Studio have been applied.' : 'Click it → “Edit in Studio” brings it back to the Studio.');
            }}
          />
        </Suspense>
      )}

      {sync && <Presence me={sync.me} peers={[...sync.peers.values()]} status={syncStatus} />}

      {/* Toasts */}
      <div className="pointer-events-none absolute right-4 bottom-4 grid w-80 gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-[12px] bg-surface px-3.5 py-2.5 shadow-raised" style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}>
            <div className="text-[12.5px] font-medium text-ink">{t.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{t.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
