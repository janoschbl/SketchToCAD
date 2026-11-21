import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createShader, playSweep, accentChain, ACCENTS } from 'glimm';
import { IconBox, IconPencil, IconPhoto, IconShape, IconTypography, IconX } from '@tabler/icons-react';
import type { PromptModel } from '@/lib/prompt';

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR – angepasst aus Beautiful UI „Prompt Bar“
 * Quelle: https://www.beautifului.dev/#prompt-bar
 *
 * Änderungen gegenüber dem Original:
 *  - kein Demo-Autoplay
 *  - Anhänge = Kontext-Chips (ausgewählte Canvas-Elemente + Kommentare)
 *  - @ referenziert Canvas-Elemente bzw. lädt ein Bild hoch, deutsche Texte
 *  - nur zum Ändern des ausgewählten 3D-Modells (kein Erzeugen von Grund auf)
 *  - bei offener Rückfrage des Agents geht der Text als Antwort an ihn
 *  - Modellwahl kommt vom Prompt-Editor-Backend (.env), Senden ist asynchron mit Ladezustand
 *  - Diktat über die Web Speech API (falls im Browser vorhanden)
 * ───────────────────────────────────────────────────────── */

const RAINBOW = accentChain([ACCENTS.red, ACCENTS.orange, ACCENTS.yellow, ACCENTS.green, ACCENTS.cyan, ACCENTS.blue, ACCENTS.purple]);

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export type ContextItem = {
  key: string;
  kind: 'element' | 'comment' | 'part';
  label: string;
  elType?: string;
  n?: number;
  thumb?: string | null;
};

export type Mentionable = { id: number; label: string; elType: string };

export function ElIcon({ type, size = 13 }: { type?: string; size?: number }) {
  const p = { size, strokeWidth: 1.8 };
  if (type === 'image') return <IconPhoto {...p} />;
  if (type === 'model') return <IconBox {...p} />;
  if (type === 'stroke') return <IconPencil {...p} />;
  if (type === 'text') return <IconTypography {...p} />;
  return <IconShape {...p} />;
}

function parseToken(draft: string): { kind: 'at'; query: string; start: number } | null {
  const match = /(^|\s)@([\wäöüß-]*)$/i.exec(draft);
  if (!match) return null;
  return { kind: 'at', query: match[2].toLowerCase(), start: match.index + match[1].length };
}

type Row = { key: string; name: string; desc: string; elType?: string; attach?: boolean; id?: number };

