import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type React from 'react';
import { IconBox, IconCheck, IconChevronDown, IconClick, IconGripVertical, IconMinus, IconSparkles, IconX } from '@tabler/icons-react';
import type { Frage, VerlaufEintrag } from '@/lib/prompt';

/* ─────────────────────────────────────────────────────────
 * Rückfragen als Chat in einem kleinen, verschiebbaren Fenster (Standard: oben rechts)
 *  - Agent-Blasen rechts, Antworten des Nutzers links
 *  - die offene Frage trägt darunter ihre Antwortvorgaben: Chips, Freitext, Teile im Modell anklicken,
 *    anderes Modell im Canvas wählen, Farbe, Zahl mit Einheit, Ja/Nein
 *  - Tastatur: Pfeile wählen, Enter bestätigt, Esc bricht die Rückfrage ab
 * ───────────────────────────────────────────────────────── */

export type ChatItem = { id: string; role: 'agent' | 'user'; text: string; tone?: 'info' | 'ok' | 'error' };
export type PickItem = { key: string; label: string };
export type PickState = { kind: 'teil' | 'modell'; items: PickItem[] };

const SPRING = 'cubic-bezier(0.23,1,0.32,1)';
const SWATCHES = ['#ffffff', '#111111', '#e03131', '#f08c00', '#fab005', '#2f9e44', '#1c7ed6', '#87ceeb', '#7048e8', '#868e96'];
const UNITS = ['mm', 'cm', 'm'];

function Bubble({ role, tone, children }: { role: ChatItem['role']; tone?: ChatItem['tone']; children: ReactNode }) {
  const agent = role === 'agent';
  return (
    <div className={`flex ${agent ? 'justify-end' : 'justify-start'}`} style={{ animation: `rise-in 240ms ${SPRING} both` }}>
      <div
        className={`max-w-[88%] rounded-[14px] px-2.5 py-1.5 text-[12.5px] leading-[17px] shadow-raised ${agent
          ? `rounded-br-[5px] ${tone === 'error' ? 'bg-[#fff0f0] text-[#a51d1d]' : 'bg-surface text-ink'}`
          : 'rounded-bl-[5px] bg-[#26262b] text-white'}`}
        style={{ transformOrigin: agent ? 'bottom right' : 'bottom left' }}
      >
        {agent && <IconSparkles size={12} stroke={2} className="mr-1 -mt-0.5 inline text-[#7c5cff]" />}
        {children}
      </div>
    </div>
  );
}

