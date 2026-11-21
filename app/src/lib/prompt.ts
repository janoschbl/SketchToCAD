import type { ElType } from '@/engine';

export type PromptPayload = {
  prompt: string;
  model: string;
  elements: { id: number; type: ElType; label: string; image: string | null }[];
  comments: { n: number; text: string; elementId: number | null; u: number; v: number; x: number; y: number }[];
  createdAt: string;
};

/**
 * Übergabe an das (noch nicht angebundene) KI-Backend.
 * Bis dahin wird die Anfrage geloggt und als DOM-Event `sketchtocad:prompt` verschickt,
 * damit ein Backend-Adapter sich später einfach daran hängen kann.
 */
export async function sendPrompt(p: PromptPayload) {
  console.info('[SketchToCAD] Prompt', p);
  window.dispatchEvent(new CustomEvent('sketchtocad:prompt', { detail: p }));
}