export default function PromptBar({
  context,
  mentionables,
  onRemoveContext,
  onMention,
  onAttach,
  onSend,
  placeholder,
  models,
  defaultModel,
  answering,
  onClose,
}: {
  context: ContextItem[];
  mentionables: Mentionable[];
  onRemoveContext: (key: string) => void;
  onMention: (id: number) => void;
  onAttach: () => void;
  /** Liefert false, wenn der Prompt nicht verarbeitet wurde – dann bleibt der Text stehen. */
  onSend: (text: string, model: string) => Promise<boolean | void> | boolean | void;
  placeholder?: string;
  models: PromptModel[];
  defaultModel: string;
  /** Der Agent wartet auf eine Antwort: Text geht als Antwort an die offene Rückfrage. */
  answering?: boolean;
  /** Esc bei leerem Eingabefeld */
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelKey, setModelKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const model = models.find((m) => m.key === modelKey) ?? models.find((m) => m.key === defaultModel) ?? models[0];
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [modelBox, setModelBox] = useState<{ top: number; height: number } | null>(null);
  const [modelHovered, setModelHovered] = useState<number | null>(null);
  const [modelMenuLeft, setModelMenuLeft] = useState(0);
  const [modelMenuBottom, setModelMenuBottom] = useState(0);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const modelRowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const glimmRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<ReturnType<typeof createShader> | null>(null);
  const sweepingRef = useRef(false);
  const recRef = useRef<any>(null);
  const SpeechRec = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

  const token = dismissed ? null : parseToken(draft);
  const menu: 'at' | null = plusOpen ? 'at' : token?.kind ?? null;
  const query = plusOpen ? '' : token?.query ?? '';

  const sources: Row[] = [
    { key: 'attach', name: 'Bild hochladen', desc: 'Foto oder Skizze vom Rechner', attach: true },
    ...mentionables.map((m) => ({ key: `el-${m.id}`, id: m.id, name: m.label, desc: 'auf dem Canvas', elType: m.elType })),
  ];
  const rows: Row[] = menu === 'at' ? sources.filter((s) => s.name.toLowerCase().includes(query)) : [];

  useEffect(() => { setActive(0); setEngaged(false); }, [menu, query]);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  const modelIndex = Math.max(0, models.findIndex((m) => m.key === model.key));
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const target = modelRowRefs.current[modelHovered ?? modelIndex];
    if (target) setModelBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [modelOpen, modelHovered, modelIndex]);

  useLayoutEffect(() => {
    if (!modelOpen || !composerAnchorRef.current || !modelRef.current) return;
    const anchorRect = composerAnchorRef.current.getBoundingClientRect();
    const triggerRect = modelRef.current.getBoundingClientRect();
    setModelMenuLeft(Math.max(0, Math.min(triggerRect.left - anchorRect.left, anchorRect.width - 208)));
    setModelMenuBottom(anchorRect.bottom - triggerRect.top + 8);
  }, [modelOpen, expanded, model.name]);

  useEffect(() => { if (!modelOpen) setModelHovered(null); }, [modelOpen]);

  const makeShader = () => {
    const canvas = glimmRef.current;
    if (!canvas) return null;
    const random = Math.random;
    Math.random = () => 0;
    try {
      return createShader({ canvas, palette: RAINBOW, direction: 'ltr', bandTight: 10, swellAmount: 0.85 });
    } finally {
      Math.random = random;
    }
  };

  useEffect(() => {
    shaderRef.current = makeShader();
    return () => { shaderRef.current?.destroy(); shaderRef.current = null; };
  }, []);

  const celebrate = () => {
    if (sweepingRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shaderRef.current?.destroy();
    const shader = makeShader();
    shaderRef.current = shader;
    if (!shader) return;
    sweepingRef.current = true;
    const sweep = playSweep(shader, { palette: RAINBOW, direction: 'ltr', sweepMs: 570, outroMs: 80, peakAlpha: 1.3, bandTight: 10, brightness: 1.4, swellAmount: 1, waveSpeed: 1.8, easing: 'easeOutExpo' });
    sweep.done.finally(() => { sweepingRef.current = false; });
  };

  const selectModel = (next: PromptModel) => {
    setModelKey(next.key);
    setModelOpen(false);
    if (/astra/i.test(next.key)) celebrate();
  };

  /* Diktat: echte Spracherkennung, wenn der Browser sie anbietet */
  useEffect(() => {
    if (!listening || !SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'de-DE';
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>).map((r: any) => r[0].transcript).join(' ');
      setDraft((cur) => (cur ? `${cur.trimEnd()} ${text}` : text));
    };
    rec.onend = () => { setListening(false); inputRef.current?.focus(); };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    return () => { try { rec.stop(); } catch { /* bereits beendet */ } };
  }, [listening]);

  useLayoutEffect(() => {
    const input = inputRef.current, controls = controlsRef.current, measure = measureRef.current, modelButton = modelRef.current;
    if (!input || !controls || !measure || !modelButton) return;
    const inlineInputWidth = controls.clientWidth - (28 * 3 + modelButton.offsetWidth) - 16;
    const needsFullWidth = draft.includes('\n') || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) setExpanded(needsFullWidth);
    input.style.height = '0px';
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 28), 120)}px`;
    input.style.overflowY = contentHeight > 120 ? 'auto' : 'hidden';
  }, [draft, expanded]);

  useEffect(() => {
    if (!modelOpen && !plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-promptbar]')) { setModelOpen(false); setPlusOpen(false); }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [modelOpen, plusOpen]);

  const closeMenus = () => { setPlusOpen(false); setModelOpen(false); };

  const pick = (row: Row) => {
    const base = token ? draft.slice(0, token.start) : draft;
    if (row.attach) { onAttach(); setDraft(base); }
    else { if (row.id !== undefined) onMention(row.id); setDraft(base); }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const canSend = !busy && (draft.trim().length > 0 || (!answering && context.some((c) => c.kind === 'comment')));
  const send = async () => {
    if (!canSend) return;
    closeMenus();
    setBusy(true);
    let ok: boolean | void = false;
    try { ok = await onSend(draft.trim(), model.key); } finally { setBusy(false); }
    if (ok !== false) { setDraft(''); celebrate(); }
    inputRef.current?.focus();
  };

  return (
    <div data-promptbar className="w-full">
      <div ref={composerAnchorRef} className="relative">
        {menu && (
          <div
            onMouseLeave={() => setEngaged(false)}
            className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-72 overflow-y-auto rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom center' }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{ top: rowBox?.top ?? 0, height: rowBox?.height ?? 0, opacity: rowBox && engaged && rows.length > 0 ? 1 : 0, transition: 'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease' }}
            />
            {rows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                ref={(el) => { rowRefs.current[i] = el; }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => { setActive(i); setEngaged(true); }}
                onClick={() => pick(row)}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
              >
                <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">
                  {row.attach ? <Icon size={15}><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icon> : <ElIcon type={row.elType} size={15} />}
                </span>
                <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
              </button>
            ))}
            {rows.length === 0 && <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">Keine Treffer für „{query}“</div>}
            <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
              Canvas-Elemente referenzieren oder Bild hochladen
            </div>
          </div>
        )}

        {modelOpen && (
          <div
            onMouseLeave={() => setModelHovered(null)}
            className="absolute z-10 w-52 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ left: modelMenuLeft, bottom: modelMenuBottom, animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom left' }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{ top: modelBox?.top ?? 0, height: modelBox?.height ?? 0, opacity: modelBox && modelHovered !== null ? 1 : 0, transition: 'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease' }}
            />
            {models.map((m, i) => (
              <button
                key={m.key}
                type="button"
                ref={(el) => { modelRowRefs.current[i] = el; }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setModelHovered(i)}
                onClick={() => { selectModel(m); inputRef.current?.focus(); }}
                className="relative z-10 flex h-7.5 w-full items-center gap-2 rounded-[6px] px-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{m.name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{m.tag}</span>
                <span className={`shrink-0 text-ink ${m.key === model.key ? '' : 'invisible'}`}>
                  <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={`relative isolate flex flex-col gap-1.5 overflow-hidden rounded-[16px] border border-line bg-surface p-1.5 shadow-card transition-[border-color] duration-150 focus-within:border-line-strong`}>
          <canvas ref={glimmRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" style={{ borderRadius: 'inherit' }} />
          <span ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute whitespace-pre text-[13px] leading-[18px]">{draft}</span>

          {context.length > 0 && <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
            {context.map((c) => (
              <span
                key={c.key}
                title={c.label}
                className="flex h-6.5 max-w-60 items-center gap-1.5 rounded-chip bg-field py-1 pr-1 pl-1 text-[11.5px] text-ink-2 shadow-hairline"
                style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
              >
                {c.kind === 'comment' ? (
                  <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full rounded-bl-[3px] bg-bui-accent text-[10px] font-semibold text-white">{c.n}</span>
                ) : c.kind === 'part' ? (
                  <span className="flex size-4.5 shrink-0 items-center justify-center text-ink-3"><IconShape size={12} stroke={1.8} /></span>
                ) : c.thumb ? (
                  <img src={c.thumb} alt="" className="size-4.5 shrink-0 rounded-[4px] object-cover shadow-hairline" />
                ) : (
                  <span className="flex size-4.5 shrink-0 items-center justify-center text-ink-3"><ElIcon type={c.elType} size={12} /></span>
                )}
                <span className="truncate">{c.label}</span>
                <button
                  type="button"
                  aria-label={`${c.label} entfernen`}
                  onClick={() => onRemoveContext(c.key)}
                  className="-my-1 flex size-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink"
                >
                  <IconX size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>}

          <div ref={controlsRef} className={`grid items-end gap-x-1 gap-y-1.5 ${expanded ? 'grid-cols-[28px_auto_minmax(0,1fr)_28px_28px]' : 'grid-cols-[28px_minmax(0,1fr)_auto_28px_28px]'}`}>
            <button
              type="button"
              aria-label="Kontext hinzufügen"
              aria-expanded={plusOpen}
              onClick={() => { setModelOpen(false); setPlusOpen((c) => !c); inputRef.current?.focus(); }}
              className={`flex size-7 shrink-0 items-center justify-center justify-self-start rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${plusOpen ? 'bg-hover text-ink' : ''} ${expanded ? 'col-start-1 row-start-2' : 'col-start-1 row-start-1'}`}
            >
              <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setDismissed(false); setPlusOpen(false); }}
              onKeyDown={(event) => {
                if (menu && rows.length > 0) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setEngaged(true);
                    setActive((cur) => (cur + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
                    return;
                  }
                  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); pick(rows[active]); return; }
                }
                if (event.key === 'Escape') {
                  if (!draft && !menu && onClose) { onClose(); return; }
                  setDismissed(true); closeMenus(); (event.target as HTMLTextAreaElement).blur(); return;
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
              }}
              readOnly={busy}
              placeholder={busy ? 'Modell wird geändert…' : listening ? 'Ich höre zu…' : answering ? 'Oder antworte hier mit eigenen Worten…' : placeholder ?? 'Beschreibe, was passieren soll…'}
              aria-label="Prompt"
              className={`min-h-7 w-full min-w-0 resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 ${expanded ? 'col-span-full col-start-1 row-start-1' : 'col-start-2 row-start-1'}`}
            />

            <button
              ref={modelRef}
              type="button"
              aria-expanded={modelOpen}
              aria-label="Modell wählen"
              onClick={() => { setPlusOpen(false); setModelOpen((c) => !c); }}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink ${expanded ? 'col-start-2 row-start-2 justify-self-start' : 'col-start-3 row-start-1'}`}
            >
              {model.name}
              <span className="text-ink-3"><Icon size={11} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></Icon></span>
            </button>

            <button
              type="button"
              aria-label={listening ? 'Diktat stoppen' : 'Diktat starten'}
              aria-pressed={listening}
              disabled={!SpeechRec}
              title={SpeechRec ? undefined : 'Spracherkennung wird von diesem Browser nicht unterstützt'}
              onClick={() => { if (listening) { recRef.current?.stop(); setListening(false); } else setListening(true); }}
              className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-150 active:scale-[0.94] disabled:opacity-40 ${listening ? 'bg-accent-tint text-accent-ink' : 'text-ink-3 enabled:hover:bg-hover enabled:hover:text-ink'} ${expanded ? 'col-start-4 row-start-2' : 'col-start-4 row-start-1'}`}
            >
              {listening ? (
                <span className="flex h-3.5 items-center gap-[2.5px]">
                  {[0, 1, 2].map((i) => <span key={i} className="w-[2.5px] rounded-full bg-current" style={{ height: '100%', animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }} />)}
                </span>
              ) : (
                <Icon size={15} strokeWidth={2}><g><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></g></Icon>
              )}
            </button>

            <button
              type="button"
              aria-label={busy ? 'Wird verarbeitet' : 'Senden'}
              disabled={!canSend}
              onClick={send}
              className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${expanded ? 'col-start-5 row-start-2' : 'col-start-5 row-start-1'}`}
              style={{ background: canSend || busy ? 'var(--ink)' : 'var(--line-strong)', color: canSend || busy ? 'var(--surface)' : 'var(--ink-2)' }}
            >
              {busy ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
              ) : (
                <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
