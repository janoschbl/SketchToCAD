import type { Peer, SyncStatus } from '@/sync/CanvasSync';
import WarmTooltip from '@/components/WarmTooltip';

const STATUS: Record<SyncStatus, { label: string; dot: string }> = {
  connected: { label: 'Live connected', dot: 'bg-emerald-500' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  offline: { label: 'Offline – changes will sync later', dot: 'bg-neutral-400' },
};

function Avatar({ name, color, ring }: { name: string; color: string; ring?: boolean }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <WarmTooltip content={name} side="bottom">
      <span
        className={`-ml-1.5 flex size-7 items-center justify-center rounded-full text-[10.5px] font-semibold text-white first:ml-0 ${ring ? 'shadow-[0_0_0_2px_#fff,0_0_0_3.5px_rgba(124,120,230,0.45)]' : 'shadow-[0_0_0_2px_#fff]'}`}
        style={{ background: color }}
      >
        {initials}
      </span>
    </WarmTooltip>
  );
}

/** Wer ist gerade da + Verbindungsstatus (oben rechts). */
export default function Presence({ me, peers, status }: { me: { name: string; color: string }; peers: Peer[]; status: SyncStatus }) {
  const s = STATUS[status];
  const shown = peers.slice(0, 5);
  return (
    <div className="absolute top-4 right-4 flex items-center gap-2.5 rounded-[14px] bg-surface py-1.5 pr-1.5 pl-3 shadow-raised">
      <WarmTooltip content={s.label} side="bottom">
        <span className={`size-2 rounded-full ${s.dot}`} aria-label={s.label} />
      </WarmTooltip>
      <div className="flex items-center">
        <Avatar name={`${me.name} (du)`} color={me.color} ring />
        {shown.map((p) => <Avatar key={p.id} name={p.name} color={p.color} />)}
        {peers.length > shown.length && <span className="-ml-1.5 flex size-7 items-center justify-center rounded-full bg-neutral-200 text-[10.5px] font-medium text-ink-2 shadow-[0_0_0_2px_#fff]">+{peers.length - shown.length}</span>}
      </div>
    </div>
  );
}
