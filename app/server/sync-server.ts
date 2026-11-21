/**
 * SketchToCAD Sync-Server (Dev): Hocuspocus (Yjs) + SQLite-Persistenz + Blob-Ablage.
 *
 *   node server/sync-server.ts        (Node ≥ 23, Typen werden nativ entfernt)
 *
 * - WebSocket  ws://localhost:1234/<beliebig>  → Yjs-Sync, Awareness, Stateless-Relay
 * - POST /blobs            → Datei speichern, Antwort { hash } (sha256, dedupliziert)
 * - GET  /blobs/<sha256>   → Datei ausliefern (immutable, lange cachebar)
 */
import { Server } from '@hocuspocus/server';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';

const PORT = Number(process.env.SYNC_PORT ?? 1234);
const DATA = path.resolve(process.env.SYNC_DATA ?? path.join(import.meta.dirname, 'data'));
const BLOBS = path.join(DATA, 'blobs');
const MAX_BLOB = 64 * 1024 * 1024;
mkdirSync(BLOBS, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'docs.sqlite'));
db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated INTEGER NOT NULL)');
const loadStmt = db.prepare('SELECT state FROM docs WHERE name = ?');
const saveStmt = db.prepare('INSERT INTO docs (name, state, updated) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated = excluded.updated');

const HASH_RE = /^\/blobs\/([0-9a-f]{64})$/;

function cors(res: import('node:http').ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = new Server({
  port: PORT,
  quiet: true,
  // Speichern gebündelt: höchstens alle 2 s, spätestens nach 10 s Dauer-Bearbeitung.
  debounce: 2000,
  maxDebounce: 10000,

  async onLoadDocument({ document, documentName }) {
    const row = loadStmt.get(documentName) as { state: Uint8Array } | undefined;
    if (row) Y.applyUpdate(document, new Uint8Array(row.state));
    return document;
  },

  async onStoreDocument({ document, documentName }) {
    // encodeStateAsUpdate ist bereits kompaktiert (GC), das Log wächst also nicht unbegrenzt.
    const state = Y.encodeStateAsUpdate(document);
    saveStmt.run(documentName, state, Date.now());
  },

  // Flüchtige Live-Daten (Cursor, Strich in Arbeit) nur weiterreichen, nie speichern.
  async onStateless({ document, connection, payload }) {
    if (payload.length > 64 * 1024) return;
    document.broadcastStateless(payload, (c) => c !== connection);
  },

  async onRequest({ request, response }) {
    const url = new URL(request.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/blobs')) return;
    cors(response);
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); throw null; }

    if (request.method === 'POST' && url.pathname === '/blobs') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of request) {
        size += c.length;
        if (size > MAX_BLOB) { response.writeHead(413); response.end(); throw null; }
        chunks.push(c);
      }
      const buf = Buffer.concat(chunks);
      const hash = createHash('sha256').update(buf).digest('hex');
      const file = path.join(BLOBS, hash);
      if (!existsSync(file)) {
        writeFileSync(file + '.tmp', buf);
        renameSync(file + '.tmp', file);
        writeFileSync(file + '.type', String(request.headers['content-type'] ?? 'application/octet-stream'));
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ hash }));
      throw null;
    }

    const m = HASH_RE.exec(url.pathname);
    if (request.method === 'GET' && m) {
      const file = path.join(BLOBS, m[1]);
      if (!existsSync(file)) { response.writeHead(404); response.end(); throw null; }
      const type = existsSync(file + '.type') ? readFileSync(file + '.type', 'utf8') : 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': statSync(file).size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${m[1]}"`,
      });
      createReadStream(file).pipe(response);
      throw null;
    }

    response.writeHead(404); response.end();
    throw null;
  },
});

await server.listen();
console.log(`[sync] Hocuspocus läuft auf ws://localhost:${PORT} · Daten: ${DATA}`);
