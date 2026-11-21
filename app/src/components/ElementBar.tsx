import { useEffect, useState, type ReactNode } from 'react';
import { IconBackground, IconEraser, IconMessageCirclePlus, IconMinus, IconPlus, IconPointer, IconRuler2, IconSparkles, IconScribble, IconSquaresDiagonal, IconTrash, IconX } from '@tabler/icons-react';
import type { ElType, ModelDims, SizeAxis, Tool } from '@/engine';

const UNITS = { mm: 0.001, cm: 0.01, m: 1 } as const;
type Unit = keyof typeof UNITS;
const AXES: { key: SizeAxis; label: string }[] = [{ key: 'laenge', label: 'Length' }, { key: 'breite', label: 'Width' }, { key: 'hoehe', label: 'Height' }];

/** Meter lesbar: 0,1 m → „10 cm“, 4,87 m → „4,87 m“, 0,004 m → „4 mm“. */
export function fmtLen(m: number): string {
  const f = (v: number, d: number) => v.toLocaleString('en-US', { maximumFractionDigits: d });
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
          className="h-7.5 rounded-[6px] bg-field px-1.5 text-ink shadow-hairline outline-none" aria-label="Axis">
          {AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onDone(); }}
          inputMode="decimal" aria-label="Value" className="h-7.5 w-0 min-w-0 flex-1 rounded-[6px] bg-field px-2 text-ink shadow-hairline outline-none" />
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="h-7.5 rounded-[6px] bg-field px-1.5 text-ink shadow-hairline outline-none" aria-label="Unit">
          {(Object.keys(UNITS) as Unit[]).map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <button type="button" disabled={!ok} onClick={submit} className="h-7.5 rounded-[6px] bg-ink font-medium text-surface transition-transform enabled:active:scale-[0.97] disabled:opacity-40">
        Set size (proportional)
      </button>
    </div>
  );
}

/* Kontextleiste unter dem ausgewählten Element – Stil nach Beautiful UI
 * „Selection Actions“ (https://www.beautifului.dev/#selection-actions). */


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

export default function ElementBar({ type, box, tool, onMarkup, onComment, onRemoveBg, onErase, onDelete, onStudio, dims, onSetSize, parts, multi, onMulti, onPartScale, onDeleteParts, onClearParts }: {
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
  onResize?: (f: number | 'orig') => void;
  onDelete: () => void;
  /** Modell stammt aus dem KI-Studio → dort weiterbearbeiten */
  onStudio?: () => void;
  /** Ausgewählte Teile des Modells (null = keine); logos = alles Logos/Anbauteile */
  parts?: { count: number; logos: boolean } | null;
  multi?: boolean;
  onMulti?: () => void;
  onPartScale?: (f: number) => void;
  onDeleteParts?: () => void;
  onClearParts?: () => void;
}) {
  const [dimsOpen, setDimsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDimsOpen(false); }, [type]);

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
        <Action icon={<IconMessageCirclePlus {...ic} />} label="Comment" on={tool === 'comment'} onClick={onComment} />
        {type === 'image' && (
          <>
            <Action
              icon={<IconBackground {...ic} />}
              label={busy ? 'Removing…' : 'Remove background'}
              busy={busy}
              onClick={async () => { if (busy) return; setBusy(true); await new Promise((r) => setTimeout(r, 30)); await onRemoveBg(); setBusy(false); }}
            />
            <Action icon={<IconEraser {...ic} />} label="Erase" on={tool === 'imgErase'} onClick={onErase} />
          </>
        )}
        {type === 'model' && onStudio && (
          <button type="button" onClick={onStudio} className="ai-tool flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium text-[#3b37a5] transition-transform active:scale-[0.96]">
            <IconSparkles size={15} stroke={1.8} />Edit in Studio
          </button>
        )}
        {type === 'model' && dims && dims.laenge > 0 && onSetSize && (
          <div className="relative">
            <Action icon={<IconRuler2 {...ic} />} label={`${fmtLen(dims.laenge)} long`} on={dimsOpen} onClick={() => setDimsOpen((v) => !v)} />
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
          <Action icon={<IconSquaresDiagonal {...ic} />} label="Multiple parts" on={multi} onClick={onMulti} />
        )}
        {type === 'model' && parts && (
          <>
            <span className="mx-0.5 h-5 w-px bg-line-strong" />
            <span className="flex h-8 items-center gap-1 whitespace-nowrap rounded-full bg-accent-tint px-2.5 text-[12.5px] text-accent-ink">
              <IconPointer size={14} stroke={1.8} />
              {parts.logos ? (parts.count === 1 ? 'Logo' : `${parts.count} Logos`) : parts.count === 1 ? '1 part' : `${parts.count} parts`}
              <button type="button" aria-label="Clear selection" onClick={onClearParts} className="-mr-1 flex size-5 items-center justify-center rounded-full hover:bg-black/10">
                <IconX size={11} stroke={2.2} />
              </button>
            </span>
            {parts.logos && onPartScale && (
              <>
                <button type="button" aria-label="Shrink logo" title="Shrink logo" onClick={() => onPartScale(1 / 1.2)} className="flex size-8 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.94]">
                  <IconMinus size={15} stroke={1.8} />
                </button>
                <button type="button" aria-label="Enlarge logo" title="Enlarge logo" onClick={() => onPartScale(1.2)} className="flex size-8 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] hover:bg-hover hover:text-ink active:scale-[0.94]">
                  <IconPlus size={15} stroke={1.8} />
                </button>
              </>
            )}
          </>
        )}
        <span className="mx-0.5 h-5 w-px bg-line-strong" />
        <button type="button" aria-label={parts ? 'Delete selection' : 'Delete'} title={parts ? 'Delete selected parts' : 'Delete model'} onClick={parts ? onDeleteParts : onDelete} className="flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-red">
          <IconTrash size={15} stroke={1.7} />
        </button>
      </div>
    </div>
  );
}
