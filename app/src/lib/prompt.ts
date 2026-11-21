/**
 * Prompt-Editor-Backend (prompt-editor/, FastAPI): Modelle per Text ändern.
 * Der Browser spricht nur mit diesem Origin; Vite leitet `/prompt-api` an den Python-Server weiter
 * (siehe vite.config.ts, PROMPT_URL). Schlüssel und Modellwahl liegen in prompt-editor/.env.
 */

const BASE = '/prompt-api';

export type PromptModel = { key: string; name: string; tag: string };
export type PromptConfig = { mode: string; defaultModel: string; models: PromptModel[] };

/** Schreibt „gpt-6.2-sol“ als „GPT-6.2 Sol“; unbekannte Namen bleiben unverändert. */
function modelInfo(id: string, defaultId: string): PromptModel {
  const m = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/i.exec(id);
  const family = m?.[2].toLowerCase();
  const tag = id === defaultId ? 'Default' : family === 'astra' ? 'Strongest' : family === 'terra' ? 'Cheapest' : '';
  return { key: id, name: m ? `GPT-${m[1]} ${m[2][0].toUpperCase()}${m[2].slice(1)}` : id, tag };
}

const FALLBACK_IDS = ['gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'];
export const FALLBACK_CONFIG: PromptConfig = {
  mode: 'unknown',
  defaultModel: FALLBACK_IDS[0],
  models: FALLBACK_IDS.map((id) => modelInfo(id, FALLBACK_IDS[0])),
};

export class PromptError extends Error {}

async function call(path: string, init?: RequestInit): Promise<any> {
  let r: Response;
  try {
    r = await fetch(BASE + path, init);
  } catch {
    throw new PromptError('Prompt server unreachable. Start it with “bun run prompt-server”.');
  }
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
  if (!r.ok) {
    if (j?.fehler) throw new PromptError(String(j.fehler));
    if (r.status >= 500 && !text) throw new PromptError('Prompt server unreachable. Start it with “bun run prompt-server”.');
    throw new PromptError(r.status === 422 ? 'Invalid request to the prompt server.' : `Prompt-Server-Fehler ${r.status}`);
  }
  return j;
}

export async function fetchConfig(): Promise<PromptConfig> {
  const j = await call('/api/config');
  const ids: string[] = j.modelle?.length ? j.modelle : FALLBACK_IDS;
  const def = ids.includes(j.modell) ? j.modell : ids[0];
  return { mode: String(j.modus), defaultModel: def, models: ids.map((id) => modelInfo(id, def)) };
}

/** Strukturierte Rückfrage des Agents (Werkzeug `frage_nach`). */
export type FrageOption = { id: string; label: string; beschreibung?: string | null; teile?: string | null };
export type Frage = {
  frage: string;
  typ: 'auswahl' | 'text' | 'teil' | 'modell' | 'farbe' | 'zahl' | 'ja_nein';
  optionen: FrageOption[];
  standard?: string | null;
  einheit?: string | null;
  mehrfach?: boolean;
};
/** Ein Schritt der Klärung: Frage des Agents oder Antwort des Nutzers (mit gewählten Teilen/Modell). */
export type VerlaufEintrag = { rolle: 'agent' | 'nutzer'; text: string; teile?: string | null; modell?: string | null; wert?: unknown };
export type Pin = { n: number; text: string; teil?: string | null; bild?: [number, number] | null };
export type ModelInfo = { name: string; laenge: number; breite: number; hoehe: number; selbst?: boolean };

export type PromptResult = {
  /** geändertes Modell; null, wenn nichts entstanden ist (Rückfrage oder Fehler) */
  glb: ArrayBuffer | null;
  /** Teile, die ein Werkzeug angefasst oder angelegt hat */
  changed: string[];
  errors: string[];
  /** höchstens eine strukturierte Rückfrage */
  question: Frage | null;
  /** freie Antwort der KI (z. B. Erklärung, warum etwas nicht geht) */
  text: string;
  /** z. B. „3,2 s · 1 204 Tokens“ */
  stats: string;
  /** Sitzung und Version im Backend – zum Fortsetzen nach einer Rückfrage ohne neuen Upload */
  session: string | null;
  version: number;
};

function normFrage(x: any): Frage | null {
  if (!x) return null;
  if (typeof x === 'string') return { frage: x, typ: 'text', optionen: [] };
  const typ = ['auswahl', 'text', 'teil', 'modell', 'farbe', 'zahl', 'ja_nein'].includes(x.typ) ? x.typ : 'text';
  return { frage: String(x.frage ?? ''), typ, optionen: Array.isArray(x.optionen) ? x.optionen : [], standard: x.standard ?? null, einheit: x.einheit ?? null, mehrfach: !!x.mehrfach };
}

