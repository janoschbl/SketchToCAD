import type React from 'react';
import {
  IconArrowBackUp, IconArrowForwardUp, IconArrowRight, IconBucketDroplet, IconCircle, IconCube, IconEraser, IconHandStop,
  IconLock, IconLockOpen2, IconMessageCircle, IconMinus, IconNote, IconPencil, IconPhoto, IconPointer, IconSquare,
  IconSparkles, IconSquareRotated, IconTypography,
} from '@tabler/icons-react';
import type { Tool } from '@/engine';
import WarmTooltip, { WarmTooltipGroup } from '@/components/WarmTooltip';

type IconC = React.ComponentType<{ size?: number; stroke?: number; className?: string }>;

const MAIN: { id: Tool; label: string; key: string; Icon: IconC }[] = [
  { id: 'hand', label: 'Hand (Pannen)', key: 'H', Icon: IconHandStop },
  { id: 'select', label: 'Auswahl', key: 'V', Icon: IconPointer },
  { id: 'rect', label: 'Rechteck', key: 'R', Icon: IconSquare },
  { id: 'diamond', label: 'Raute', key: 'D', Icon: IconSquareRotated },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: IconCircle },
  { id: 'arrow', label: 'Pfeil', key: 'A', Icon: IconArrowRight },
  { id: 'line', label: 'Linie', key: 'L', Icon: IconMinus },
  { id: 'pen', label: 'Stift', key: 'P', Icon: IconPencil },
  { id: 'text', label: 'Text', key: 'T', Icon: IconTypography },
  { id: 'note', label: 'Notiz', key: 'N', Icon: IconNote },
];

const EXTRA: { id: Tool; label: string; key: string; Icon: IconC }[] = [
  { id: 'eraser', label: 'Radierer', key: 'E', Icon: IconEraser },
  { id: 'comment', label: 'Kommentar', key: 'C', Icon: IconMessageCircle },
  { id: 'bucket', label: 'Füllen', key: 'G', Icon: IconBucketDroplet },
  { id: 'magic', label: 'Magic Pen (Skizze → 3D)', key: 'M', Icon: IconSparkles },
];

function ToolBtn({ on, onClick, label, shortcut, children }: { on?: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode }) {
  return (
    <WarmTooltip content={label} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
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

export default function Toolbar({ tool, setTool, lock, setLock, onImage, onModel, onUndo, onRedo }: {
  tool: Tool; setTool: (t: Tool) => void; lock: boolean; setLock: (b: boolean) => void;
  onImage: () => void; onModel: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const icon = { size: 19, stroke: 1.6 };
  return (
    <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] bg-surface p-1 shadow-raised">
      <WarmTooltipGroup>
        <ToolBtn on={lock} onClick={() => setLock(!lock)} label={lock ? 'Werkzeug bleibt aktiv' : 'Werkzeug nach Benutzung wechseln'} shortcut="Q">
          {lock ? <IconLock {...icon} /> : <IconLockOpen2 {...icon} />}
        </ToolBtn>
        <Sep />
        {MAIN.map(({ id, label, key, Icon }) => (
          <ToolBtn key={id} on={tool === id} onClick={() => setTool(id)} label={label} shortcut={key}><Icon {...icon} /></ToolBtn>
        ))}
        <ToolBtn onClick={onImage} label="Bild einfügen" shortcut="I"><IconPhoto {...icon} /></ToolBtn>
        {EXTRA.map(({ id, label, key, Icon }) => (
          <ToolBtn key={id} on={tool === id} onClick={() => setTool(id)} label={label} shortcut={key}><Icon {...icon} /></ToolBtn>
        ))}
        <ToolBtn onClick={onModel} label="3D-Modell hinzufügen"><IconCube {...icon} /></ToolBtn>
        <Sep />
        <ToolBtn onClick={onUndo} label="Rückgängig (Strg+Z)"><IconArrowBackUp {...icon} /></ToolBtn>
        <ToolBtn onClick={onRedo} label="Wiederholen (Strg+Umschalt+Z)"><IconArrowForwardUp {...icon} /></ToolBtn>
      </WarmTooltipGroup>
    </div>
  );
}
