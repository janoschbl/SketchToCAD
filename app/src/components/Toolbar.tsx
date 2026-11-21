// Werkzeugleiste des Canvas, bewusst schlicht: Hand, Auswahl, Stift + Untermenü „Werkzeuge“ (Split-Button:
// links das zuletzt benutzte, ▾ öffnet alle) für Notizen, Concept Maps und Abläufe.
// Alles, was mit KI und 3D zu tun hat, passiert im KI-Studio – dafür gibt es genau einen Knopf.
// 3D-Modelle aus dem Studio landen im Canvas; anklicken → „Im Studio bearbeiten“ holt sie zurück.
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  IconArrowBackUp, IconArrowForwardUp, IconArrowRight, IconBucketDroplet, IconChevronDown, IconCircle, IconEraser, IconHandStop,
  IconFileUpload, IconLock, IconLockOpen2, IconMessageCircle, IconMinus, IconNote, IconPencil, IconPhoto, IconPointer, IconSquare,
  IconSparkles, IconSquareRotated, IconTypography,
} from '@tabler/icons-react';
import type { Tool } from '@/engine';
import WarmTooltip, { WarmTooltipGroup } from '@/components/WarmTooltip';

type IconC = React.ComponentType<{ size?: number; stroke?: number; className?: string }>;
type Item = { id: Tool; label: string; key: string; Icon: IconC };

const MAIN: Item[] = [
  { id: 'hand', label: 'Hand (pan)', key: 'H', Icon: IconHandStop },
  { id: 'select', label: 'Select', key: 'V', Icon: IconPointer },
  { id: 'pen', label: 'Pen', key: 'P', Icon: IconPencil },
];

const MENU: { title: string; items: Item[] }[] = [
  { title: 'Shapes', items: [
    { id: 'rect', label: 'Rectangle', key: 'R', Icon: IconSquare },
    { id: 'diamond', label: 'Diamond', key: 'D', Icon: IconSquareRotated },
    { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: IconCircle },
  ] },
  { title: 'Connect', items: [
    { id: 'arrow', label: 'Arrow', key: 'A', Icon: IconArrowRight },
    { id: 'line', label: 'Line', key: 'L', Icon: IconMinus },
  ] },
  { title: 'Write', items: [
    { id: 'text', label: 'Text', key: 'T', Icon: IconTypography },
    { id: 'note', label: 'Note', key: 'N', Icon: IconNote },
    { id: 'comment', label: 'Comment', key: 'C', Icon: IconMessageCircle },
  ] },
  { title: 'Edit', items: [
    { id: 'eraser', label: 'Eraser', key: 'E', Icon: IconEraser },
    { id: 'bucket', label: 'Fill', key: 'G', Icon: IconBucketDroplet },
  ] },
];
const MENU_ITEMS = MENU.flatMap((g) => g.items);
const LAST_KEY = 'toolbar.lastBoard';

