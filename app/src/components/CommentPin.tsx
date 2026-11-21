import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconCheck, IconTrash } from '@tabler/icons-react';
import type { CommentAnchor } from '@/engine';

export type Comment = { id: string; n: number; anchor: CommentAnchor; text: string; status: 'draft' | 'open' | 'sent' };

/** Nummerierter Pin mit Kommentarblase – Pin-Spitze (unten links) sitzt genau auf dem Ankerpunkt. */
export default function CommentPin({ c, x, y, open, onOpen, onClose, onSave, onDelete, onSend }: {
  c: Comment; x: number; y: number; open: boolean;
  onOpen: () => void; onClose: () => void;
  onSave: (text: string) => void; onDelete: () => void; onSend: (text: string) => void;
}) {
  const [text, setText] = useState(c.text);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setText(c.text); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open]);

  const commit = () => {
    const t = text.trim();
    if (!t) { if (c.status === 'draft' || !c.text) onDelete(); else onClose(); return; }
    onSave(t);
  };

  const sent = c.status === 'sent';
  return (
    <div
      className="absolute z-30"
      style={{ left: x, top: y - 28 }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (open ? commit() : onOpen())}
          aria-label={`Kommentar ${c.n}`}
          className={`flex size-7 shrink-0 items-center justify-center rounded-full rounded-bl-[4px] border-2 border-white text-[12px] font-semibold text-white shadow-[0_2px_8px_rgba(20,30,80,0.3)] transition-transform duration-150 hover:scale-110 ${sent ? 'bg-green' : 'bg-bui-accent'}`}
          style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom left' }}
        >
          {sent ? <IconCheck size={13} stroke={3} /> : c.n}
        </button>

        {open ? (
          <div
            className="flex h-10 w-80 items-center gap-1 rounded-full bg-[#26262b]/95 py-1 pr-1 pl-4 shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur"
            style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'left center' }}
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); onSend(text.trim()); }
                else if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); if (c.status === 'draft' && !c.text) onDelete(); else onClose(); }
              }}
              onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) commit(); }}
              placeholder="Kommentar hinzufügen…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/45"
            />
            {c.status !== 'draft' && (
              <button type="button" aria-label="Kommentar löschen" onClick={onDelete} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white">
                <IconTrash size={15} stroke={1.8} />
              </button>
            )}
            <button
              type="button"
              aria-label="Diesen Kommentar einzeln als Prompt senden"
              title="Einzeln senden (Strg+Enter)"
              disabled={!text.trim()}
              onClick={() => onSend(text.trim())}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#1b1b1f] transition-[opacity,transform] duration-150 enabled:active:scale-[0.94] disabled:opacity-25"
            >
              <IconArrowUp size={16} stroke={2.4} />
            </button>
          </div>
        ) : (
          hover && c.text && (
            <div className="pointer-events-none max-w-64 rounded-[10px] bg-[#26262b]/95 px-3 py-1.5 text-[12.5px] leading-snug text-white shadow-[0_8px_30px_rgba(0,0,0,0.22)]" style={{ animation: 'pop-in 140ms ease both' }}>
              {c.text}
              {sent && <span className="ml-1.5 text-[11px] text-white/50">· gesendet</span>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
