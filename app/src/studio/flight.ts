// Flug-Rig für den Schmetterling: aus dem (verschmolzenen) KI-Mesh wird ein Skinned Mesh mit 5 Knochen
// (Körper, Vorder-/Hinterflügel links/rechts) und einem Flügelschlag-Clip, der als animiertes GLB exportiert werden kann.
//
// Annahmen aus der Pipeline (Kamera der Skizze auf +X, Prompt „top view, wings spread open“):
//   +X = Rücken (dorsal), +Y = Kopf, Z = Spannweite, Mitte bei z ≈ Mitte der Bounding Box (gespiegelt gezeichnet).
// Biologisch angelehnt (Tagfalter): Vorder- und Hinterflügel schlagen gekoppelt, der Hinterflügel etwas später und
// kleiner; oben fast Flügelschluss (Clap & Fling), unten ca. 30° unter die Waagerechte; Abschlag etwas schneller als
// Aufschlag; Flügel drehen sich im Abschlag mit der Vorderkante nach unten (Pronation), im Aufschlag umgekehrt.
// Der Körper hebt sich im Abschlag (Auftrieb), senkt sich im Aufschlag und nickt leicht. Der Clip ist „in place“
// (ohne Vorwärtsbewegung), so wie Game-Engines und Blender ihn als Schleife erwarten.
import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export type FlightRig = {
  /** Wurzel: schon so gedreht, dass die Flügelebene waagerecht liegt (Kopf → −X, Rücken → +Y). */
  root: T.Group;
  clip: T.AnimationClip;
  info: { span: number; bodyHalf: number; verts: number; meshes: number };
  /** Dateiname beim Export, Beschreibung für die Anzeige */
  file: string;
  label: string;
};

const D = T.MathUtils.degToRad;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pct = (a: Float32Array | number[], q: number) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const median = (a: number[]) => pct(a, 0.5);

/** Zeitverzerrung: Abschlag (0 → 0.5 der Phase) dauert 45 % des Zyklus, Aufschlag 55 %. */
function warp(t: number) {
  t = ((t % 1) + 1) % 1;
  return t < 0.45 ? (t / 0.45) * 0.5 : 0.5 + ((t - 0.45) / 0.55) * 0.5;
}

/** Flügelschlag in Grad (positiv = nach oben). Oben +75° (fast Flügelschluss), unten −30°. */
function flap(s: number) { return 22.5 + 52.5 * Math.cos(2 * Math.PI * s); }

