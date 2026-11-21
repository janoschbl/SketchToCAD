import { useEffect, useState, type ReactNode } from 'react';
import { IconBackground, IconEraser, IconMessageCirclePlus, IconMinus, IconPlus, IconPointer, IconResize, IconRuler2, IconScribble, IconSquaresDiagonal, IconTrash, IconX } from '@tabler/icons-react';
import type { ElType, ModelDims, SizeAxis, Tool } from '@/engine';

const UNITS = { mm: 0.001, cm: 0.01, m: 1 } as const;
type Unit = keyof typeof UNITS;
const AXES: { key: SizeAxis; label: string }[] = [{ key: 'laenge', label: 'Länge' }, { key: 'breite', label: 'Breite' }, { key: 'hoehe', label: 'Höhe' }];

/** Meter lesbar: 0,1 m → „10 cm“, 4,87 m → „4,87 m“, 0,004 m → „4 mm“. */
export function fmtLen(m: number): string {
  const f = (v: number, d: number) => v.toLocaleString('de-DE', { maximumFractionDigits: d });
  if (m >= 1) return `${f(m, 2)} m`;
  if (m >= 0.01) return `${f(m * 100, 1)} cm`;
  return `${f(m * 1000, 1)} mm`;
}

function bestUnit(m: number): Unit { return m >= 1 ? 'm' : m >= 0.01 ? 'cm' : 'mm'; }

/** Echte Maße anzeigen und eine Achse auf einen Wert setzen (proportional, Boden bleibt). */
function SizePanel({ dims, onSet, onDone }: { dims: ModelDims; onSet: (axis: SizeAxis, meters: number) => void; onDone: () => void }) {
  const [axis, setAxis] = useState<SizeAxis>('laenge');
  const [unit, setUnit] = useState<Unit>(bestUnit(dims.laenge));
  const [val, setVal] = useState(() => String(+(dims.laenge / UNITS[bestUnit(dims.laenge)]).toPrecision(4)));
  const n = Number(val.replace(',', '.'));
  const ok = Number.isFinite(n) && n > 0;
  const submit = () => { if (ok) { onSet(axis, n * UNITS[unit]); onDone(); } };
  return (
    <div className="grid w-64 gap-2 p-2 text-[12.5px]">
      <div className="text-ink-3">{AXES.map((a) => `${a.label} ${fmtLen(dims[a.key])}`).join(' · ')}</div>
      <div className="flex items-center gap-1">
        <select value={axis} onChange={(e) => { const a = e.target.value as SizeAxis; setAxis(a); const u = bestUnit(dims[a]); setUnit(u); setVal(String(+(dims[a] / UNITS[u]).toPrecision(4))); }}
          className="h-7.5 rounded-[6px] bg-field px-1.5 text-ink shadow-hairline outline-none" aria-label="Achse">
          {AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onDone(); }}
          inputMode="decimal" aria-label="Wert" className="h-7.5 w-0 min-w-0 flex-1 rounded-[6px] bg-field px-2 text-ink shadow-hairline outline-none" />
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="h-7.5 rounded-[6px] bg-field px-1.5 text-ink shadow-hairline outline-none" aria-label="Einheit">
          {(Object.keys(UNITS) as Unit[]).map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <button type="button" disabled={!ok} onClick={submit} className="h-7.5 rounded-[6px] bg-ink font-medium text-surface transition-transform enabled:active:scale-[0.97] disabled:opacity-40">
        Größe setzen (proportional)
      </button>
    </div>
  );
}

/* Kontextleiste unter dem ausgewählten Element – Stil nach Beautiful UI
 * „Selection Actions“ (https://www.beautifului.dev/#selection-actions). */

const SIZES: { label: string; f: number | 'orig' }[] = [
  { label: '50 %', f: 0.5 },
  { label: '75 %', f: 0.75 },
  { label: '125 %', f: 1.25 },
  { label: '150 %', f: 1.5 },
  { label: '200 %', f: 2 },
  { label: 'Originalgröße', f: 'orig' },
];

