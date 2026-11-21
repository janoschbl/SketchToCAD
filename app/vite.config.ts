import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Schutz für /prompt-api: Der Proxy reicht Aufträge an das Backend mit dem OpenAI-Schlüssel weiter. Weil der
 * Dev-Server per `--host` im LAN erreichbar ist (iPad), darf nur der eigene Rechner KI-Aufträge auslösen.
 * Freigabe für weitere Geräte: PROMPT_ALLOW="192.168.1.23,100." (IP-Präfixe) oder PROMPT_ALLOW="*".
 */
function promptGuard(): Plugin {
  const allow = (process.env.PROMPT_ALLOW ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const ok = (ip: string) => {
    const a = ip.replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1' || allow.includes('*') || allow.some((p) => a.startsWith(p));
  };
  return {
    name: 'prompt-guard',
    configureServer(server) {
      server.middlewares.use('/prompt-api', (req, res, next) => {
        if (ok(req.socket.remoteAddress ?? '')) return next();
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ fehler: 'Prompt-Aufträge sind nur vom eigenen Rechner aus erlaubt. Freigabe per PROMPT_ALLOW beim Start von Vite.' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), promptGuard()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Zweite Seite: das Skizzendorf (village.html)
  build: { rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), village: path.resolve(__dirname, 'village.html'), lab: path.resolve(__dirname, 'lab.html') } } },
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
      '/blobs': { target: `http://localhost:${process.env.SYNC_PORT ?? 1234}` },
    },
  },
});