export function buildFlightRig(meshes: T.Mesh[], duration = 0.5): FlightRig | null {
  const geos: { g: T.BufferGeometry; m: T.Material | T.Material[] }[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    geos.push({ g, m: Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone() });
  }
  // Statistik über alle Vertices (Stichprobe)
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  let total = 0;
  for (const { g } of geos) total += g.attributes.position.count;
  if (!total) return null;
  const step = Math.max(1, Math.floor(total / 60000));
  for (const { g } of geos) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += step) { xs.push(p.getX(i)); ys.push(p.getY(i)); zs.push(p.getZ(i)); }
  }
  const z0 = pct(zs, 0.005), z1 = pct(zs, 0.995);
  const cz = (z0 + z1) / 2, half = Math.max(1e-6, (z1 - z0) / 2);

  // Körperbreite: Dickenprofil (X-Ausdehnung) über |z − Mitte|; der Rumpf ist dicker als die Flügel.
  const BINS = 40, bx: number[][] = Array.from({ length: BINS }, () => []);
  for (let i = 0; i < zs.length; i++) {
    const b = Math.min(BINS - 1, Math.floor((Math.abs(zs[i] - cz) / half) * BINS));
    bx[b].push(xs[i]);
  }
  const thick = bx.map((a) => (a.length > 8 ? pct(a, 0.95) - pct(a, 0.05) : 0));
  const t0 = Math.max(thick[0], thick[1]);
  let edge = 0;
  while (edge < BINS / 4 && thick[edge] > 0.6 * t0) edge++;
  const bodyHalf = T.MathUtils.clamp(((edge + 0.5) / BINS) * half, 0.04 * half, 0.15 * half);

  // Gelenk: Höhe der Flügelwurzel (Median x knapp außerhalb des Rumpfs), Körpermitte in y
  const root: number[] = [], core: number[] = [], wingY: number[] = [];
  for (let i = 0; i < zs.length; i++) {
    const d = Math.abs(zs[i] - cz);
    if (d < bodyHalf) core.push(ys[i]);
    else if (d < 2.2 * bodyHalf) root.push(xs[i]);
    if (d > 1.5 * bodyHalf && d < 0.6 * half) wingY.push(ys[i]);
  }
  const hx = root.length ? median(root) : median(xs);
  const yc = core.length ? (pct(core, 0.1) + pct(core, 0.9)) / 2 : median(ys);
  const split = wingY.length ? median(wingY) : yc; // Grenze Vorder-/Hinterflügel
  const band = 0.14 * half;
  const C = new T.Vector3(hx, yc, cz);

  // Knochen (Ruhelage = Mesh-Koordinaten, um C zentriert)
  const body = new T.Bone(); body.name = 'body';
  const mk = (name: string, side: number) => { const b = new T.Bone(); b.name = name; b.position.set(0, 0, side * bodyHalf); body.add(b); return b; };
  // Blick von oben, Kopf oben: rechter Flügel liegt im Bild rechts = −Z
  const bones = [body, mk('wing_fore_L', 1), mk('wing_hind_L', 1), mk('wing_fore_R', -1), mk('wing_hind_R', -1)];

  const inner = new T.Group(); inner.name = 'butterfly';
  inner.add(body);
  const skinned: T.SkinnedMesh[] = [];
  for (const { g, m } of geos) {
    g.translate(-C.x, -C.y, -C.z);
    const p = g.attributes.position, n = p.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const z = p.getZ(i), y = p.getY(i);
      const w = smooth(0.7 * bodyHalf, 1.5 * bodyHalf, Math.abs(z));
      const fore = smooth(split - C.y - band, split - C.y + band, y);
      const L = z > 0;
      si.set([0, L ? 1 : 3, L ? 2 : 4, 0], i * 4);
      sw.set([1 - w, w * fore, w * (1 - fore), 0], i * 4);
    }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    const sm = new T.SkinnedMesh(g, m);
    sm.name = 'butterfly_mesh';
    sm.frustumCulled = false; // Flügel verlassen beim Schlag die Ruhe-Bounding-Box
    inner.add(sm);
    skinned.push(sm);
  }
  const rootG = new T.Group(); rootG.name = 'butterfly_flight';
  rootG.rotation.z = Math.PI / 2; // (x, y) → (−y, x): Rücken nach oben, Kopf nach −X
  rootG.add(inner);
  rootG.updateMatrixWorld(true);
  const skel = new T.Skeleton(bones);
  for (const sm of skinned) sm.bind(skel);

  // Clip abtasten
  const N = 32, times: number[] = [];
  const tracks: Record<string, number[]> = {};
  const q = new T.Quaternion(), qa = new T.Quaternion(), qb = new T.Quaternion();
  const Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
  const push = (k: string, v: number[]) => { (tracks[k] ??= []).push(...v); };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    times.push(t * duration);
    const s = warp(t);
    // Körper: tiefster Punkt kurz nach Beginn des Abschlags, höchster nach dessen Ende; Nase hoch im Abschlag
    const bob = -0.045 * half * Math.cos(2 * Math.PI * (s - 0.1));
    push('body.position', [bob, 0, 0]);
    q.setFromAxisAngle(Z, -D(7) * Math.sin(2 * Math.PI * s));
    push('body.quaternion', q.toArray());
    for (const [name, side, lag, amp, tw] of [
      ['wing_fore_L', 1, 0, 1, 14], ['wing_hind_L', 1, 0.05, 0.88, 8],
      ['wing_fore_R', -1, 0, 1, 14], ['wing_hind_R', -1, 0.05, 0.88, 8],
    ] as const) {
      const sl = warp(t - lag);
      const a = D(flap(sl)) * amp;
      qa.setFromAxisAngle(Y, side * a); // Spitze (±Z) Richtung Rücken (+X)
      qb.setFromAxisAngle(Z, D(tw) * Math.sin(2 * Math.PI * sl)); // Abschlag: Vorderkante (+Y) nach unten (−X)
      q.multiplyQuaternions(qa, qb);
      push(`${name}.quaternion`, q.toArray());
    }
  }
  const kt = Object.entries(tracks).map(([k, v]) => k.endsWith('position')
    ? new T.VectorKeyframeTrack(k, times, v)
    : new T.QuaternionKeyframeTrack(k, times, v));
  const clip = new T.AnimationClip('flap', duration, kt);
  return { root: rootG, clip, info: { span: 2 * half, bodyHalf, verts: total, meshes: skinned.length }, file: 'schmetterling-flug.glb', label: 'Flight rig: body + 4 wings (fore/hind wing per side), wing beat 2 Hz, loop “flap”' };
}