function digest(j: any): Omit<PromptResult, 'glb'> {
  const log: any[] = j.aufrufe ?? [];
  const changed = [...new Set(log.filter((l) => l.werkzeug !== 'frage_nach' && Array.isArray(l.ergebnis)).flatMap((l) => l.ergebnis as string[]))];
  const errors = log.filter((l) => l.fehler).map((l) => `${l.werkzeug}: ${l.fehler}`);
  const u = j.nutzung ?? {};
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  const stats = [j.dauer_s !== undefined && `${Number(j.dauer_s).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`, tokens > 0 && `${tokens.toLocaleString('de-DE')} Tokens`]
    .filter(Boolean).join(' · ');
  return { changed, errors, question: normFrage((j.rueckfragen ?? [])[0]), text: String(j.ki_text ?? '').trim(), stats, session: j.session ?? null, version: Number(j.version ?? 0) };
}

async function finish(j: any): Promise<PromptResult> {
  const d = digest(j);
  if (!j.neue_version || !j.glb_url) return { glb: null, ...d };
  let r: Response;
  try { r = await fetch(BASE + j.glb_url); } catch { throw new PromptError('Could not load the result.'); }
  if (!r.ok) throw new PromptError('Could not load the result.');
  return { glb: await r.arrayBuffer(), ...d };
}

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /:(.*?);/.exec(head)?.[1] ?? 'image/png' });
}

/** Grenzen wie im Backend (prompt-editor/app/server.py) – vorher prüfen spart den Upload. */
export const MAX_MODEL_BYTES = 200 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type EditArgs = {
  prompt: string;
  model: string;
  part?: string | null;
  image?: string | null;
  /** gerenderte Ansichten + Set-of-Marks (data-URLs) und Zuordnung Teilname → Nummer */
  views?: string[];
  marks?: Record<string, number>;
  verlauf?: VerlaufEntryList;
  models?: ModelInfo[];
  pins?: Pin[];
  label?: string;
};
type VerlaufEntryList = VerlaufEintrag[];

function form(a: EditArgs): FormData {
  const fd = new FormData();
  fd.append('auftrag', a.prompt);
  fd.append('modell', a.model);
  fd.append('ausgewaehlt', a.part ?? '');
  if (a.image) {
    const b = dataUrlToBlob(a.image);
    if (b.size > MAX_IMAGE_BYTES) throw new PromptError('The reference image is larger than 12 MB.');
    fd.append('bild', b, 'referenz.png');
  }
  (a.views ?? []).forEach((v, i) => fd.append('ansichten', dataUrlToBlob(v), `ansicht_${i + 1}.${v.startsWith('data:image/png') ? 'png' : 'jpg'}`));
  if (a.marks) fd.append('marken', JSON.stringify(a.marks));
  if (a.verlauf?.length) fd.append('verlauf', JSON.stringify(a.verlauf));
  if (a.models?.length) fd.append('modelle', JSON.stringify(a.models));
  if (a.pins?.length) fd.append('pins', JSON.stringify(a.pins));
  if (a.label) fd.append('modellname', a.label);
  return fd;
}

/** Bestehendes Modell (GLB) per Prompt ändern. `part` = angeklicktes Teil bzw. *-Muster. */
export async function editModel(a: EditArgs & { glb: ArrayBuffer }): Promise<PromptResult> {
  if (a.glb.byteLength > MAX_MODEL_BYTES) throw new PromptError('The model is larger than 200 MB.');
  const fd = form(a);
  fd.append('datei', new Blob([a.glb], { type: 'model/gltf-binary' }), 'modell.glb');
  return finish(await call('/api/edit-glb', { method: 'POST', body: fd }));
}

/**
 * Nach einer Rückfrage weitermachen: dieselbe Sitzung im Backend, kein neuer Upload.
 * Gibt null zurück, wenn die Sitzung abgelaufen ist (dann mit editModel neu senden).
 */
export async function continueEdit(session: string, a: EditArgs): Promise<PromptResult | null> {
  if (!/^[a-z0-9]+$/i.test(session)) return null;
  try {
    return await finish(await call(`/api/${session}/edit`, { method: 'POST', body: form(a) }));
  } catch (err) {
    if (err instanceof PromptError && /Sitzung nicht gefunden/.test(err.message)) return null;
    throw err;
  }
}

/** OBJ/USD (oder glTF) über den Prompt-Server in GLB umwandeln. */
export async function convertModel(f: File): Promise<ArrayBuffer> {
  if (f.size > MAX_MODEL_BYTES) throw new PromptError('The file is larger than 200 MB.');
  const fd = new FormData();
  fd.append('datei', f, f.name);
  let r: Response;
  try { r = await fetch(BASE + '/api/convert', { method: 'POST', body: fd }); } catch { throw new PromptError('Prompt server unreachable. Start it with “bun run prompt-server”.'); }
  if (!r.ok) {
    let msg = `Conversion failed (${r.status})`;
    try { const j = await r.json(); if (j?.fehler) msg = String(j.fehler); } catch { /* keine JSON-Antwort */ }
    throw new PromptError(msg);
  }
  return r.arrayBuffer();
}