function Chip({ on, active, onClick, children, title }: { on?: boolean; active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.96] ${on
        ? 'bg-[#7c5cff] text-white' : 'bg-surface text-ink shadow-raised hover:bg-hover'} ${active ? 'ring-2 ring-[#7c5cff]/45' : ''}`}
    >
      {children}
    </button>
  );
}

/** Antwortvorgaben zur offenen Frage. */
function Answer({ frage, pick, onAnswer, onStartPick, onRemovePick, onCancel }: {
  frage: Frage;
  pick: PickState | null;
  onAnswer: (a: VerlaufEintrag) => void;
  onStartPick: (kind: 'teil' | 'modell') => void;
  onRemovePick: (key: string) => void;
  onCancel: () => void;
}) {
  const opts = frage.typ === 'ja_nein' && !frage.optionen.length
    ? [{ id: 'ja', label: 'Yes' }, { id: 'nein', label: 'No' }]
    : frage.optionen;
  const startIdx = Math.max(0, opts.findIndex((o) => o.id === frage.standard));
  const [active, setActive] = useState(startIdx);
  const [multi, setMulti] = useState<Set<string>>(new Set(frage.standard && frage.mehrfach ? [frage.standard] : []));
  const [text, setText] = useState('');
  const [color, setColor] = useState('#87ceeb');
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState(frage.einheit && UNITS.includes(frage.einheit) ? frage.einheit : 'cm');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (frage.typ === 'teil' || frage.typ === 'modell') onStartPick(frage.typ);
    requestAnimationFrame(() => (inputRef.current ?? boxRef.current)?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frage]);

  const choose = (i: number) => {
    const o = opts[i];
    if (!o) return;
    if (frage.mehrfach) {
      setMulti((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
      return;
    }
    onAnswer({ rolle: 'nutzer', text: o.label, teile: 'teile' in o ? o.teile ?? null : null, wert: o.id });
  };
  const confirmMulti = () => {
    const chosen = opts.filter((o) => multi.has(o.id));
    if (!chosen.length) return;
    const teile = chosen.map((o) => ('teile' in o ? o.teile : null)).filter(Boolean).join(',') || null;
    onAnswer({ rolle: 'nutzer', text: chosen.map((o) => o.label).join(', '), teile, wert: chosen.map((o) => o.id) });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (!opts.length) return;
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setActive((a) => (a + 1) % opts.length); }
    else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setActive((a) => (a + opts.length - 1) % opts.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (frage.mehrfach && multi.size && e.metaKey) confirmMulti(); else choose(active); }
  };

  const numVal = Number(num.replace(',', '.'));
  const pickItems = pick?.kind === frage.typ ? pick.items : [];

  return (
    <div ref={boxRef} tabIndex={-1} onKeyDown={onKey} className="flex flex-wrap justify-end gap-1.5 outline-none" style={{ animation: `pop-in 200ms ${SPRING} 60ms both`, transformOrigin: 'top right' }}>
      {(frage.typ === 'auswahl' || frage.typ === 'ja_nein') && (
        <>
          {opts.map((o, i) => (
            <Chip key={o.id} on={frage.mehrfach ? multi.has(o.id) : false} active={i === active} title={'beschreibung' in o ? o.beschreibung ?? undefined : undefined} onClick={() => { setActive(i); choose(i); }}>
              {frage.mehrfach && multi.has(o.id) && <IconCheck size={13} stroke={2.5} />}
              {o.label}
            </Chip>
          ))}
          {frage.mehrfach && <Chip on onClick={confirmMulti}>Apply</Chip>}
        </>
      )}

      {frage.typ === 'text' && (
        <form className="flex w-full justify-end gap-1.5" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer({ rolle: 'nutzer', text: text.trim() }); }}>
          {opts.map((o) => <Chip key={o.id} onClick={() => onAnswer({ rolle: 'nutzer', text: o.label, teile: o.teile ?? null, wert: o.id })}>{o.label}</Chip>)}
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} placeholder="Answer…"
            className="h-7 min-w-0 flex-1 rounded-full bg-surface px-3 text-[12.5px] text-ink shadow-raised outline-none placeholder:text-ink-3" />
          <Chip on onClick={() => text.trim() && onAnswer({ rolle: 'nutzer', text: text.trim() })}>Send</Chip>
        </form>
      )}

      {(frage.typ === 'teil' || frage.typ === 'modell') && (
        <div className="grid justify-items-end gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full bg-accent-tint px-3 py-1.5 text-[12px] text-accent-ink">
            <IconClick size={14} stroke={1.9} />
            {frage.typ === 'teil'
              ? `Click ${frage.mehrfach ? 'the parts' : 'the part'} on the model`
              : 'Click another model on the canvas'}
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {opts.map((o) => <Chip key={o.id} onClick={() => onAnswer({ rolle: 'nutzer', text: o.label, teile: o.teile ?? null, wert: o.id })}>{o.label}</Chip>)}
            {pickItems.map((p) => (
              <span key={p.key} className="flex h-7.5 items-center gap-1 rounded-full bg-surface pr-1 pl-3 text-[12.5px] text-ink shadow-raised" style={{ animation: `pop-in 180ms ${SPRING} both` }}>
                {frage.typ === 'modell' && <IconBox size={13} stroke={1.8} className="text-ink-3" />}
                {p.label}
                <button type="button" aria-label={`Remove ${p.label}`} onClick={() => onRemovePick(p.key)} className="flex size-5.5 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"><IconX size={11} stroke={2.4} /></button>
              </span>
            ))}
            <Chip on onClick={() => {
              if (!pickItems.length) return;
              onAnswer(frage.typ === 'teil'
                ? { rolle: 'nutzer', text: pickItems.map((p) => p.label).join(', '), teile: pickItems.map((p) => p.key).join(',') }
                : { rolle: 'nutzer', text: pickItems[0].label, modell: pickItems[0].label });
            }}>
              <IconCheck size={13} stroke={2.5} /> Confirm
            </Chip>
          </div>
        </div>
      )}

      {frage.typ === 'farbe' && (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {opts.map((o) => <Chip key={o.id} onClick={() => onAnswer({ rolle: 'nutzer', text: o.label, teile: o.teile ?? null, wert: o.id })}>{o.label}</Chip>)}
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={c} onClick={() => onAnswer({ rolle: 'nutzer', text: `Color ${c}`, wert: c })}
              className="size-7 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12),0_2px_6px_rgba(20,20,40,0.12)] transition-transform hover:scale-110 active:scale-95" style={{ background: c }} />
          ))}
          <label className="relative size-7 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" style={{ background: `conic-gradient(red, yellow, lime, cyan, blue, magenta, red)` }} title="Custom color">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute -inset-2 size-12 cursor-pointer opacity-0" />
          </label>
          <Chip on onClick={() => onAnswer({ rolle: 'nutzer', text: `Color ${color}`, wert: color })}>
            <span className="size-3.5 rounded-full ring-1 ring-white/70" style={{ background: color }} /> Apply
          </Chip>
        </div>
      )}

      {frage.typ === 'zahl' && (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (Number.isFinite(numVal) && num.trim()) onAnswer({ rolle: 'nutzer', text: `${num.trim()} ${unit}`, wert: { wert: numVal, einheit: unit } }); }}>
          <input ref={inputRef} value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} inputMode="decimal" placeholder="Value"
            className="h-7.5 w-24 rounded-full bg-surface px-3 text-right text-[12.5px] text-ink tabular-nums shadow-raised outline-none placeholder:text-ink-3" />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-7.5 rounded-full bg-surface px-2 text-[12.5px] text-ink shadow-raised outline-none" aria-label="Unit">
            {(frage.einheit && !UNITS.includes(frage.einheit) ? [frage.einheit, ...UNITS] : UNITS).map((u) => <option key={u}>{u}</option>)}
          </select>
          <Chip on onClick={() => { if (Number.isFinite(numVal) && num.trim()) onAnswer({ rolle: 'nutzer', text: `${num.trim()} ${unit}`, wert: { wert: numVal, einheit: unit } }); }}>OK</Chip>
        </form>
      )}
    </div>
  );
}

const POS_KEY = 'agentchat-pos';
const PANEL_W = 300;
type Pos = { right: number; top: number; min: boolean };

function loadPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    if (p && Number.isFinite(p.right) && Number.isFinite(p.top)) return { right: p.right, top: p.top, min: !!p.min };
  } catch { /* Speicher gesperrt: Standardplatz */ }
  return { right: 16, top: 80, min: false };
}

function clampPos(p: Pos, w: number, h: number): Pos {
  const vw = window.innerWidth, vh = window.innerHeight;
  return { ...p, right: Math.min(Math.max(8, p.right), Math.max(8, vw - w - 8)), top: Math.min(Math.max(8, p.top), Math.max(8, vh - Math.min(h, 48) - 8)) };
}

/**
 * Agent-Chat als kleines Fenster, fest am Bildschirm (nicht am Canvas): Standard oben rechts,
 * an der Kopfzeile frei verschiebbar, einklappbar. Platz und Zustand bleiben im Browser gespeichert.
 */
export default function AgentChat({ items, frage, busy, pick, title = 'Agent', onAnswer, onStartPick, onRemovePick, onCancel, onClose }: {
  items: ChatItem[];
  /** offene Rückfrage (gehört zur letzten Agent-Blase) */
  frage: Frage | null;
  busy: boolean;
  pick: PickState | null;
  /** Kopfzeile, z. B. Modellname */
  title?: string;
  onAnswer: (a: VerlaufEintrag) => void;
  onStartPick: (kind: 'teil' | 'modell') => void;
  onRemovePick: (key: string) => void;
  /** Rückfrage abbrechen (Esc) */
  onCancel: () => void;
  /** Verlauf schließen */
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos>(loadPos);
  const drag = useRef<{ x: number; y: number; right: number; top: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items.length, frage, busy, pick?.items.length, pos.min]);

  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* egal */ }
  }, [pos]);

  // Im Fenster halten, auch wenn sich die Fenstergröße ändert
  useEffect(() => {
    const fit = () => {
      const r = panelRef.current?.getBoundingClientRect();
      setPos((p) => clampPos(p, r?.width ?? PANEL_W, r?.height ?? 48));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Neue Rückfrage klappt das Fenster wieder auf
  useEffect(() => { if (frage) setPos((p) => (p.min ? { ...p, min: false } : p)); }, [frage]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, right: pos.right, top: pos.top, id: e.pointerId };
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const r = panelRef.current?.getBoundingClientRect();
    setPos((p) => clampPos({ ...p, right: d.right - (e.clientX - d.x), top: d.top + (e.clientY - d.y) }, r?.width ?? PANEL_W, r?.height ?? 48));
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const iconBtn = 'flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink';

  return (
    <div
      ref={panelRef}
      data-promptbar
      className={`absolute z-40 flex flex-col overflow-hidden rounded-[16px] bg-surface/95 shadow-raised backdrop-blur-md ${dragging ? 'cursor-grabbing select-none' : ''}`}
      style={{ right: pos.right, top: pos.top, width: `min(${PANEL_W}px, calc(100vw - 32px))`, animation: `pop-in 200ms ${SPRING} both`, transformOrigin: 'top right' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setPos((p) => ({ ...p, min: !p.min }))}
        className={`flex h-9 shrink-0 touch-none items-center gap-1.5 pr-1.5 pl-2.5 ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${pos.min ? '' : 'border-b border-black/5'}`}
        title="Drag to move · double-click to collapse"
      >
        <IconGripVertical size={14} stroke={1.8} className="shrink-0 text-ink-3" />
        <IconSparkles size={13} stroke={2} className="shrink-0 text-[#7c5cff]" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{title}</span>
        {busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#7c5cff]" aria-label="Agent working" />}
        {pos.min && frage && <span className="shrink-0 rounded-full bg-accent-tint px-1.5 text-[10.5px] text-accent-ink">Question</span>}
        <button type="button" aria-label={pos.min ? 'Expand chat' : 'Collapse chat'} onClick={() => setPos((p) => ({ ...p, min: !p.min }))} className={iconBtn}>
          {pos.min ? <IconChevronDown size={13} stroke={2.2} /> : <IconMinus size={13} stroke={2.2} />}
        </button>
        <button type="button" aria-label="Close history" onClick={onClose} className={iconBtn}>
          <IconX size={12} stroke={2.4} />
        </button>
      </div>
      {!pos.min && (
        <div ref={scrollRef} className="grid max-h-[min(46vh,360px)] gap-2 overflow-y-auto overscroll-contain px-2.5 pt-2.5 pb-2.5">
          {items.map((it, i) => (
            <div key={it.id} className="grid gap-1.5">
              <Bubble role={it.role} tone={it.tone}>{it.text}</Bubble>
              {frage && !busy && i === items.length - 1 && it.role === 'agent' && (
                <Answer frage={frage} pick={pick} onAnswer={onAnswer} onStartPick={onStartPick} onRemovePick={onRemovePick} onCancel={onCancel} />
              )}
            </div>
          ))}
          {busy && (
            <div className="flex justify-end" style={{ animation: `pop-in 180ms ${SPRING} both` }}>
              <div className="flex h-7 items-center gap-1 rounded-[14px] rounded-br-[5px] bg-surface px-3 shadow-raised">
                {[0, 1, 2].map((k) => <span key={k} className="size-1.5 rounded-full bg-ink-3" style={{ animation: `eq-bounce 900ms ease-in-out ${k * 150}ms infinite` }} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
