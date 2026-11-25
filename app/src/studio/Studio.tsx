// KI-Studio: Skizze → Bild → 3D mit den Werkzeugen der Canvas-App (KI-Stift, Radierer, Auswahl).
// Ablauf: zeichnen → 2 Versionen → eine wählen (3D) → weiterzeichnen / radieren / Bereiche auswählen und ändern
// oder per „Ask AI“ in Worten ändern (ChatGPT plant die Schritte, der Heim-PC führt sie aus).
// Live-Sync: alles im Studio (Striche, Versionen, Modell, KI-Chat, Zeiger) teilen alle Personen im Raum.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCube, IconDownload, IconEraser, IconFlipVertical, IconLoader2,
  IconPointer, IconRefresh, IconSquare, IconCircle, IconLine, IconButterfly, IconStar, IconLayoutGrid, IconPlayerPlay, IconPlayerPause, IconSparkles, IconTrash, IconWand, IconX, IconEye, IconEyeOff, IconSearch, IconSend, IconCheck,
} from '@tabler/icons-react';
import WarmTooltip, { WarmTooltipGroup } from '@/components/WarmTooltip';
import { Slider } from '@/components/ui/slider';
import type { CanvasSync } from '@/sync/CanvasSync';
import { api, url, type AiPart, type AiStep, type Cls, type Gen, type Project } from './api';
import { Pad, inPoly, loadImg, maskBits, polyMask, tint, drawStrokes, N, type PadTool, type Stroke } from './pad';
import { View3d } from './view3d';
import { presetFor } from './presets';
import { StudioSync, type Busy, type ChatMsg, type StudioPeer } from './sync';

const COLORS = ['#000000', '#7a4a1e', '#e02020', '#f08c14', '#f0d828', '#2ea043', '#1f5fe0', '#6ec0f0', '#8a3ab9', '#f078b4', '#8c8c8c', '#ffffff'];
const COLOR_NAMES: Record<string, string> = { '#000000': 'Black', '#7a4a1e': 'Brown', '#e02020': 'Red', '#f08c14': 'Orange', '#f0d828': 'Yellow', '#2ea043': 'Green', '#1f5fe0': 'Blue', '#6ec0f0': 'Light blue', '#8a3ab9': 'Purple', '#f078b4': 'Pink', '#8c8c8c': 'Gray', '#ffffff': 'White' };
/** helle Farbe → dunkles Häkchen */
const light = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return r * 0.299 + g * 0.587 + b * 0.114 > 170; };
const SIZES = [{ k: 'S', w: 3 }, { k: 'M', w: 7 }, { k: 'L', w: 16 }, { k: 'XL', w: 32 }];
const QUICK = [
  { name: 'butterfly', en: 'Butterfly' }, { name: 'ladybug', en: 'Ladybug' }, { name: 'starfish', en: 'Starfish' }, { name: 'cat', en: 'Cat' }, { name: 'dog', en: 'Dog' }, { name: 'fish', en: 'Fish' },
  { name: 'bird', en: 'Bird' }, { name: 'horse', en: 'Horse' }, { name: 'dragon', en: 'Dragon' }, { name: 'owl', en: 'Owl' },
];
const AI_IDEAS = ['Make the wing pattern blue and green, mostly blue', 'Body dark brown', 'Wings purple with a bit of pink'];
const LABEL_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4', '#66a80f', '#d6336c', '#1098ad', '#7048e8'];
const SEL = '#5b5bff';
const STATE_EN: Record<string, string> = { neu: 'new', geändert: 'changed' };
/** Teilnamen alter Projekte (deutsch) englisch anzeigen */
const partName = (n: string) => (n === 'Rumpf' ? 'Body' : n.replace(/^Teil (\d+)/, 'Part $1'));

function roomName() {
  const r = new URLSearchParams(location.search).get('room');
  return r && /^[\w-]{1,64}$/.test(r) ? r : 'default';
}

type Sel =
  | { kind: 'strokes'; idx: number[] }
  | { kind: 'region'; parts: string[]; mask: Blob | null; maskImg: CanvasImageSource | null; at?: [number, number] };

