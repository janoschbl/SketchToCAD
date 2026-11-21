import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { IconMaximize, IconSparkles, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { Engine, COLORS, BG_COLORS, type Tool, type CommentAnchor, type TextRequest } from './engine';
import { Label } from '@/components/ui/label';
import type React from 'react';
import { Slider } from '@/components/ui/slider';
import WarmTooltip from '@/components/WarmTooltip';
import Toolbar from '@/components/Toolbar';
import ElementBar from '@/components/ElementBar';
import CommentPin, { type Comment } from '@/components/CommentPin';
import PromptBar, { MODELS, type ContextItem } from '@/components/bui/PromptBar';
import { sendPrompt, type PromptPayload } from '@/lib/prompt';
import { CanvasSync, type SyncStatus } from '@/sync/CanvasSync';
import Presence from '@/components/Presence';
import { generateMesh } from '@/lib/magic';

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

type Toast = { id: number; title: string; body: string };

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
      placeholder={req.note ? 'Notiz…' : 'Text…'}
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
  const [magicN, setMagicN] = useState(0);
  const [magicBusy, setMagicBusy] = useState<number | null>(null);
  const [magicErr, setMagicErr] = useState<string | null>(null);
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

  const toast = useCallback((title: string, body: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const e = new Engine(canvasRef.current!);
    e.onTool = setTool;
    e.onObj = setObj3d;
    e.onSel = setSelIds;
    e.onMagic = setMagicN;
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
    const onKey = (e: KeyboardEvent) => { if (!isTyping(e.target) && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'q') setLock((l) => !l); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setExcluded(new Set()), [selIds]);

  // ---------- Prompt-Kontext ----------
  const selInfos = useMemo(() => (engine ? selIds.map((id) => engine.info(id)).filter((x): x is NonNullable<typeof x> => !!x) : []), [engine, selIds, changeTick]);
  const thumbs = useMemo(() => {
    const m = new Map<number, string | null>();
    if (engine) for (const i of selInfos) if (i.type === 'image' || i.type === 'model') m.set(i.id, engine.snapshot(i.id, 48));
    return m;
  }, [engine, selInfos, changeTick]);
  const ctxComments = comments.filter((c) => c.status === 'open' && c.text && (selIds.length ? c.anchor.elId !== null && selIds.includes(c.anchor.elId) : true));
  const context: ContextItem[] = [
    ...selInfos.map((i) => ({ key: `el-${i.id}`, kind: 'element' as const, label: i.label, elType: i.type, thumb: thumbs.get(i.id) })),
    ...ctxComments.map((c) => ({ key: `c-${c.id}`, kind: 'comment' as const, label: c.text, n: c.n })),
  ].filter((c) => !excluded.has(c.key));
  const showPrompt = selIds.length > 0 || ctxComments.length > 0;
  const mentionables = engine ? engine.els.filter((e) => e.type === 'image' || e.type === 'model').map((e) => ({ id: e.id, label: engine.info(e.id)!.label, elType: e.type })) : [];

  const buildPayload = (prompt: string, model: string, elIds: number[], cs: Comment[]): PromptPayload => ({
    prompt,
    model,
    elements: elIds.map((id) => engine!.info(id)).filter((x): x is NonNullable<typeof x> => !!x).map((i) => ({ ...i, image: engine!.snapshot(i.id, 1024) })),
    comments: cs.map((c) => ({ n: c.n, text: c.text, elementId: c.anchor.elId, u: +c.anchor.u.toFixed(4), v: +c.anchor.v.toFixed(4), x: Math.round(c.anchor.wx), y: Math.round(c.anchor.wy) })),
    createdAt: new Date().toISOString(),
  });

  const markSent = (ids: string[]) => setComments((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, status: 'sent' } : c)));

  const sendFromBar = async (text: string, model: string) => {
    const elIds = selInfos.filter((i) => !excluded.has(`el-${i.id}`)).map((i) => i.id);
    const cs = ctxComments.filter((c) => !excluded.has(`c-${c.id}`));
    await sendPrompt(buildPayload(text, model, elIds, cs));
    markSent(cs.map((c) => c.id));
    setExcluded(new Set());
    const parts = [elIds.length && `${elIds.length} Element${elIds.length > 1 ? 'e' : ''}`, cs.length && `${cs.length} Kommentar${cs.length > 1 ? 'e' : ''}`].filter(Boolean).join(' · ');
    toast('Prompt gesendet', `${parts || 'Nur Text'} – noch kein KI-Backend angebunden, Payload steht in der Konsole.`);
  };

  const sendComment = async (c: Comment, text: string) => {
    const cc = { ...c, text };
    await sendPrompt(buildPayload(text, MODELS[0].name, c.anchor.elId !== null ? [c.anchor.elId] : [], [cc]));
    setComments((cs) => cs.map((x) => (x.id === c.id ? { ...cc, status: 'sent' } : x)));
    setOpenComment(null);
    toast(`Kommentar ${c.n} gesendet`, 'Einzeln als Prompt verschickt – Payload steht in der Konsole.');
  };

  const onFiles = async (files: FileList | null) => {
    if (!engine || !files) return;
    for (const f of Array.from(files)) if (f.type.startsWith('image/')) await engine.addImage(f);
  };

  const one = selIds.length === 1 ? selInfos[0] : undefined;

  return (
    <div className="fixed inset-0 select-none touch-none text-sm">
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

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
                {one && box && onScreen && (
                  <ElementBar
                    type={one.type} box={box} tool={tool}
                    onMarkup={() => { if (tool === 'pen') setTool('select'); else { setColor(MARKUP_COLOR); setTool('pen'); } }}
                    onComment={() => setTool(tool === 'comment' ? 'select' : 'comment')}
                    onErase={() => setTool(tool === 'imgErase' ? 'select' : 'imgErase')}
                    onRemoveBg={() => { if (!engine.removeBg(one.id)) toast('Kein Hintergrund gefunden', 'Am Bildrand gibt es keine einheitliche Hintergrundfarbe.'); }}
                    onResize={(f) => engine.resizeEl(one.id, f)}
                    onDelete={() => engine.deleteSelection()}
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
        onUndo={() => engine?.undo()} onRedo={() => engine?.redo()}
      />

      {/* Eigenschaften – nur bei Zeichenwerkzeugen */}
      {STYLE_TOOLS.includes(tool) && (
        <div className="absolute top-20 left-4 grid w-56 gap-4 rounded-[14px] bg-surface p-4 shadow-raised" style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'top left' }}>
          <div className="grid gap-2">
            <Label className="text-xs font-normal text-ink-2">Strich</Label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => <Swatch key={c} color={c} on={color === c} onClick={() => setColor(c)} />)}
              <label className="relative ml-auto size-7 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)]" style={{ background: color }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute -inset-2 size-12 cursor-pointer opacity-0" />
              </label>
            </div>
          </div>
          {tool !== 'pen' && tool !== 'arrow' && tool !== 'line' && tool !== 'text' && tool !== 'note' && (
            <div className="grid gap-2">
              <Label className="text-xs font-normal text-ink-2">Hintergrund</Label>
              <div className="flex items-center gap-1.5">
                <Swatch none on={fill === null} onClick={() => setFill(null)} />
                {BG_COLORS.map((c) => <Swatch key={c} color={c} on={fill === c} onClick={() => setFill(c)} />)}
              </div>
            </div>
          )}
          {tool !== 'text' && tool !== 'note' && tool !== 'bucket' && (
            <div className="grid gap-2">
              <Label className="text-xs font-normal text-ink-2">Strichstärke</Label>
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
              <Label className="text-xs font-normal text-ink-2">Druck</Label>
              <div className="flex gap-2">
                <IconChoice on={pressure === 'on'} onClick={() => setPressure('on')} label="Druck">
                  <svg viewBox="0 0 20 10" className="w-5"><path d="M1 5 Q4 0 7 5 T13 5 T19 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </IconChoice>
                <IconChoice on={pressure === 'off'} onClick={() => setPressure('off')} label="Konstant">
                  <svg viewBox="0 0 20 10" className="w-5"><path d="M1 5 Q4 0 7 5 T13 5 T19 5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                </IconChoice>
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-xs font-normal text-ink-2">Deckkraft</Label>
            <Slider value={[opacity]} min={0} max={100} onValueChange={(v) => setOpacity(v[0])} aria-label="Deckkraft" />
          </div>
        </div>
      )}

      {/* Zoom */}
      <div className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-[12px] bg-surface p-1 shadow-raised">
        <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.setZoom(engine.cam.z / 1.25)} aria-label="Herauszoomen"><IconZoomOut size={17} stroke={1.7} /></button>
        <span className="w-12 text-center text-[12.5px] text-ink-2 tabular-nums">{Math.round(stats.zoom * 100)}%</span>
        <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.setZoom(engine.cam.z * 1.25)} aria-label="Hineinzoomen"><IconZoomIn size={17} stroke={1.7} /></button>
        <WarmTooltip content="Alles zeigen" side="top">
          <button className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover" onClick={() => engine?.fit()} aria-label="Alles zeigen"><IconMaximize size={17} stroke={1.7} /></button>
        </WarmTooltip>
      </div>

      {/* Prompt-Leiste */}
      {showPrompt && engine && (
        <div className="absolute bottom-4 left-1/2 w-[min(600px,calc(100vw-32px))] -translate-x-1/2" style={{ animation: 'rise-in 260ms cubic-bezier(0.23,1,0.32,1) both' }}>
          <PromptBar
            context={context}
            mentionables={mentionables}
            onRemoveContext={(key) => setExcluded((s) => new Set(s).add(key))}
            onMention={(id) => engine.select([...selIds.filter((x) => x !== id), id])}
            onAttach={() => fileRef.current?.click()}
            onSend={sendFromBar}
            placeholder={selIds.length ? 'Was soll mit der Auswahl passieren?' : 'Prompt zu den Kommentaren…'}
          />
        </div>
      )}

      {!showPrompt && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 max-w-[56vw] -translate-x-1/2 text-center text-xs text-neutral-500">
          {obj3d ? (<><b>G</b> Verschieben · <b>R</b> Drehen · <b>S</b> Skalieren · <b>Entf</b> Löschen · <b>Esc</b> abwählen</>)
            : tool === 'select' ? 'Klicken = auswählen · Umschalt = mehrere · Rahmen ziehen = Mehrfachauswahl · Bilder einfügen per Drag & Drop oder Strg+V'
            : tool === 'comment' ? 'Auf ein Bild, Modell oder eine Skizze klicken, um einen Kommentar-Pin zu setzen'
            : tool === 'imgErase' ? 'Über ein Bild malen, um Bereiche zu radieren'
            : tool === 'magic' ? 'Magic Pen: Objekt skizzieren (am besten in Schrägansicht), dann Enter oder „In 3D umwandeln“'
            : 'Maus/Pencil zeichnen · Finger pannen/zoomen · Leertaste = pannen · Rad = Zoom'}
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
            <span>{magicN} {magicN === 1 ? 'Strich' : 'Striche'}</span>
          ) : (
            <span>Skizziere ein Objekt</span>
          )}
          {magicBusy === null && magicN > 0 && (
            <>
              <button className="rounded-[10px] px-2.5 py-1.5 text-ink-2 hover:bg-hover" onClick={() => engine?.discardMagic()}>Verwerfen</button>
              <button className="rounded-[10px] bg-[#7c5cff] px-3 py-1.5 font-medium text-white transition-transform active:scale-[0.97]" onClick={runMagic}>
                {magicErr ? 'Erneut versuchen' : 'In 3D umwandeln'}
              </button>
            </>
          )}
        </div>
      )}

      {sync && <Presence me={sync.me} peers={[...sync.peers.values()]} status={syncStatus} />}

      {/* Toasts */}
      <div className="pointer-events-none absolute top-20 right-4 grid w-80 gap-2">
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
