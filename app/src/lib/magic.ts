/**
 * Magic Pen: Skizze → MeshPad (GPU-Server, per Vite-Proxy `/mesh`) → Dreiecks-Mesh.
 * MeshPad streut stark; deshalb werden mehrere Seeds erzeugt und das sauberste Mesh gewählt.
 */
export type Mesh = { V: number[]; F: number[]; faces: number; boundary: number; score: number };

export function parseObj(text: string): Mesh {
  const V: number[] = [], F: number[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') V.push(+t[1], +t[2], +t[3]);
    else if (t[0] === 'f' && t.length >= 4) {
      const ix = t.slice(1).map((s) => parseInt(s, 10) - 1);
      for (let i = 1; i + 1 < ix.length; i++) F.push(ix[0], ix[i], ix[i + 1]); // Polygone fächern
    }
  }
  const faces = F.length / 3;
  // Offene Kanten (nur von einer Fläche genutzt): Maß für Löcher/fehlende Wände
  const edges = new Map<number, number>();
  const nv = V.length / 3;
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const key = Math.min(a, b) * nv + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const n of edges.values()) if (n === 1) boundary++;
  return { V, F, faces, boundary, score: faces < 4 ? Infinity : boundary + faces * 0.1 };
}

export async function generateMesh(png: Blob, n: number, onProgress: (done: number) => void, signal?: AbortSignal): Promise<Mesh> {
  let best: Mesh | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < n; i++) {
    onProgress(i);
    try {
      const fd = new FormData();
      fd.append('image', png, 'sketch.png');
      fd.append('seed', String(i + 1));
      fd.append('temperature', '0.5');
      const r = await fetch('/mesh/generate', { method: 'POST', body: fd, signal });
      if (!r.ok) throw new Error(r.status === 502 ? 'MeshPad läuft gerade nicht auf dem Heim-PC (Server gestoppt oder Tailscale getrennt)' : r.status === 504 ? 'MeshPad antwortet nicht (Zeitüberschreitung)' : `MeshPad-Fehler ${r.status}`);
      const m = parseObj((await r.json()).obj as string);
      if (!best || m.score < best.score) best = m;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (!best && i === 0 && e instanceof TypeError) break; // Netzwerkfehler: gar nicht erst weiter versuchen
    }
  }
  if (!best || !isFinite(best.score)) throw lastErr ?? new Error('MeshPad hat kein brauchbares Mesh erzeugt');
  return best;
}