/** Animiertes GLB (Skin + Clip „flap“, in place, Schleife). */
export function exportFlightGlb(rig: FlightRig): Promise<File> {
  // Für den Export in Ruhelage zurücksetzen, sonst landet die gerade angezeigte Pose in den Knoten
  const saved = new Map<T.Object3D, { p: T.Vector3; q: T.Quaternion }>();
  rig.root.traverse((o) => { if ((o as T.Bone).isBone) saved.set(o, { p: o.position.clone(), q: o.quaternion.clone() }); });
  rig.root.traverse((o) => {
    if (!(o as T.Bone).isBone) return;
    o.quaternion.identity();
    if (o.name === 'body') o.position.set(0, 0, 0);
  });
  rig.root.updateMatrixWorld(true);
  return new Promise<File>((resolve, reject) => {
    new GLTFExporter().parse(rig.root, (r) => {
      resolve(new File([r as ArrayBuffer], rig.file, { type: 'model/gltf-binary' }));
    }, reject, { binary: true, animations: [rig.clip] });
  }).finally(() => {
    for (const [o, s] of saved) { o.position.copy(s.p); o.quaternion.copy(s.q); }
  });
}


/**
 * Marienkäfer: Die zwei Flügeldecken (Elytren) klappen an der Mittelnaht nach oben, darunter schlagen die häutigen
 * Hinterflügel – sie sind im (geschlossenen) KI-Mesh nicht vorhanden und werden deshalb als dünne durchscheinende
 * Flächen ergänzt. Echte Käfer: Decken heben sich im Flug auf ca. 50–60° und bleiben dort, die Hinterflügel schlagen
 * schnell (hier 2 Schläge pro Schleife, im Zeitraffer lesbar) und fächern dabei von waagerecht nach oben/hinten.
 * Gleiche Achsen wie beim Schmetterling: +X Rücken, +Y Kopf, Z Spannweite.
 */
