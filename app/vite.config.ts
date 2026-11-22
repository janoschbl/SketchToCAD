import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Schutz für /prompt-api: Der Proxy reicht Aufträge an das Backend mit dem OpenAI-Schlüssel weiter. Erlaubt sind der
 * eigene Rechner und private Netze (WLAN/LAN 192.168.x, 10.x, 172.16–31.x sowie Tailscale 100.64–127.x und fd…/fe80…),
 * damit die ChatGPT-Bearbeitung auch auf iPad & Co. läuft. Aus dem Internet ist der Dev-Server ohnehin nicht erreichbar.
 * Strenger: PROMPT_LOCAL_ONLY=1 (nur der eigene Rechner). Weitere IP-Präfixe: PROMPT_ALLOW="203.0.113." oder "*".
 */
function isPrivate(a: string) {
  if (a.includes(':')) return /^(fe80|fc|fd)/i.test(a);
  const [o1, o2] = a.split('.').map(Number);
  return o1 === 10 || (o1 === 192 && o2 === 168) || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254);
}
function promptGuard(): Plugin {
  const allow = (process.env.PROMPT_ALLOW ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const localOnly = process.env.PROMPT_LOCAL_ONLY === '1';
  const ok = (ip: string) => {
    const a = ip.replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1' || allow.includes('*') || allow.some((p) => a.startsWith(p)) || (!localOnly && isPrivate(a));
  };
  return {
    name: 'prompt-guard',
    configureServer(server) {
      server.middlewares.use('/prompt-api', (req, res, next) => {
        if (ok(req.socket.remoteAddress ?? '')) return next();
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ fehler: 'Prompt-Aufträge sind nur aus dem eigenen Netz (WLAN/Tailscale) erlaubt. Weitere Geräte: PROMPT_ALLOW beim Start von Vite.' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), promptGuard()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Zweite Seite: das Skizzendorf (village.html)
  build: { rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), village: path.resolve(__dirname, 'village.html'), world: path.resolve(__dirname, 'world.html'), lab: path.resolve(__dirname, 'lab.html'), trellis: path.resolve(__dirname, 'trellis.html'), studio: path.resolve(__dirname, 'studio.html') } } },
  // Sync-Server (server/sync-server.ts) über denselben Origin – funktioniert so auch im LAN.
  server: {
    // Sync-Daten (SQLite, Blobs) ändern sich laufend – nicht beobachten.
    watch: { ignored: ['**/server/data/**'] },
    proxy: {
      '/sync': { target: `ws://localhost:${process.env.SYNC_PORT ?? 1234}`, ws: true },
      // MeshPad (GPU-Server auf dem PC, per Tailscale): Browser spricht nur mit diesem Origin,
      // dadurch kein CORS/Mixed-Content und das iPad muss nicht im Tailnet sein.
      '/mesh': { target: process.env.MESHPAD_URL ?? 'http://100.86.99.105:8766', changeOrigin: true, rewrite: (p) => p.replace(/^\/mesh/, ''), timeout: 180000, proxyTimeout: 180000 },
      // SketchLab-Inferenz (eigenes Modell, GPU-Server auf dem PC, Port 8781)
      '/lab-api': { target: process.env.LAB_URL ?? 'http://100.86.99.105:8781', changeOrigin: true, rewrite: (p) => p.replace(/^\/lab-api/, ''), timeout: 60000, proxyTimeout: 60000 },
      // Prompt-Editor (prompt-editor/, FastAPI auf Port 8000): Modelle per Prompt ändern.
      // Schlüssel und Modelle stehen in prompt-editor/.env – der Browser sieht davon nichts. Zugriff: promptGuard.
      '/prompt-api': { target: process.env.PROMPT_URL ?? `http://localhost:${process.env.PROMPT_PORT ?? 8000}`, changeOrigin: true, rewrite: (p) => p.replace(/^\/prompt-api/, ''), timeout: 300000, proxyTimeout: 300000 },
      // Skizze → Bild → 3D, lokal auf dem Heim-PC (lab/trellis_lab/server_local.py, Unit sketch3d, Port 8790)
      '/trellis-api': { target: process.env.TRELLIS_LAB_URL ?? 'http://100.86.99.105:8790', changeOrigin: true, rewrite: (p) => p.replace(/^\/trellis-api/, ''), timeout: 600000, proxyTimeout: 600000 },
      '/blobs': { target: `http://localhost:${process.env.SYNC_PORT ?? 1234}` },
    },
  },
});
