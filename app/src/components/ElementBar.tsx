import { useEffect, useState, type ReactNode } from 'react';
import { IconBackground, IconEraser, IconMessageCirclePlus, IconResize, IconScribble, IconTrash } from '@tabler/icons-react';
import type { ElType, Tool } from '@/engine';

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
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
        on ? 'bg-accent-tint text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
      }`}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      {busy ? <span className="shimmer-text">{label}</span> : label}
    </button>
  );
}

export default function ElementBar({ type, box, tool, onMarkup, onComment, onRemoveBg, onErase, onResize, onDelete }: {
  type: ElType;
  box: number[];
  tool: Tool;
  onMarkup: () => void;
  onComment: () => void;
  onRemoveBg: () => Promise<void> | void;
  onErase: () => void;
  onResize: (f: number | 'orig') => void;
  onDelete: () => void;
}) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSizeOpen(false), [type]);

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
        <span className="mx-0.5 h-5 w-px bg-line-strong" />
        <button type="button" aria-label="Löschen" onClick={onDelete} className="flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-red">
          <IconTrash size={15} stroke={1.7} />
        </button>
      </div>
    </div>
  );
}
