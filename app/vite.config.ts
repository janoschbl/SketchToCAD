import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      '/blobs': { target: `http://localhost:${process.env.SYNC_PORT ?? 1234}` },
    },
  },
});