function Action({ icon, label, on, busy, onClick }: { icon: ReactNode; label: string; on?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
        on ? 'bg-accent-tint text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
      }`}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      {busy ? <span className="shimmer-text">{label}</span> : label}
    </button>
  );
}

export default function ElementBar({ type, box, tool, onMarkup, onComment, onRemoveBg, onErase, onResize, onDelete, dims, onSetSize, parts, multi, onMulti, onPartScale, onDeleteParts, onClearParts }: {
  type: ElType;
  /** echte Maße eines 3D-Modells in Metern */
  dims?: ModelDims | null;
  onSetSize?: (axis: SizeAxis, meters: number) => void;
  box: number[];
  tool: Tool;
  onMarkup: () => void;
  onComment: () => void;
  onRemoveBg: () => Promise<void> | void;
  onErase: () => void;
  onResize: (f: number | 'orig') => void;
  onDelete: () => void;
  /** Ausgewählte Teile des Modells (null = keine); logos = alles Logos/Anbauteile */
  parts?: { count: number; logos: boolean } | null;
  multi?: boolean;
  onMulti?: () => void;
  onPartScale?: (f: number) => void;
  onDeleteParts?: () => void;
  onClearParts?: () => void;
}) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [dimsOpen, setDimsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSizeOpen(false); setDimsOpen(false); }, [type]);

  const W = window.innerWidth, H = window.innerHeight;
  const below = box[3] + 14;
  const placeAbove = below > H - 150; // Platz für die Prompt-Leiste lassen
  const top = placeAbove ? Math.max(70, box[1] - 14 - 44) : below;
  const cx = Math.min(W - 200, Math.max(200, (box[0] + box[2]) / 2));
  const ic = { size: 16, stroke: 1.7 };

  return (
    <div
      className="absolute z-20 -translate-x-1/2"
      style={{ left: cx, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-0.5 rounded-full bg-surface p-1 shadow-raised" style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}>
        <Action icon={<IconScribble {...ic} />} label="Markup" on={tool === 'pen'} onClick={onMarkup} />
        <Action icon={<IconMessageCirclePlus {...ic} />} label="Kommentar" on={tool === 'comment'} onClick={onComment} />
        {type === 'image' && (
          <>
            <Action
              icon={<IconBackground {...ic} />}
              label={busy ? 'Entferne…' : 'Hintergrund entfernen'}
              busy={busy}
              onClick={async () => { if (busy) return; setBusy(true); await new Promise((r) => setTimeout(r, 30)); await onRemoveBg(); setBusy(false); }}
            />
            <Action icon={<IconEraser {...ic} />} label="Radieren" on={tool === 'imgErase'} onClick={onErase} />
          </>
        )}
        {(type === 'image' || type === 'model') && (
          <div className="relative">
            <Action icon={<IconResize {...ic} />} label="Größe" on={sizeOpen} onClick={() => setSizeOpen((v) => !v)} />
            {sizeOpen && (
              <div
                className={`absolute left-1/2 z-10 w-36 -translate-x-1/2 rounded-[10px] bg-surface p-1 shadow-raised ${placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'}`}
                style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both' }}
              >
                {SIZES.filter((s) => s.f !== 'orig' || type === 'image').map((s) => (
                  <button key={s.label} type="button" onClick={() => { onResize(s.f); setSizeOpen(false); }} className="flex h-7.5 w-full items-center rounded-[6px] px-2 text-left text-[12.5px] text-ink hover:bg-hover">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {type === 'model' && dims && dims.laenge > 0 && onSetSize && (
          <div className="relative">
            <Action icon={<IconRuler2 {...ic} />} label={`${fmtLen(dims.laenge)} lang`} on={dimsOpen} onClick={() => { setSizeOpen(false); setDimsOpen((v) => !v); }} />
            {dimsOpen && (
              <div
                className={`absolute left-1/2 z-10 -translate-x-1/2 rounded-[10px] bg-surface shadow-raised ${placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'}`}
                style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both' }}
              >
                <SizePanel dims={dims} onSet={onSetSize} onDone={() => setDimsOpen(false)} />
              </div>
            )}
          </div>
        )}
        {type === 'model' && onMulti && (
          <Action icon={<IconSquaresDiagonal {...ic} />} label="Mehrere Teile" on={multi} onClick={onMulti} />
        )}
        {type === 'model' && parts && (
          <>
            <span className="mx-0.5 h-5 w-px bg-line-strong" />
            <span className="flex h-8 items-center gap-1 whitespace-nowrap rounded-full bg-accent-tint px-2.5 text-[12.5px] text-accent-ink">
              <IconPointer size={14} stroke={1.8} />
              {parts.logos ? (parts.count === 1 ? 'Logo' : `${parts.count} Logos`) : parts.count === 1 ? '1 Teil' : `${parts.count} Teile`}
              <button type="button" aria-label="Auswahl aufheben" onClick={onClearParts} className="-mr-1 flex size-5 items-center justify-center rounded-full hover:bg-black/10">
                <IconX size={11} stroke={2.2} />
              </button>
            </span>
            {parts.logos && onPartScale && (
              <>
                <button type="button" aria-label="Logo verkleinern" title="Logo verkleinern" onClick={() => onPartScale(1 / 1.2)} className="flex size-8 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.94]">
                  <IconMinus size={15} stroke={1.8} />
                </button>
                <button type="button" aria-label="Logo vergrößern" title="Logo vergrößern" onClick={() => onPartScale(1.2)} className="flex size-8 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.94]">
                  <IconPlus size={15} stroke={1.8} />
                </button>
              </>
            )}
          </>
        )}
        <span className="mx-0.5 h-5 w-px bg-line-strong" />
        <button type="button" aria-label={parts ? 'Auswahl löschen' : 'Löschen'} title={parts ? 'Ausgewählte Teile löschen' : 'Modell löschen'} onClick={parts ? onDeleteParts : onDelete} className="flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-red">
          <IconTrash size={15} stroke={1.7} />
        </button>
      </div>
    </div>
  );
}
