/** Öffentliche Demo (VITE_DEMO=1): Zeichnen, Verschieben usw. laufen im Browser; KI-Backends (GPU-Server) sind absichtlich nicht angebunden. */
export const DEMO = import.meta.env.VITE_DEMO === '1';
export const DEMO_MSG = 'Live AI generation runs on our own GPU server and is switched off in this public demo. Draw and arrange freely – or watch the finished project in the museum of Sketch Village.';
export class DemoError extends Error { constructor() { super(DEMO_MSG); } }