function ToolBtn({ on, onClick, label, shortcut, children, disabled }: { on?: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <WarmTooltip content={label} shortcut={shortcut} side="bottom">
      <button type="button" aria-label={label} aria-pressed={on} onClick={onClick} disabled={disabled}
        className={`relative flex size-9 items-center justify-center rounded-[10px] transition-[background-color,color,transform] duration-150 active:scale-[0.94] disabled:opacity-35 ${on ? 'bg-[#e0dfff] text-[#3b37a5]' : 'text-[#1b1b1f] hover:bg-hover-2/70'}`}>
        {children}
        {shortcut && <span className={`absolute right-[3px] bottom-px text-[8.5px] leading-none ${on ? 'text-[#3b37a5]/70' : 'text-ink-3/70'}`}>{shortcut}</span>}
      </button>
    </WarmTooltip>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px bg-line-strong" />;
const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 text-xs text-ink-2">{children}</div>;
const btn = 'rounded-[10px] px-3 py-1.5 text-[13px] transition-[background-color,transform] active:scale-[0.97] disabled:opacity-40';
const primary = `${btn} bg-[#7c5cff] font-medium text-white hover:bg-[#6d4cf5]`;
const ghost = `${btn} text-ink-2 hover:bg-hover`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Avatar({ name, color, ring }: { name: string; color: string; ring?: boolean }) {
  return (
    <WarmTooltip content={name} side="bottom">
      <span className={`-ml-1.5 flex size-7 items-center justify-center rounded-full text-[10.5px] font-semibold text-white first:ml-0 ${ring ? 'shadow-[0_0_0_2px_#fff,0_0_0_3.5px_rgba(124,120,230,0.6)]' : 'shadow-[0_0_0_2px_#fff]'}`} style={{ background: color }}>
        {name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
      </span>
    </WarmTooltip>
  );
}

export default function Studio({ onClose, onPlace, projectId, sync }: {
  onClose?: () => void;
  /** Modell in den Canvas legen; projectId = Studio-Projekt, damit es später wieder hier geöffnet werden kann */
  onPlace?: (f: File, projectId: string) => Promise<void> | void;
  /** Vorhandenes Studio-Projekt öffnen (z. B. Modell aus dem Canvas zurückholen) */
  projectId?: string;
  /** Live-Sync des Canvas (gleicher Raum); ohne → eigene Verbindung (studio.html) */
  sync?: CanvasSync;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pad = useRef<Pad | null>(null);
  const view = useRef<View3d | null>(null);
  const live = useRef<StudioSync | null>(null);
  const [, setTick] = useState(0);
  const [, setStrokeRev] = useState(0);

  const [classes, setClasses] = useState<Cls[]>([]);
  const [subject, setSubject] = useState('butterfly');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tool, setTool] = useState<PadTool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [mirror, setMirror] = useState(true);
  const [guideOn, setGuideOn] = useState(true);
  const [fid, setFid] = useState(0.5);
  const [seed, setSeed] = useState(42);
  const [gen, setGen] = useState<Gen | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const [busy, setBusy] = useState<{ text: string; t0: number } | null>(null);
  const busyRef = useRef(false);
  const [remoteBusy, setRemoteBusy] = useState<Busy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [partText, setPartText] = useState('');
  const [sel, setSel] = useState<Sel | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [selText, setSelText] = useState('');
  const [showSketch, setShowSketch] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [fly, setFly] = useState(false);
  const [flySlow, setFlySlow] = useState(false);
  const [peers, setPeers] = useState<StudioPeer[]>([]);
  const [ready, setReady] = useState(false);
  /** erst nach dem Beitritt (Projekt geladen / Sitzung übernommen) eigenen Zustand veröffentlichen */
  const [joined, setJoined] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [aiText, setAiText] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const partBits = useRef(new Map<string, Uint8Array>());
  const planOverlay = useRef<HTMLCanvasElement | null>(null);
  const selOverlay = useRef<HTMLCanvasElement | null>(null);
  const followTo = useRef('');

  // Striche ins geteilte Dokument (nur Unterschiede; der Strich in Arbeit geht flüchtig per Awareness)
  const pushStrokes = useCallback(() => {
    const st = live.current, pd = pad.current;
    if (!st?.ready || !pd) return;
    const cur = new Set(pd.live().cur ?? []);
    st.writeStrokes(pd.strokes.filter((s) => !cur.has(s)));
  }, []);
  const pushQueued = useRef(false);
  const bump = useCallback(() => {
    setTick((x) => x + 1);
    if (pushQueued.current) return;
    pushQueued.current = true;
    queueMicrotask(() => { pushQueued.current = false; pushStrokes(); });
  }, [pushStrokes]);

  // ---------- Aufbau ----------
  const onRemote = useRef<(keys: Set<string>) => void>(() => {});
  const onJoin = useRef<() => void>(() => {});
  const onRemoteStrokes = useRef<() => void>(() => {});
  useEffect(() => {
    const p = new Pad(cvRef.current!);
    pad.current = p;
    const v = new View3d(hostRef.current!);
    view.current = v;
    const st = new StudioSync(sync ?? null, roomName());
    live.current = st;
    p.idPrefix = st.clientId.toString(36);
    let peerKey = '';
    st.onPeers = () => {
      const ps = st.peers();
      p.remote = ps;
      p.draw();
      const k = ps.map((x) => `${x.id}:${x.name}`).join('|');
      if (k !== peerKey) { peerKey = k; setPeers(ps); }
    };
    st.onStrokes = () => { onRemoteStrokes.current(); setStrokeRev((v) => v + 1); };
    st.onState = (keys) => onRemote.current(keys);
    st.onChat = () => setChat(st.messages());
    st.onReady = () => { setReady(true); setChat(st.messages()); st.onPeers?.(); onJoin.current(); };
    p.onLive = () => { const l = p.live(); st.setLive(l.cur, l.hover); };
    if (import.meta.env.DEV) (window as any).__studio = { pad: p, view: v, sync: st };
    api.classes().then(setClasses).catch((e) => setErr(e.message));
    return () => { st.destroy(); p.destroy(); v.destroy(); };
  }, [sync]);

  useEffect(() => {
    if (!busy && !remoteBusy) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [busy, remoteBusy]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [chat]);

  const p = pad.current;
  useEffect(() => {
    if (!pad.current) return;
    const pr = presetFor(subject);
    Object.assign(pad.current, { tool, color, width: SIZES[size].w, mirror: pr?.radial ? false : mirror, radial: pr?.radial ?? 0, guide: pr && guideOn ? pr.guide() : null, showSketch });
    pad.current.draw();
    if (view.current) {
      view.current.mode = tool === 'select' ? 'select' : tool === 'eraser' ? 'erase' : 'orbit';
      view.current.radius = Math.max(SIZES[size].w * 2, 12) / 2 / 256 * 1.6;
    }
  }, [tool, color, size, mirror, showSketch, subject, guideOn]);

  // Symmetrie passend zum Motiv (Schmetterling/Marienkäfer gespiegelt, Seestern fünfzählig), auch wenn ein anderes Gerät das Motiv wählt
  useEffect(() => { const pr = presetFor(subject); if (pr) setMirror(!!pr.mirror); }, [subject]);

  // Overlays (Plan = pink, Auswahl = blau) auf der Zeichenfläche
  const syncOverlays = useCallback(() => {
    if (!pad.current) return;
    pad.current.overlays = [planOverlay.current, selOverlay.current].filter(Boolean) as HTMLCanvasElement[];
    pad.current.draw();
  }, []);

  const run = useCallback(async <T,>(text: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ text, t0: Date.now() });
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  // ---------- Projekt anzeigen ----------
  const applyProject = useCallback(async (pr: Project, flash?: string) => {
    const pd = pad.current!;
    const fresh = projectRef.current?.id !== pr.id;
    setProject(pr);
    projectRef.current = pr;
    pd.version = pr.version;
    pd.underlay = await loadImg(url(pr.image));
    const bits = new Map<string, Uint8Array>();
    await Promise.all(pr.parts.map(async (q) => bits.set(q.id, maskBits(await loadImg(url(q.mask_url))))));
    partBits.current = bits;
    planOverlay.current = null;
    setPlan(null);
    setSel(null);
    selOverlay.current = null;
    syncOverlays();
    view.current?.setSelected([]);
    view.current?.setFlight(false);
    setFly(false);
    await view.current?.setProject(pr, flash);
    if (fresh) view.current?.frontView();
    bump();
  }, [bump, syncOverlays]);

  /** Lokalen Stand auf „leere Skizze“ zurücksetzen (ohne Rückfrage, z. B. weil jemand anderes neu begonnen hat). */
  const resetLocal = useCallback(() => {
    const pd = pad.current!;
    pd.version = null;
    pd.underlay = null;
    planOverlay.current = null;
    selOverlay.current = null;
    pd.overlays = [];
    setSel(null);
    setProject(null);
    projectRef.current = null;
    setPlan(null);
    setFly(false);
    view.current?.clear();
    pd.draw();
  }, []);

  /** Projektstand eines anderen übernehmen (neue Version nach Bearbeitung, anderes Projekt …). */
  const follow = useCallback(async (pj: { id: string; version: number } | null | undefined) => {
    const cur = projectRef.current;
    if (!pj) { if (cur) resetLocal(); return; }
    if (cur && cur.id === pj.id && cur.version === pj.version) return;
    const key = `${pj.id}@${pj.version}`;
    followTo.current = key;
    try {
      const pr = await api.project(pj.id);
      if (followTo.current !== key) return; // inzwischen neuerer Stand
      await applyProject(pr, pr.history.at(-1)?.part?.split(',')[0]);
    } catch (e) { setErr((e as Error).message); }
  }, [applyProject, resetLocal]);

  /** Vorhandenes Projekt öffnen (aus dem Canvas oder studio.html?project=<id>), inkl. der gespeicherten Skizze. */
  const openProject = useCallback(async (pid: string) => {
    const pd = pad.current!;
    try {
      const pr = await api.project(pid);
      setSubject(pr.subject || 'butterfly');
      setGen(null);
      setPicked(null);
      let strokes: Stroke[] = [];
      if (pr.sketch) {
        try {
          const raw = await (await fetch(url(pr.sketch))).json();
          if (Array.isArray(raw)) strokes = raw.map((s: Stroke, i: number) => ({ ...s, id: s.id ?? `${pd.idPrefix}-k${i}`, o: s.o ?? i }));
        } catch { /* ohne Skizze weiter */ }
      }
      pd.setStrokes(strokes);
      await applyProject(pr);
      setTool('select');
    } catch (e) { setErr((e as Error).message); }
  }, [applyProject]);

  // ---------- Live-Sync: beitreten, übernehmen, veröffentlichen ----------
  onRemoteStrokes.current = () => {
    const st = live.current, pd = pad.current;
    if (!st || !pd) return;
    pd.setStrokes(st.readStrokes());
    if (projectRef.current) schedulePlanRef.current();
    setTick((x) => x + 1);
  };
  onRemote.current = (keys) => {
    const st = live.current!;
    if (keys.has('subject')) setSubject(st.get<string>('subject') || 'butterfly');
    if (keys.has('gen')) setGen(st.get<Gen>('gen') ?? null);
    if (keys.has('picked')) setPicked(st.get<number>('picked') ?? null);
    if (keys.has('note')) setNote(st.get<string>('note') ?? null);
    if (keys.has('busy')) { const b = st.get<Busy>('busy'); setRemoteBusy(b && b.client !== st.clientId ? b : null); }
    if (keys.has('project')) follow(st.get('project'));
  };
  onJoin.current = () => {
    const st = live.current!, pd = pad.current!;
    const pid = projectId ?? new URLSearchParams(location.search).get('project');
    if (pid) { openProject(pid).finally(() => setJoined(true)); return; }
    if (st.hasContent()) {
      // laufende Studio-Sitzung im Raum → mitmachen
      pd.setStrokes(st.readStrokes());
      onRemote.current(new Set(['subject', 'gen', 'picked', 'note', 'busy', 'project']));
      setTick((x) => x + 1);
      setJoined(true);
      return;
    }
    st.set('subject', subject);
    pushStrokes();
    setJoined(true);
  };

  // Eigene Änderungen am Zustand veröffentlichen (set() überträgt nur echte Änderungen → keine Echos)
  const projKey = project ? `${project.id}@${project.version}` : '';
  useEffect(() => { if (joined) live.current?.set('subject', subject); }, [joined, subject]);
  useEffect(() => { if (joined) live.current?.set('gen', gen); }, [joined, gen]);
  useEffect(() => { if (joined) live.current?.set('picked', picked); }, [joined, picked]);
  useEffect(() => { if (joined) live.current?.set('note', note); }, [joined, note]);
  useEffect(() => {
    const st = live.current, pr = projectRef.current;
    if (joined && st) st.set('project', pr ? { id: pr.id, version: pr.version } : null);
  }, [joined, projKey]);
  useEffect(() => {
    const st = live.current;
    if (!joined || !st) return;
    if (busy) st.set('busy', { ...busy, by: st.me.name, client: st.clientId });
    else if (st.get<Busy>('busy')?.client === st.clientId) st.set('busy', null);
  }, [joined, busy]);

  // ---------- Auswahl ----------
  const setSelection = useCallback(async (s: Sel | null) => {
    setSel(s);
    const pd = pad.current!;
    if (!s) { selOverlay.current = null; view.current?.setSelected([]); syncOverlays(); return; }
    const o = document.createElement('canvas');
    o.width = o.height = N;
    const c = o.getContext('2d')!;
    if (s.kind === 'strokes') {
      const list = s.idx.map((i) => pd.strokes[i]).map((x) => ({ ...x, w: x.w + 8, c: SEL }));
      c.globalAlpha = 0.35;
      drawStrokes(c, list);
    } else {
      const pr = projectRef.current;
      for (const id of s.parts) {
        const q = pr?.parts.find((x) => x.id === id);
        if (q) c.drawImage(tint(await loadImg(url(q.mask_url)), SEL, 95), 0, 0);
      }
      if (s.maskImg) c.drawImage(tint(s.maskImg, SEL, 95), 0, 0);
    }
    selOverlay.current = o;
    view.current?.setSelected(s.kind === 'region' ? s.parts : []);
    syncOverlays();
  }, [syncOverlays]);

  const partAt = useCallback((x: number, y: number) => {
    const i = Math.round(y) * N + Math.round(x);
    let best: string | null = null, area = Infinity;
    for (const [id, b] of partBits.current) {
      if (!b[i]) continue;
      let a = 0;
      for (let k = 0; k < b.length; k += 7) a += b[k];
      if (a < area) { area = a; best = id; }
    }
    return best;
  }, []);

  const pickPart = useCallback((id: string | null, add: boolean, at?: [number, number]) => {
    const cur = selRef.current;
    const prev = cur?.kind === 'region' ? cur : null;
    if (!id) { if (!add) setSelection(null); return; }
    let parts = add && prev ? [...prev.parts] : [];
    parts = parts.includes(id) && add ? parts.filter((x) => x !== id) : [...new Set([...parts, id])];
    setSelection(parts.length || (add && prev?.mask) ? { kind: 'region', parts, mask: add ? prev?.mask ?? null : null, maskImg: add ? prev?.maskImg ?? null : null, at } : null);
  }, [setSelection]);

  // ---------- Plan für neue Striche (live) ----------
  const planTimer = useRef(0);
  const planAbort = useRef<AbortController | null>(null);
  const schedulePlan = useCallback(() => {
    clearTimeout(planTimer.current);
    planTimer.current = window.setTimeout(async () => {
      const pd = pad.current!, pr = projectRef.current;
      if (!pr) return;
      const ns = pd.newStrokes();
      planAbort.current?.abort();
      if (!ns.length) { setPlan(null); planOverlay.current = null; syncOverlays(); setTick((x) => x + 1); return; }
      const ac = new AbortController();
      planAbort.current = ac;
      try {
        const j = await api.plan(pr.id, await pd.png(ns, false), ac.signal);
        if (ac.signal.aborted) return;
        setPlan(j.text);
        planOverlay.current = j.seg_url ? tint(await loadImg(url(j.seg_url)), '#ff3b9a', 70) : null;
        syncOverlays();
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setPlan(`⚠ ${(e as Error).message}`);
      }
      setTick((x) => x + 1);
    }, 300);
  }, [syncOverlays]);
  const schedulePlanRef = useRef(schedulePlan);
  schedulePlanRef.current = schedulePlan;

  // ---------- Erzeugen: 2 Versionen ----------
  const generate = useCallback(async (nextSeed?: number) => {
    const pd = pad.current!;
    const sk = pd.strokes.filter((s) => !s.erase);
    if (!sk.length) { setErr('Draw something first.'); return; }
    if (projectRef.current && !confirm('New versions start a new model. The current one stays in the home PC history. Continue?')) return;
    const s = nextSeed ?? seed;
    await run('Drawing 2 versions …', async () => {
      pd.version = null;
      pd.strokes.forEach((x) => { x.v = 0; delete x.part; });
      setProject(null);
      projectRef.current = null;
      view.current?.clear();
      setSelection(null);
      const g = await api.sketch2img(await pd.png(pd.strokes, true), subject, JSON.stringify(pd.strokes), fid, s, 2);
      setGen(g);
      setPicked(null);
      setNote(`Pick a version. It becomes the 3D model. (${g.seconds.toFixed(0)} s)`);
    });
    bump();
  }, [seed, subject, fid, run, setSelection, bump]);

  const pick = useCallback(async (i: number) => {
    if (!gen) return;
    if (projectRef.current && projectRef.current.version > 0 && !confirm('Pick another version? Your edits to the model will be lost.')) return;
    setPicked(i);
    await run('Building the 3D model and splitting it into parts …', async () => {
      const j = await api.img2three(gen.id, i);
      pad.current!.strokes.forEach((s) => { s.v = 0; s.part = 'p0'; });
      await applyProject(j.project);
      view.current?.frontView();
      setNote(`3D ready in ${j.seconds.toFixed(0)} s · ${j.project.parts.length} parts. Keep drawing, erase, select parts or ask the AI.`);
      setTool('select');
    });
  }, [gen, run, applyProject]);

  // ---------- Bearbeiten ----------
  const applyStrokes = useCallback(async () => {
    const pd = pad.current!, pr = projectRef.current;
    if (!pr) return;
    const ns = pd.newStrokes();
    if (!ns.length) return;
    const nv = pr.version + 1;
    await run('Adding the new strokes to the model …', async () => {
      const j = await api.edit(pr.id, await pd.png(pd.strokes, true), await pd.png(ns, false),
        JSON.stringify(pd.strokes.map((s) => (pd.isNew(s) ? { ...s, v: nv } : s))), fid, partText);
      ns.forEach((s) => { s.v = nv; s.part = j.changed; });
      pd.strokes.forEach((s) => { if (s.erase && (s.v ?? 0) > pr.version) s.v = nv; });
      setPartText('');
      await applyProject(j, j.changed);
      setNote(`${j.info} · ${j.seconds} s`);
    });
  }, [fid, partText, run, applyProject]);

  const onErase = useCallback(async (done: Stroke[]) => {
    const pd = pad.current!, pr = projectRef.current;
    if (!pr) return; // vor dem Modell radiert der Radierer nur Striche
    const res = await run('Erasing in the model …', async () => {
      const j = await api.erase(pr.id, await pd.png(done, false, '#ff0000'), JSON.stringify(pd.strokes));
      await applyProject(j);
      setNote(`Erased: ${j.info}`);
      return true;
    });
    if (!res) { pd.strokes = pd.strokes.filter((s) => !done.includes(s)); pd.draw(); bump(); }
  }, [run, applyProject, bump]);

  const onErase3d = useCallback(async (part: string, pts: number[][], radius: number) => {
    const pr = projectRef.current;
    if (!pr) return;
    await run('Erasing in the 3D model …', async () => {
      const j = await api.erase3d(pr.id, part, pts, radius);
      await applyProject(j);
      setNote(`3D erased: ${j.info}`);
    });
  }, [run, applyProject]);

  const regionOp = useCallback(async (op: 'recolor' | 'restyle' | 'replace' | 'delete', extra: { color?: string; text?: string } = {}) => {
    const pr = projectRef.current, s = selRef.current;
    if (!pr || s?.kind !== 'region') return;
    const label = { recolor: 'Recoloring …', restyle: 'Generating a new surface …', replace: 'Generating a replacement …', delete: 'Deleting …' }[op];
    await run(label, async () => {
      const j = await api.region(pr.id, op, { mask: s.mask, parts: s.parts, ...extra });
      await applyProject(j, j.changed?.split(',')[0]);
      setNote(`${j.info} · ${j.seconds} s`);
      setSelText('');
    });
  }, [run, applyProject]);

  const refineSel = useCallback(async () => {
    const pr = projectRef.current, s = selRef.current;
    if (!pr || s?.kind !== 'region' || !s.at) return;
    await run('Magic wand: finding the segment …', async () => {
      const j = await api.segmentAt(pr.id, s.at![0], s.at![1]);
      const img = await loadImg(url(j.mask));
      const blob = await (await fetch(url(j.mask))).blob();
      await setSelection({ kind: 'region', parts: [], mask: blob, maskImg: img, at: s.at });
    });
  }, [run, setSelection]);

  // Auswahl in Strichen (vor dem Modell)
  const strokeSelOp = useCallback((op: 'delete' | string) => {
    const pd = pad.current!, s = selRef.current;
    if (s?.kind !== 'strokes') return;
    if (op === 'delete') pd.strokes = pd.strokes.filter((_, i) => !s.idx.includes(i));
    else s.idx.forEach((i) => (pd.strokes[i].c = op));
    setSelection(null);
    pd.draw();
    bump();
  }, [setSelection, bump]);

  // ---------- Ask AI (ChatGPT plant, Heim-PC führt aus) ----------
  /** Bild der Figur + dasselbe Bild mit eingefärbten, nummerierten Teilen (damit die KI Teile per Auge wählt). */
  const aiInputs = useCallback(async (pr: Project) => {
    const im = await loadImg(url(pr.image));
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    g.drawImage(im, 0, 0, N, N);
    const image = c.toDataURL('image/jpeg', 0.85);
    const data = g.getImageData(0, 0, N, N);
    let total = 0;
    const stats: AiPart[] = [];
    pr.parts.forEach((q, k) => {
      const b = partBits.current.get(q.id);
      if (!b) return;
      const [r, gg, bb] = [1, 3, 5].map((i) => parseInt(LABEL_COLORS[k % LABEL_COLORS.length].slice(i, i + 2), 16));
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < b.length; i++) {
        if (!b[i]) continue;
        n++; sx += i % N; sy += (i / N) | 0;
        const o = i * 4;
        data.data[o] = data.data[o] * 0.45 + r * 0.55; data.data[o + 1] = data.data[o + 1] * 0.45 + gg * 0.55; data.data[o + 2] = data.data[o + 2] * 0.45 + bb * 0.55;
      }
      total += n;
      if (n) stats.push({ id: q.id, name: partName(q.name), cx: sx / n, cy: sy / n, share: n });
    });
    g.putImageData(data, 0, 0);
    g.font = '700 15px system-ui, sans-serif';
    for (const s of stats) {
      const w = g.measureText(s.id).width + 10;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.roundRect(s.cx - w / 2, s.cy - 10, w, 20, 6); g.fill();
      g.fillStyle = '#111';
      g.fillText(s.id, s.cx - w / 2 + 5, s.cy + 5);
    }
    return { image, labeled: c.toDataURL('image/jpeg', 0.85), parts: stats.map((s) => ({ ...s, share: +(s.share / Math.max(total, 1)).toFixed(3) })) };
  }, []);

  const stepLabel = (s: AiStep, names: string) =>
    s.op === 'palette' ? `Recoloring ${names}` : s.op === 'restyle' ? `New surface on ${names}` : s.op === 'replace' ? `Replacing ${names}` : `Removing ${names}`;

  const askAi = useCallback(async (text: string) => {
    const st = live.current, pr0 = projectRef.current;
    const t = text.trim();
    if (!t || !st) return;
    if (!pr0) { setErr('Build a 3D model first, then describe changes here.'); return; }
    if (busyRef.current) return;
    setAiText('');
    st.push({ role: 'user', text: t });
    const aid = st.push({ role: 'ai', text: 'Looking at the model …', status: 'working' });
    await run('AI is looking at the model …', async () => {
      try {
        const inp = await aiInputs(pr0);
        const s = selRef.current;
        const plan = await api.aiPlan({
          prompt: t, subject: pr0.subject || subject, parts: inp.parts, image: inp.image, labeled: inp.labeled,
          selected: s?.kind === 'region' ? s.parts : [],
          history: st.messages().filter((m) => m.id !== aid).slice(-7, -1).map((m) => ({ role: m.role, text: m.text })),
        });
        st.update(aid, { text: plan.reply || (plan.steps.length ? 'On it.' : 'I could not turn that into an edit.'), status: plan.steps.length ? 'working' : 'done' });
        const infos: string[] = [];
        for (const [i, step] of plan.steps.entries()) {
          const pr = projectRef.current!;
          const names = step.parts.map((id) => partName(pr.parts.find((x) => x.id === id)?.name ?? id)).join(', ');
          setBusy({ text: `AI · ${stepLabel(step, names)}${plan.steps.length > 1 ? ` (${i + 1}/${plan.steps.length})` : ''} …`, t0: Date.now() });
          // erst zeigen, welche Teile die KI meint, dann ändern
          await setSelection({ kind: 'region', parts: step.parts, mask: null, maskImg: null });
          await sleep(900);
          const j = await api.region(pr.id, step.op, { parts: step.parts, colors: step.colors, text: step.text });
          await applyProject(j, j.changed?.split(',')[0]);
          infos.push(j.info ?? "");
        }
        if (plan.steps.length) {
          st.update(aid, { status: 'done', detail: infos.join(' · ') });
          setNote(`AI: ${infos.join(' · ')}${plan.modus === 'mock' ? ' (test mode without OpenAI key)' : ''}`);
        }
      } catch (e) {
        st.update(aid, { status: 'error', text: (e as Error).message });
        throw e;
      }
    });
  }, [run, aiInputs, subject, setSelection, applyProject]);

  // ---------- Pad-Callbacks ----------
  useEffect(() => {
    const pd = pad.current, v = view.current;
    if (!pd || !v) return;
    pd.onChange = () => { if (projectRef.current) schedulePlan(); bump(); };
    pd.onStrokeEnd = (kind, done) => {
      if (selRef.current) setSelection(null);
      if (kind === 'erase') onErase(done);
    };
    pd.onLasso = async (poly) => {
      if (!projectRef.current) {
        const idx = pd.strokes.map((s, i) => (!s.erase && s.pts.some(([x, y]) => inPoly(x, y, poly)) ? i : -1)).filter((i) => i >= 0);
        setSelection(idx.length ? { kind: 'strokes', idx } : null);
        return;
      }
      const blob = await polyMask(poly);
      const img = await loadImg(URL.createObjectURL(blob));
      const c = poly.reduce((a, [x, y]) => [a[0] + x / poly.length, a[1] + y / poly.length], [0, 0]) as [number, number];
      setSelection({ kind: 'region', parts: [], mask: blob, maskImg: img, at: c });
    };
    pd.onClick = (x, y, add) => {
      if (!projectRef.current) { setSelection(null); return; }
      pickPart(partAt(x, y), add, [x, y]);
    };
    v.onPick = (id, add) => pickPart(id, add);
    v.onErase = onErase3d;
  }, [schedulePlan, onErase, onErase3d, pickPart, partAt, setSelection, bump]);

  // ---------- Rückgängig ----------
  const undo = useCallback(async () => {
    const pd = pad.current!;
    if (pd.undo()) return;
    const pr = projectRef.current;
    if (!pr || pr.version === 0) return;
    await run('Undoing the last change …', async () => {
      const j = await api.undo(pr.id);
      pd.strokes = pd.strokes.filter((s) => !(s.erase && (s.v ?? 0) > j.version));
      pd.strokes.forEach((s) => { if ((s.v ?? 0) > j.version) { s.v = j.version + 1; delete s.part; } });
      await applyProject(j);
      setNote(`Back to version ${j.version}. The strokes of that change are “new” again.`);
      schedulePlan();
    });
  }, [run, applyProject, schedulePlan]);

  const restart = useCallback(() => {
    const pd = pad.current!;
    if ((pd.strokes.length || projectRef.current) && !confirm('Start an empty sketch? (for everyone in this room)')) return;
    pd.strokes = [];
    resetLocal();
    setGen(null);
    setPicked(null);
    setNote(null);
    setErr(null);
    setTool('pen');
    live.current?.clearChat();
    bump();
  }, [resetLocal, bump]);

  const toggleFly = useCallback(() => {
    const v = view.current;
    if (!v) return;
    if (v.flying) { v.setFlight(false); v.frontView(); setFly(false); return; }
    setSelection(null);
    const info = v.setFlight(true, flySlow ? 0.25 : 1, presetFor(subject)?.fly ?? 'wings');
    setFly(!!info);
    if (info) setNote(`${v.flightLabel} · ${Math.round(info.verts / 1000)}k points`);
    else setErr('No model found for the flight');
  }, [flySlow, subject, setSelection]);

  const exportFly = useCallback(async () => {
    await run('Exporting flight GLB …', async () => {
      const f = await view.current?.exportFlight();
      if (!f) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
    });
  }, [run]);

  const place = useCallback(async () => {
    const pr = projectRef.current;
    if (!pr) return;
    await run('Exporting …', async () => {
      const f = await api.exportGlb(pr.id);
      if (onPlace) { await onPlace(f, pr.id); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
    });
  }, [run, onPlace]);

  // ---------- Tastatur ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea')) return;
      // Als Overlay in der Canvas-App: Tasten nicht an den Canvas durchreichen (sonst z. B. Entf im Canvas)
      if (onClose) e.stopImmediatePropagation();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) { pad.current?.redo(); } else undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'p' || k === 'b') setTool('pen');
      else if (k === 'e') setTool('eraser');
      else if (k === 'l') setTool('line');
      else if (k === 'r') setTool('rect');
      else if (k === 'o') setTool('ellipse');
      else if (k === 'v') setTool('select');
      else if (k === 's') setMirror((m) => !m);
      else if (k === 'escape') setSelection(null);
      else if ((k === 'delete' || k === 'backspace') && selRef.current) {
        e.preventDefault();
        if (selRef.current.kind === 'strokes') strokeSelOp('delete'); else regionOp('delete');
      } else if (k === 'enter') {
        e.preventDefault();
        if (projectRef.current) applyStrokes(); else generate();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, setSelection, strokeSelOp, regionOp, applyStrokes, generate, onClose]);

  // ---------- Ableitungen ----------
  const newCount = p?.newStrokes().length ?? 0;
  const strokeCount = p?.strokes.filter((s) => !s.erase).length ?? 0;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return classes.filter((c) => !t || c.label.toLowerCase().includes(t)).slice(0, 60);
  }, [classes, q]);
  const preset = presetFor(subject);
  const canFly = !!preset?.fly;
  const subjEn = QUICK.find((x) => x.name === subject)?.en ?? subject;
  const subjLower = subjEn.toLowerCase();
  const selParts = sel?.kind === 'region' ? sel.parts.map((id) => partName(project?.parts.find((x) => x.id === id)?.name ?? id)) : [];
  const icon = { size: 19, stroke: 1.6 };
  const fidInfo = fid < 0.34 ? 'loose' : fid < 0.67 ? 'balanced' : 'exact';
  const anyBusy = !!busy || !!remoteBusy;
  const shownBusy = busy ?? (remoteBusy ? { text: `${remoteBusy.by}: ${remoteBusy.text}`, t0: remoteBusy.t0 } : null);
  const article = /^[aeiou]/i.test(subjEn) ? 'an' : 'a';

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-auto bg-canvas text-sm text-ink select-none">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 pr-2 text-[15px] font-semibold"><IconSparkles size={18} className="text-[#7c5cff]" />AI Studio</div>
        <div className="relative">
          <button className="flex items-center gap-1.5 rounded-[12px] bg-surface px-3 py-2 shadow-raised" onClick={() => setPickerOpen((o) => !o)} disabled={!!project}
            title={project ? 'The animal is fixed for this project. Use “New” to pick another' : 'Pick an animal'}>
            <span className="text-ink-3">Animal:</span><b className="font-medium">{subjEn}</b>
          </button>
          {pickerOpen && !project && (
            <div className="absolute top-11 left-0 z-20 w-72 rounded-[14px] bg-surface p-3 shadow-raised" style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both' }}>
              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((x) => (
                  <button key={x.name} onClick={() => { setSubject(x.name); setMirror(!!presetFor(x.name)?.mirror || x.name === 'owl'); setPickerOpen(false); }}
                    className={`rounded-full px-2.5 py-1 text-[12.5px] ${subject === x.name ? 'bg-[#e0dfff] text-[#3b37a5]' : 'bg-hover hover:bg-hover-2'}`}>{x.en}</button>
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 rounded-[10px] bg-field px-2">
                <IconSearch size={14} className="text-ink-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="All animals (Objaverse) … or type one"
                  onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { setSubject(q.trim()); setPickerOpen(false); } }}
                  className="h-8 w-full bg-transparent text-[13px] outline-none" />
              </div>
              <div className="mt-1.5 max-h-56 overflow-auto">
                {filtered.map((c) => (
                  <button key={c.name} onClick={() => { setSubject(c.label); setPickerOpen(false); }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] hover:bg-hover">
                    <span>{c.label}</span><small className="text-ink-3 tabular-nums">{c.count.toLocaleString('en-US')}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tools like in the canvas app */}
        <div className="mx-auto flex items-center gap-0.5 rounded-[14px] bg-surface p-1 shadow-raised">
          <WarmTooltipGroup>
            <ToolBtn on={tool === 'pen'} onClick={() => setTool('pen')} label={`AI pen · ${COLOR_NAMES[color] ?? color}`} shortcut="P">
              <IconSparkles {...icon} />
              <span className="absolute bottom-[3px] left-[4px] size-2.5 rounded-full" style={{ background: color, boxShadow: '0 0 0 1.5px #fff, 0 0 0 2.5px rgba(0,0,0,0.12)' }} />
            </ToolBtn>
            <ToolBtn on={tool === 'line'} onClick={() => setTool('line')} label="Line" shortcut="L"><IconLine {...icon} /></ToolBtn>
            <ToolBtn on={tool === 'rect'} onClick={() => setTool('rect')} label="Rectangle (Shift = square)" shortcut="R"><IconSquare {...icon} /></ToolBtn>
            <ToolBtn on={tool === 'ellipse'} onClick={() => setTool('ellipse')} label="Ellipse (Shift = circle)" shortcut="O"><IconCircle {...icon} /></ToolBtn>
            <ToolBtn on={tool === 'eraser'} onClick={() => setTool('eraser')} label={project ? 'Eraser (also erases in the model and the 3D view)' : 'Eraser'} shortcut="E"><IconEraser {...icon} /></ToolBtn>
            <ToolBtn on={tool === 'select'} onClick={() => setTool('select')} label={project ? 'Select: click = part, drag = lasso, Shift = several' : 'Select (lasso around strokes)'} shortcut="V"><IconPointer {...icon} /></ToolBtn>
            <Sep />
            {preset?.radial
              ? <ToolBtn on label={`${preset.radial}-fold symmetry (draw one arm)`} onClick={() => undefined}><IconStar {...icon} /></ToolBtn>
              : <ToolBtn on={mirror} onClick={() => setMirror((m) => !m)} label="Mirror (draw symmetrically)" shortcut="S"><IconFlipVertical {...icon} style={{ transform: 'rotate(90deg)' }} /></ToolBtn>}
            {preset && !project && (
              <ToolBtn on={guideOn} onClick={() => setGuideOn((g) => !g)} label={`Template: ${preset.en} outline to trace (not part of the sketch)`}><IconLayoutGrid {...icon} /></ToolBtn>
            )}
            {project && (
              <ToolBtn on={showSketch} onClick={() => setShowSketch((x) => !x)} label="Show the original sketch">{showSketch ? <IconEye {...icon} /> : <IconEyeOff {...icon} />}</ToolBtn>
            )}
            <Sep />
            <ToolBtn onClick={undo} label="Undo (Ctrl+Z). On the model: undo the last change" disabled={anyBusy}><IconArrowBackUp {...icon} /></ToolBtn>
            <ToolBtn onClick={() => pad.current?.redo()} label="Redo (Ctrl+Shift+Z)"><IconArrowForwardUp {...icon} /></ToolBtn>
            <ToolBtn onClick={restart} label="New (empty sketch)"><IconTrash {...icon} /></ToolBtn>
          </WarmTooltipGroup>
        </div>

        <div className="flex items-center gap-2">
          {/* Live: who else is in the studio */}
          <WarmTooltip content={peers.length ? `${peers.length + 1} people in this studio, everything syncs live` : 'Live sync on. Open this room on another device to draw together'} side="bottom">
            <div className="flex items-center gap-2 rounded-[12px] bg-surface py-1 pr-1.5 pl-2.5 shadow-raised" data-testid="studio-live">
              <span className={`size-2 rounded-full ${ready ? 'bg-emerald-500' : 'animate-pulse bg-amber-400'}`} />
              <span className="text-[12.5px] text-ink-2">Live</span>
              <div className="flex items-center">
                {live.current && <Avatar name={`${live.current.me.name} (you)`} color={live.current.me.color} ring />}
                {peers.slice(0, 4).map((x) => <Avatar key={x.id} name={x.name} color={x.color} />)}
              </div>
            </div>
          </WarmTooltip>
          {project && (
            <button className={primary + ' flex items-center gap-1.5'} onClick={place} disabled={anyBusy}>
              {onPlace ? <IconCube size={16} /> : <IconDownload size={16} />}{onPlace ? 'To canvas' : 'GLB'}
            </button>
          )}
          {onClose && <button className="flex size-9 items-center justify-center rounded-[10px] bg-surface shadow-raised hover:bg-hover" onClick={onClose} aria-label="Close"><IconX size={18} /></button>}
        </div>
      </div>

      <div className="grid flex-1 gap-3 px-4 pb-24 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Properties */}
        <div className="grid h-max gap-4 rounded-[14px] bg-surface p-4 shadow-raised">
          <div>
            <Label>Color</Label>
            <div className="grid grid-cols-6 gap-1.5">
              {COLORS.map((c) => {
                const on = color === c;
                return (
                  <button key={c} aria-label={c} aria-pressed={on} data-testid={`color-${c}`} onClick={() => { setColor(c); if (tool === 'eraser' || tool === 'select') setTool('pen'); }}
                    style={{ background: c, boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px #7c5cff` : 'inset 0 0 0 1px rgba(0,0,0,0.12)' }}
                    className={`flex size-7 items-center justify-center rounded-md transition-transform duration-150 hover:scale-105 ${on ? 'scale-110' : ''}`}>
                    {on && <IconCheck size={15} stroke={3} color={light(c) ? '#1b1b1f' : '#fff'} />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2" data-testid="current-color">
              <span className="size-4 rounded-full" style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }} />
              <span>Current: <b className="font-medium text-ink">{COLOR_NAMES[color] ?? color}</b></span>
            </div>
            <div className="mt-1 text-[11.5px] leading-snug text-ink-3">Black = shape · color = color in the model (big brushes for areas)</div>
          </div>
          <div>
            <Label>Brush</Label>
            <div className="flex gap-1.5">
              {SIZES.map((s, i) => (
                <button key={s.k} aria-label={`Brush ${s.k}`} onClick={() => setSize(i)}
                  className={`flex h-9 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg ${size === i ? 'bg-[#e0dfff] text-[#3b37a5]' : 'bg-neutral-100/80 text-neutral-500 hover:bg-violet-50'}`}>
                  <span className="rounded-full" style={{ width: Math.min(4 + s.w / 2, 18), height: Math.min(4 + s.w / 2, 18), background: color === '#ffffff' ? '#e6e6ea' : color }} />
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-between px-1 text-[10.5px] text-ink-3">{SIZES.map((s) => <span key={s.k}>{s.k}</span>)}</div>
          </div>
          <div>
            <Label>Line fidelity <span className="text-ink-3">· {fidInfo} ({fid.toFixed(2)})</span></Label>
            <Slider value={[fid * 100]} min={0} max={100} step={5} onValueChange={(v) => setFid(v[0] / 100)} aria-label="Line fidelity" />
            <div className="mt-1 flex justify-between text-[10.5px] text-ink-3"><span>AI free</span><span>exactly like sketch</span></div>
          </div>
          {project && (
            <div>
              <Label>Parts ({project.parts.length}) <span className="text-ink-3">· double-click = rename</span></Label>
              <div className="grid max-h-64 gap-0.5 overflow-auto">
                {project.parts.map((q) => {
                  const on = sel?.kind === 'region' && sel.parts.includes(q.id);
                  return (
                    <button key={q.id} onClick={(e) => { setTool('select'); pickPart(q.id, e.shiftKey); }}
                      onDoubleClick={async () => {
                        const n = prompt('Part name (helps the AI, e.g. left wing, antenna):', q.name.startsWith('Segment') ? '' : partName(q.name));
                        if (n) await applyProject(await api.rename(project.id, q.id, n));
                      }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] ${on ? 'bg-[#e0dfff] text-[#3b37a5]' : 'hover:bg-hover'}`}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: on ? SEL : '#c8c8d0' }} />
                      <span className="flex-1 truncate">{partName(q.name)}</span>
                      {q.state !== 'unverändert' && <span className="text-[10.5px] text-[#b35900]">{STATE_EN[q.state] ?? q.state}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sketch */}
        <div className="relative">
          <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-ink-2">
            <span>{project ? `Sketch on model · version ${project.version}` : 'Sketch'}</span>
            <span className="text-ink-3">{project ? (newCount ? `${newCount} new strokes` : 'Draw = add · erase = remove') : `${strokeCount} strokes`}</span>
          </div>
          <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-white shadow-raised">
            <canvas ref={cvRef} data-testid="pad" className={`absolute inset-0 size-full touch-none ${tool === 'select' ? 'cursor-default' : 'cursor-none'}`} />
            {!strokeCount && !project && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[13px] text-ink-3">
                <div>{preset ? preset.tip : <>Draw {article} {subjLower}{mirror ? ', mirror is on' : ''}.</>}<br />Then <b>Enter</b> or “2 versions”.</div>
              </div>
            )}
            {shownBusy && (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-white/85 px-3 py-2 text-[12.5px] text-ink-2 backdrop-blur" data-testid="busy">
                <IconLoader2 size={15} className="animate-spin text-[#7c5cff]" />{shownBusy.text}
                <span className="ml-auto tabular-nums text-ink-3">{Math.max(0, (now - shownBusy.t0) / 1000).toFixed(0)} s</span>
              </div>
            )}
          </div>
        </div>

        {/* Versions / 3D + Ask AI */}
        <div className="relative">
          <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-ink-2">
            <span>{project ? '3D model · drag = rotate' : gen ? 'Pick a version' : '3D model'}</span>
            {project && (
              <span className="flex items-center gap-3">
                {canFly && (
                  <button data-testid="fly" onClick={toggleFly} disabled={anyBusy}
                    className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${fly ? 'bg-[#e0dfff] text-[#3b37a5]' : 'text-ink-3 hover:text-ink'}`}>
                    <IconButterfly size={14} />{fly ? 'Stop flight' : 'Fly'}
                  </button>
                )}
                {!fly && <button className="text-ink-3 hover:text-ink" onClick={() => view.current?.frontView()}>View like sketch</button>}
              </span>
            )}
          </div>
          <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#f3f3f6] shadow-raised">
            <div ref={hostRef} data-testid="view3d" className="absolute inset-0" />
            {fly && (
              <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-[12px] bg-white/90 p-1.5 text-[12.5px] text-ink-2 shadow-raised backdrop-blur">
                <button className={ghost + ' flex items-center gap-1'} onClick={() => { const s = !flySlow; setFlySlow(s); view.current?.setFlightSpeed(s ? 0.25 : 1); }}>
                  {flySlow ? <IconPlayerPlay size={15} /> : <IconPlayerPause size={15} />}{flySlow ? 'Normal' : 'Slow motion'}
                </button>
                <span className="flex-1 truncate text-ink-3">Animation “{preset?.fly === 'elytra' ? 'flutter' : 'flap'}” · in place · loop</span>
                <button className={primary + ' flex items-center gap-1.5'} onClick={exportFly} disabled={anyBusy} data-testid="fly-export"><IconDownload size={15} />Flight GLB</button>
              </div>
            )}
            {!project && gen && (
              <div className="absolute inset-0 grid grid-cols-2 content-center gap-2 bg-[#f3f3f6] p-2">
                {gen.images.map((im, i) => (
                  <button key={im} onClick={() => pick(i)} disabled={anyBusy} data-testid={`version-${i}`}
                    className={`group relative aspect-square overflow-hidden rounded-[12px] bg-white ring-[#7c5cff] transition hover:ring-2 ${picked === i ? 'ring-3' : ''}`}>
                    <img src={url(im)} className="size-full object-contain" />
                    <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[12px] font-medium shadow">Version {'AB'[i]}</span>
                    <span className="absolute inset-x-2 bottom-2 rounded-[10px] bg-[#7c5cff] py-1.5 text-[12.5px] font-medium text-white opacity-0 transition group-hover:opacity-100">{picked === i && anyBusy ? 'turning into 3D …' : 'Use this one → 3D'}</span>
                  </button>
                ))}
              </div>
            )}
            {!project && !gen && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-ink-3">2 versions to pick from appear here, then the 3D model.</div>
            )}
          </div>
          {!project && gen && (
            <div className="mt-2 flex items-center gap-2 px-1">
              <button className={ghost + ' flex items-center gap-1.5'} disabled={anyBusy} onClick={() => { const s = seed + 2; setSeed(s); generate(s); }}><IconRefresh size={15} />2 new versions</button>
            </div>
          )}

          {/* Ask AI: edit the model in words (ChatGPT plans, the home PC executes) */}
          <div className="mt-3 rounded-[14px] bg-surface p-2.5 shadow-raised" data-testid="ask-ai">
            <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-ink-2">
              <span className="ai-tool flex size-6 items-center justify-center rounded-[8px]"><IconWand size={14} className="text-[#7c5cff]" /></span>
              <span className="font-medium text-ink">Ask AI</span>
              <span className="text-ink-3">· describe a change, ChatGPT picks the parts</span>
            </div>
            {chat.length > 0 && (
              <div className="mb-2 grid max-h-44 gap-1.5 overflow-auto px-1" data-testid="ai-chat">
                {chat.slice(-8).map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`} style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}>
                    <div className={`max-w-[88%] rounded-[12px] px-2.5 py-1.5 text-[12.5px] leading-snug ${m.role === 'user' ? 'bg-[#efeeff] text-[#2d2a7a]' : m.status === 'error' ? 'bg-[#fff0f0] text-[#c92a2a]' : 'bg-hover text-ink'}`}>
                      {m.role === 'user' && <span className="mr-1 font-semibold" style={{ color: m.color }}>{m.by.split(' ')[0]}:</span>}
                      {m.status === 'working' && <IconLoader2 size={12} className="mr-1 inline animate-spin text-[#7c5cff]" />}
                      {m.text}
                      {m.detail && <div className="mt-0.5 text-[11px] text-ink-3">{m.detail}</div>}
                    </div>
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <input value={aiText} onChange={(e) => setAiText(e.target.value)} data-testid="ai-input" disabled={!project}
                onKeyDown={(e) => { if (e.key === 'Enter' && aiText.trim() && !anyBusy) askAi(aiText); }}
                placeholder={project ? 'e.g. Make the wing pattern blue and green, mostly blue' : 'Build a 3D model first, then edit it in words'}
                className="h-9 min-w-0 flex-1 rounded-[10px] bg-field px-3 text-[13px] outline-none disabled:opacity-60" />
              <button className={primary + ' flex h-9 items-center gap-1.5'} disabled={!project || !aiText.trim() || anyBusy} onClick={() => askAi(aiText)} data-testid="ai-send" aria-label="Send to AI">
                <IconSend size={15} />
              </button>
            </div>
            {project && !chat.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(preset?.ideas ?? AI_IDEAS).map((x) => (
                  <button key={x} onClick={() => setAiText(x)} className="rounded-full bg-hover px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-hover-2">{x}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
        {(err || note) && (
          <div className={`pointer-events-auto max-w-[720px] rounded-[12px] px-3 py-1.5 text-[12.5px] shadow-raised ${err ? 'bg-[#fff0f0] text-[#c92a2a]' : 'bg-surface text-ink-2'}`}>
            {err ?? note}
            {err && <button className="ml-2 text-ink-3" onClick={() => setErr(null)}>×</button>}
          </div>
        )}
        <div className="pointer-events-auto flex max-w-[min(860px,100%)] flex-wrap items-center gap-2 rounded-[14px] bg-surface py-1.5 pr-1.5 pl-3 text-[13px] text-ink-2 shadow-raised" data-testid="actionbar">
          {sel?.kind === 'strokes' ? (
            <>
              <span>{sel.idx.length} strokes</span>
              {COLORS.slice(0, 10).map((c) => <button key={c} aria-label={`Strokes ${c}`} onClick={() => strokeSelOp(c)} className="size-6 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]" style={{ background: c }} />)}
              <button className={ghost} onClick={() => strokeSelOp('delete')}>Delete</button>
            </>
          ) : sel?.kind === 'region' && project ? (
            <>
              <IconPointer size={15} className="text-[#5b5bff]" />
              <span className="max-w-[200px] truncate">{selParts.length ? selParts.join(', ') : 'Area'}{sel.mask && selParts.length ? ' + area' : ''}</span>
              {sel.at && <WarmTooltip content="Magic wand: more precise segment under the click point (SAM)" side="top"><button className={ghost + ' flex items-center gap-1'} onClick={refineSel} disabled={anyBusy}><IconWand size={15} />finer</button></WarmTooltip>}
              <span className="h-5 w-px bg-line-strong" />
              {COLORS.slice(0, 11).map((c) => (
                <button key={c} aria-label={`Recolor ${c}`} data-testid={`recolor-${c}`} disabled={anyBusy} onClick={() => regionOp('recolor', { color: c })}
                  className="size-6 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] transition-transform hover:scale-110" style={{ background: c }} />
              ))}
              <span className="h-5 w-px bg-line-strong" />
              <input value={selText} onChange={(e) => setSelText(e.target.value)} placeholder="Prompt for this part only…" data-testid="sel-prompt"
                onKeyDown={(e) => { if (e.key === 'Enter' && selText.trim()) regionOp('restyle', { text: selText }); }}
                className="h-8 w-56 rounded-[10px] bg-field px-2.5 text-[13px] outline-none" />
              <button className={ghost} disabled={!selText.trim() || anyBusy} onClick={() => regionOp('restyle', { text: selText })} title="New surface from the prompt, shape stays">Surface</button>
              <button className={ghost} disabled={!selText.trim() || anyBusy} onClick={() => regionOp('replace', { text: selText })} title="Regenerate the area from the prompt (new shape)">Replace</button>
              <button className={ghost} disabled={anyBusy} onClick={() => regionOp('delete')}>Delete</button>
            </>
          ) : project ? (
            newCount ? (
              <>
                <IconBrush size={15} className="text-[#ff7a00]" />
                <span className="max-w-[340px] truncate" title={plan ?? ''}>{plan ?? 'Checking where the strokes belong …'}</span>
                <input value={partText} onChange={(e) => setPartText(e.target.value)} placeholder="What is it? (optional, e.g. antenna)"
                  onKeyDown={(e) => { if (e.key === 'Enter') applyStrokes(); }}
                  className="h-8 w-48 rounded-[10px] bg-field px-2.5 text-[13px] outline-none" />
                <button className={primary} onClick={applyStrokes} disabled={anyBusy} data-testid="apply">Apply ↵</button>
              </>
            ) : (
              <span className="px-1 py-1.5">Draw = add/paint over · eraser = remove from the model · select = click a part to recolor, change by prompt or replace · Ask AI = change it in words</span>
            )
          ) : (
            <>
              <IconSparkles size={15} className="text-[#7c5cff]" />
              <span>{strokeCount ? `${strokeCount} strokes · ${subjEn}` : `Sketch ${article} ${subjLower}`}</span>
              <button className={primary} disabled={!strokeCount || anyBusy} onClick={() => generate()} data-testid="generate">Create 2 versions ↵</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