function ToolBtn({ on, onClick, label, shortcut, children }: { on?: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode }) {
  return (
    <WarmTooltip content={label} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={!!on}
        onClick={onClick}
        className={`relative flex size-9 items-center justify-center rounded-[10px] transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
          on ? 'bg-[#e0dfff] text-[#3b37a5]' : 'text-[#1b1b1f] hover:bg-hover-2/70'
        }`}
      >
        {children}
        {shortcut && <span className={`absolute right-[3px] bottom-px text-[8.5px] leading-none ${on ? 'text-[#3b37a5]/70' : 'text-ink-3/70'}`}>{shortcut}</span>}
      </button>
    </WarmTooltip>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px bg-line-strong" />;

export default function Toolbar({ tool, setTool, lock, setLock, onImage, onModelFile, onUndo, onRedo, onStudio }: {
  tool: Tool; setTool: (t: Tool) => void; lock: boolean; setLock: (b: boolean) => void;
  onImage: () => void; onModel?: () => void; onModelFile: () => void; onUndo: () => void; onRedo: () => void; onStudio?: () => void;
}) {
  const icon = { size: 19, stroke: 1.6 };
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<Tool>(() => {
    try { const v = localStorage.getItem(LAST_KEY) as Tool | null; if (v && MENU_ITEMS.some((x) => x.id === v)) return v; } catch { /* kein Speicher */ }
    return 'rect';
  });
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!MENU_ITEMS.some((x) => x.id === tool)) return;
    setLast(tool);
    try { localStorage.setItem(LAST_KEY, tool); } catch { /* kein Speicher */ }
  }, [tool]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);
  const lastItem = MENU_ITEMS.find((x) => x.id === last) ?? MENU_ITEMS[0];
  const menuOn = MENU_ITEMS.some((x) => x.id === tool);
  const choose = (t: Tool) => { setTool(t); setOpen(false); };
  return (
    <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] bg-surface p-1 shadow-raised">
      <WarmTooltipGroup>
        <ToolBtn on={lock} onClick={() => setLock(!lock)} label={lock ? 'Tool stays active' : 'Switch tool after use'} shortcut="Q">
          {lock ? <IconLock {...icon} /> : <IconLockOpen2 {...icon} />}
        </ToolBtn>
        <Sep />
        {MAIN.map(({ id, label, key, Icon }) => (
          <ToolBtn key={id} on={tool === id} onClick={() => setTool(id)} label={label} shortcut={key}><Icon {...icon} /></ToolBtn>
        ))}
        <Sep />
        <div ref={boxRef} className="relative flex items-center" data-testid="tools-menu">
          <ToolBtn on={menuOn} onClick={() => choose(menuOn ? tool : last)} label={lastItem.label} shortcut={lastItem.key}>
            {(() => { const I = (MENU_ITEMS.find((x) => x.id === tool) ?? lastItem).Icon; return <I {...icon} />; })()}
          </ToolBtn>
          <WarmTooltip content="Shapes, arrows, text, notes …" side="bottom">
            <button type="button" aria-label="More tools" aria-expanded={open} data-testid="tools-more" onClick={() => setOpen((o) => !o)}
              className={`flex h-9 w-6 items-center justify-center rounded-[8px] transition-colors ${open ? 'bg-[#e0dfff] text-[#3b37a5]' : 'text-ink-2 hover:bg-hover-2/70'}`}>
              <IconChevronDown size={15} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>
          </WarmTooltip>
          {open && (
            <div role="menu" className="absolute top-full left-1/2 z-30 mt-2 w-[280px] -translate-x-1/2 rounded-[14px] bg-surface p-2 shadow-raised"
              style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'top center' }}>
              {MENU.map((g) => (
                <div key={g.title} className="mb-1">
                  <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">{g.title}</div>
                  <div className="grid grid-cols-2 gap-0.5">
                    {g.items.map(({ id, label, key, Icon }) => (
                      <button key={id} role="menuitem" onClick={() => choose(id)}
                        className={`flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13px] transition-colors ${tool === id ? 'bg-[#e0dfff] text-[#3b37a5]' : 'hover:bg-hover'}`}>
                        <Icon size={17} stroke={1.6} /><span className="flex-1 truncate">{label}</span><kbd className="text-[10.5px] text-ink-3">{key}</kbd>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">Insert</div>
              <div className="grid grid-cols-2 gap-0.5">
                <button role="menuitem" onClick={() => { setOpen(false); onImage(); }} className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13px] hover:bg-hover">
                  <IconPhoto size={17} stroke={1.6} /><span className="flex-1">Image</span><kbd className="text-[10.5px] text-ink-3">I</kbd>
                </button>
                <button role="menuitem" onClick={() => { setOpen(false); onModelFile(); }} className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13px] hover:bg-hover">
                  <IconFileUpload size={17} stroke={1.6} /><span className="flex-1">3D file</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <Sep />
        <ToolBtn onClick={onUndo} label="Undo (Ctrl+Z)"><IconArrowBackUp {...icon} /></ToolBtn>
        <ToolBtn onClick={onRedo} label="Redo (Ctrl+Shift+Z)"><IconArrowForwardUp {...icon} /></ToolBtn>
        {onStudio && (
          <>
            <Sep />
            <WarmTooltip
              content={<span className="block w-60 whitespace-normal"><span className="block">AI Studio</span><span className="mt-0.5 block text-[11.5px] font-normal opacity-75">Sketch here and turn it into 3D: sketch → 2 versions → model, then onto the canvas. Click a model on the canvas → “Edit in Studio”.</span></span>}
              shortcut="K" side="bottom"
            >
              <button type="button" aria-label="AI Studio" onClick={onStudio} data-testid="open-studio"
                className="ai-tool flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium text-[#3b37a5] transition-transform active:scale-[0.96]">
                <IconSparkles size={17} stroke={1.7} />AI Studio
              </button>
            </WarmTooltip>
          </>
        )}
      </WarmTooltipGroup>
    </div>
  );
}
