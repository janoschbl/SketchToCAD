import { DEMO, DEMO_MSG } from '@/lib/demo';
// KI-Studio: Client für lab/trellis_lab/server_local.py (Heim-PC, Vite-Proxy /trellis-api).
export const API = '/trellis-api';

export type Cls = { name: string; label: string; count: number; group: string };
export type Part = {
  id: string; name: string; kind: string; parent: string | null; version: number;
  url: string; mask_url: string; state: string; intact: boolean; sha: string;
};
export type Project = {
  id: string; version: number; subject: string; image: string; parts: Part[];
  history: { version: number; action: string; part: string; seconds: number; info: string }[];
  sketch: string | null; info?: string; changed?: string; seconds?: number;
};
export type Gen = { id: string; prompt: string; colors: string[]; seconds: number; images: string[] };
export type PlanItem = { mode: string; target: string; text: string };
export type Plan = { action: string | null; items?: PlanItem[]; text: string; seg_url?: string };

export type AiStep = { op: 'palette' | 'restyle' | 'replace' | 'delete'; parts: string[]; colors: { hex: string; share: number }[]; text: string };
export type AiPlan = { reply: string; steps: AiStep[]; modus?: string };
export type AiPart = { id: string; name: string; cx: number; cy: number; share: number };

export const url = (p: string) => `${API}/${p}`;

async function call<T>(path: string, fd?: FormData, signal?: AbortSignal): Promise<T> {
  if (DEMO) throw new Error(DEMO_MSG);
  let r: Response;
  try {
    r = await fetch(`${API}${path}`, fd ? { method: 'POST', body: fd, signal } : { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Home PC unreachable (sketch3d on port 8790, Tailscale?)');
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = j.detail ?? msg; } catch { /* kein JSON */ }
    if (r.status === 502 || r.status === 504) msg = 'Home PC not responding (sketch3d stopped or Tailscale disconnected)';
    throw new Error(msg);
  }
  return r.json();
}

function form(o: Record<string, string | number | Blob | null | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (v instanceof Blob) fd.append(k, v, `${k}.png`);
    else fd.append(k, String(v));
  }
  return fd;
}

/** Linientreue 0…1 → ControlNet-Stärke und wie lange (Anteil der Schritte) die Linien wirken. */
export function fidelity(t: number) {
  // t = 0.5 entspricht den im Lab erprobten Werten (Stärke 0.5, Linien bis 60 % der Schritte)
  return { scale: +(0.1 + 0.8 * t).toFixed(2), cn_end: +(0.35 + 0.5 * t).toFixed(2), edit_scale: +(0.4 + 0.8 * t).toFixed(2) };
}

export const api = {
  classes: () => call<Cls[]>('/classes'),
  status: () => call<{ sd: string; trellis: string }>('/status'),
  sketch2img: (sketch: Blob, subject: string, strokes: string, t: number, seed: number, n = 2) => {
    const f = fidelity(t);
    return call<Gen>('/sketch2img', form({ sketch, subject, strokes, seed, n, scale: f.scale, cn_end: f.cn_end, steps: 20, strength: 0.85 }));
  },
  img2three: (id: string, image: number) => call<{ project: Project; seconds: number }>('/img2three', form({ id, image, seed: 0 })),
  project: (id: string) => call<Project>(`/project/${id}`),
  plan: (id: string, newstrokes: Blob, signal?: AbortSignal) => call<Plan>('/plan', form({ id, newstrokes, action: 'auto' }), signal),
  edit: (id: string, sketch: Blob, newstrokes: Blob, strokes: string, t: number, part_text: string) =>
    call<Project>('/edit', form({ id, sketch, newstrokes, strokes, action: 'auto', method: 'auto', part_text, scale: fidelity(t).edit_scale })),
  erase: (id: string, mask: Blob, strokes: string) => call<Project>('/erase', form({ id, mask, strokes })),
  erase3d: (id: string, part: string, points: number[][], radius: number) =>
    call<Project>('/erase3d', form({ id, part, points: JSON.stringify(points), radius })),
  region: (id: string, op: 'recolor' | 'restyle' | 'replace' | 'delete' | 'palette', o: { mask?: Blob | null; parts?: string[]; color?: string; text?: string; colors?: { hex: string; share: number }[] }) =>
    call<Project>('/region', form({ id, op, mask: o.mask ?? null, parts: (o.parts ?? []).join(','), color: o.color, text: o.text, colors: o.colors ? JSON.stringify(o.colors) : undefined })),
  /** ChatGPT (Prompt-Server, Schlüssel bleibt dort): Wunsch in Worten → Bearbeitungsschritte */
  aiPlan: async (body: { prompt: string; subject: string; parts: AiPart[]; selected: string[]; image: string; labeled: string; history: { role: string; text: string }[] }) => {
    if (DEMO) throw new Error(DEMO_MSG);
    let r: Response;
    try {
      r = await fetch('/prompt-api/api/studio/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Prompt server unreachable (bun run prompt-server)');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail ?? j.fehler ?? `AI planning failed (${r.status})`);
    return j as AiPlan;
  },
  segmentAt: (id: string, x: number, y: number) => call<{ mask: string; score: number; area: number }>('/segment_at', form({ id, x: Math.round(x), y: Math.round(y) })),
  undo: (id: string) => call<Project>('/undo', form({ id })),
  rename: (id: string, part: string, name: string) => call<Project>('/part_rename', form({ id, part, name })),
  exportGlb: async (id: string) => {
    const r = await fetch(`${API}/export/${id}`);
    if (!r.ok) throw new Error('Export failed');
    const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'model.glb';
    return new File([await r.blob()], name, { type: 'model/gltf-binary' });
  },
};