export function buildElytraRig(meshes: T.Mesh[], duration = 0.5): FlightRig | null {
  const geos: { g: T.BufferGeometry; m: T.Material | T.Material[] }[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    geos.push({ g, m: Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone() });
  }
  let total = 0;
  for (const { g } of geos) total += g.attributes.position.count;
  if (!total) return null;
  const step = Math.max(1, Math.floor(total / 60000));
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (const { g } of geos) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += step) { xs.push(p.getX(i)); ys.push(p.getY(i)); zs.push(p.getZ(i)); }
  }
  const z0 = pct(zs, 0.005), z1 = pct(zs, 0.995), y0 = pct(ys, 0.005), y1 = pct(ys, 0.995), x0 = pct(xs, 0.005), x1 = pct(xs, 0.995);
  const cz = (z0 + z1) / 2, half = Math.max(1e-6, (z1 - z0) / 2), len = Math.max(1e-6, y1 - y0), thick = Math.max(1e-6, x1 - x0);
  const ySplit = y1 - 0.3 * len;           // vorn: Kopf + Halsschild, dahinter die Decken
  const C = new T.Vector3(median(xs), (y0 + y1) / 2, cz);
  const band = 0.06 * len;

  const body = new T.Bone(); body.name = 'body';
  const mk = (name: string, side: number, x: number, y: number, z: number) => { const b = new T.Bone(); b.name = name; b.position.set(x, y, side * z); body.add(b); return b; };
  const elytraL = mk('elytron_L', 1, 0, 0, 0.03 * half), elytraR = mk('elytron_R', -1, 0, 0, 0.03 * half);
  const wingY = ySplit - C.y;
  const wingL = mk('hindwing_L', 1, 0.05 * thick, wingY, 0.08 * half), wingR = mk('hindwing_R', -1, 0.05 * thick, wingY, 0.08 * half);
  const bones = [body, elytraL, elytraR, wingL, wingR];

  const inner = new T.Group(); inner.name = 'ladybug';
  inner.add(body);
  const skinned: T.SkinnedMesh[] = [];
  for (const { g, m } of geos) {
    g.translate(-C.x, -C.y, -C.z);
    const p = g.attributes.position, n = p.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rear = 1 - smooth(wingY - band, wingY + band, y);        // hinter dem Halsschild
      const dorsal = smooth(0, 0.14 * thick, x);                      // nur die obere Kuppel, nicht der Bauch
      const side = smooth(0.03 * half, 0.22 * half, Math.abs(z));     // nahe der Naht bleibt am Körper
      const w = rear * dorsal * side;
      si.set([0, z > 0 ? 1 : 2, 0, 0], i * 4);
      sw.set([1 - w, w, 0, 0], i * 4);
    }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    const sm = new T.SkinnedMesh(g, m);
    sm.name = 'ladybug_mesh';
    sm.frustumCulled = false;
    inner.add(sm);
    skinned.push(sm);
  }
  // Hinterflügel: durchscheinende Flächen mit Rippen-Ton, ragen seitlich unter den Decken hervor
  const wingMat = new T.MeshStandardMaterial({ color: 0xb9c2cc, transparent: true, opacity: 0.55, roughness: 0.4, side: T.DoubleSide, name: 'hindwing' });
  const L = 1.15 * half, chord = 0.42 * len;
  for (const [bone, side] of [[wingL, 1], [wingR, -1]] as const) {
    const pts: T.Vector2[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * 2 * Math.PI;
      // Tropfenform: breit am Gelenk, schmal an der Spitze, nach hinten (−Y) geneigt
      const u = (0.5 + 0.5 * Math.cos(a)) * L, w = 0.5 * chord * Math.sin(a) * Math.pow(1 - u / L, 0.35) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, u / L + 0.12)));
      pts.push(new T.Vector2(u, -0.35 * chord * (u / L) + w));
    }
    const geo = new T.ShapeGeometry(new T.Shape(pts));
    geo.rotateY(-Math.PI / 2 * side); // Spannweite (u) → ±Z
    const wm = new T.Mesh(geo, wingMat); wm.name = `hindwing_mesh_${side > 0 ? 'L' : 'R'}`;
    bone.add(wm);
  }
  const rootG = new T.Group(); rootG.name = 'ladybug_flight';
  rootG.rotation.z = Math.PI / 2;
  rootG.add(inner);
  rootG.updateMatrixWorld(true);
  const skel = new T.Skeleton(bones);
  for (const sm of skinned) sm.bind(skel);

  const NF = 32, times: number[] = [];
  const tracks: Record<string, number[]> = {};
  const q = new T.Quaternion(), qa = new T.Quaternion(), qb = new T.Quaternion();
  const Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
  const push = (k: string, v: number[]) => { (tracks[k] ??= []).push(...v); };
  for (let i = 0; i <= NF; i++) {
    const t = i / NF;
    times.push(t * duration);
    const beat = Math.sin(2 * Math.PI * 2 * t);                    // 2 Hinterflügelschläge pro Schleife
    push('body.position', [-0.05 * half * Math.cos(2 * Math.PI * 2 * t - 0.6), 0, 0]);
    q.setFromAxisAngle(Z, -D(6) * Math.sin(2 * Math.PI * 2 * t));  // Nase wippt im Takt
    push('body.quaternion', q.toArray());
    for (const [name, side] of [['elytron_L', 1], ['elytron_R', -1]] as const) {
      qa.setFromAxisAngle(Y, side * D(55 + 3 * beat));            // Decken bleiben oben, zittern leicht
      push(`${name}.quaternion`, qa.toArray());
    }
    for (const [name, side] of [['hindwing_L', 1], ['hindwing_R', -1]] as const) {
      qa.setFromAxisAngle(Y, side * D(10 + 55 * beat));           // von unter der Waagerechten bis hoch
      qb.setFromAxisAngle(Z, D(-18 + 8 * beat));                  // nach hinten geschwenkt
      q.multiplyQuaternions(qa, qb);
      push(`${name}.quaternion`, q.toArray());
    }
  }
  const kt = Object.entries(tracks).map(([k, v]) => k.endsWith('position')
    ? new T.VectorKeyframeTrack(k, times, v)
    : new T.QuaternionKeyframeTrack(k, times, v));
  const clip = new T.AnimationClip('flutter', duration, kt);
  return {
    root: rootG, clip, info: { span: 2 * half, bodyHalf: 0.08 * half, verts: total, meshes: skinned.length },
    file: 'marienkaefer-flug.glb', label: 'Flight rig: shell halves lift, two translucent hind wings beat (added, the generated mesh has none), loop “flutter”',
  };
}
