import * as THREE from 'three';
import './village.css';
import * as P from './props';
import { Generator, type SketchObj } from './sketch';
import { Sparks, Sfx, createWaveRing } from './fx';
import { MagicBrush } from './brush';
import { RevealMask, makeRevealUniforms } from './reveal';
import {
  createSky, createSea, createIsland, createGrass, createFireflies, createDrawingPad, Leaves,
  ISLAND_R, PLAZA_R, SKY, fbm, hash, distToPaths, inWater, coastRadius, type Blocker, type Lagoon, type PathDef,
} from './world';
import { createPost } from './post';
import { makeSticker, stickOnPrism } from './stickers';

// ---------------------------------------------------------------- Renderer & Szene

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY.fog, 60, 240);
scene.background = new THREE.Color('#000000');
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);
const post = createPost(renderer, scene, camera);

const sky = createSky();
scene.add(sky);
const sea = createSea();
scene.add(sea);
const mask = new RevealMask();
scene.add(createDrawingPad(mask));

// Licht: tiefe Abendsonne + violettes Himmelslicht. Der Schattenbereich wandert mit dem Fokus mit.
scene.add(new THREE.HemisphereLight('#f4cdbd', '#5b4a72', 1.35));
const sun = new THREE.DirectionalLight('#ffbf8f', 3.0);
const SUN_OFF = new THREE.Vector3(-26, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#9a7cff', 0.55);
rim.position.set(20, 10, -25);
scene.add(rim);

// ---------------------------------------------------------------- Layout

const front = (x: number, z: number, ry: number, d: number): [number, number] => [x + Math.sin(ry) * d, z + Math.cos(ry) * d];
const ponds: Lagoon[] = [
  { x: 17, z: 15, r: 3.4, stretch: 3.8, bend: 3.2 },
  { x: -27, z: 21, r: 5.5, stretch: 2.35, bend: -4.2 },
  { x: 27, z: -17, r: 4.7, stretch: 2.7, bend: 3.8 },
];

interface Def { id: string; label?: string; make: () => THREE.Group; x: number; z: number; ry?: number; col: number }
const defs: Def[] = [];
const paths: PathDef[] = [
  { pts: [[0, 0], [0.5, -14], [1, -29]], w: 1.6 },
  { pts: [[0, 0], [0, 9], [0.5, 15]], w: 1.6 },
  { pts: [[0, 0], [7, 6], [10, 11], [13, 15]], w: 1.4 },
  { pts: [[0, 0], [-10, 1], [-19, 14], [-22, 21]], w: 1.4 },
  { pts: [[21, 15], [26, 14], [28, 7], [25, 0], [19, -5], [10, -8]], w: 1.25 },
  { pts: [[1, -29], [-4, -30], [-8, -31]], w: 1.1 },
  { pts: [[1, -29], [6, -30], [10.5, -30]], w: 1.1 },
];

// Häuserring direkt um den Dorfplatz, Lücken für die vier Straßen (Winkel a = atan2(x, z)).
// Jedes Haus schaut zum Brunnen – hier sollen später die Werkzeuge hängen (umfärben, Sticker, Prompt).
const RING_R = PLAZA_R + 1.95;
const RING = [
  { a: 0.43, wall: '#f3dcb2', roof: '#c4493a', w: 3.0, label: 'Torhaus Ost' },
  { a: 1.36, wall: '#efd2a8', roof: '#3f7f86', w: 3.4, label: 'Blaues Haus' },
  { a: 1.98, wall: '#f6e2c4', roof: '#9b4f5f', w: 3.0, d: 2.7, h: 1.9, label: 'Rosenhaus' },
  { a: 2.6, wall: '#f4dcc0', roof: '#d39a3a', w: 3.3, label: 'Senfhaus' },
  { a: 3.62, wall: '#eed7b8', roof: '#5d7f4a', w: 3.3, label: 'Kräuterhaus' },
  { a: 4.3, wall: '#f6e2c4', roof: '#b85a3c', w: 3.2, h: 2.3, label: 'Rathaus' },
  { a: -1.0, wall: '#f0d8b6', roof: '#6a5a9a', w: 3.2, label: 'Fliederhaus' },
  { a: -0.42, wall: '#f3dcb2', roof: '#c26a3a', w: 3.0, label: 'Torhaus West' },
];
const houses: { x: number; z: number; ry: number; wall: string; roof: string; w?: number; d?: number; h?: number; label: string; door?: boolean }[] = [
  ...RING.map((h) => ({ ...h, x: Math.sin(h.a) * RING_R, z: Math.cos(h.a) * RING_R, ry: h.a + Math.PI })),
  { x: -5, z: -16, ry: 0.15, wall: '#efd6b0', roof: '#b85a3c', w: 3.2, label: 'Bäckerei', door: true },
  { x: 7.5, z: -18, ry: -0.25, wall: '#f6e2c4', roof: '#4f7f8a', w: 2.9, d: 2.6, h: 1.9, label: 'Fischerhaus', door: true },
];
houses.forEach((h, i) => {
  defs.push({ id: 'house' + i, label: h.label, make: () => P.cottage(h), x: h.x, z: h.z, ry: h.ry, col: 2.9 });
  if (!h.door) return;
  // Hausweg: von der Tür zum nächsten Punkt auf einer Hauptstraße
  const [fx, fz] = front(h.x, h.z, h.ry, 2.8);
  let best: [number, number] = [0, 0], bd = Infinity;
  for (const road of paths.slice(0, 4)) for (let s = 0; s < road.pts.length - 1; s++) {
    const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
    const t = THREE.MathUtils.clamp(((fx - ax) * (bx - ax) + (fz - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2), 0, 1);
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, d = Math.hypot(fx - px, fz - pz);
    if (d < bd && Math.hypot(px, pz) > 3.5) { bd = d; best = [px, pz]; }
  }
  const [dx, dz] = front(h.x, h.z, h.ry, 3.8);
  paths.push({ pts: [best, [(best[0] + dx) / 2, (best[1] + dz) / 2], [dx, dz], [fx, fz]], w: 1.1 });
});

const add = (d: Def) => defs.push(d);
add({ id: 'well', label: 'Brunnen', make: P.well, x: 0, z: 0, col: 1.3 });
add({ id: 'windmill', label: 'Windmühle', make: P.windmill, x: 1.5, z: -33, col: 2.0 });
add({ id: 'stall', label: 'Marktstand', make: P.stall, x: -12, z: -3.2, ry: 1.75, col: 1.9 });
add({ id: 'campfire', label: 'Lagerfeuer', make: P.campfire, x: 5.2, z: 10, ry: 0.2, col: 1.4 });
add({ id: 'garden1', label: 'Kürbisbeet', make: P.garden, x: -9, z: -35, ry: 0.15, col: 3.4 });
add({ id: 'garden2', label: 'Gemüsegarten', make: P.garden, x: 12, z: -35, ry: -0.15, col: 3.4 });
add({ id: 'hay1', make: P.hay, x: -3, z: -40, ry: 0.4, col: 1.6 });
add({ id: 'hay2', make: P.hay, x: 6.5, z: -40, ry: -0.6, col: 1.6 });
add({ id: 'crates', make: P.crates, x: -13.6, z: -0.6, ry: 0.4, col: 1.1 });
add({ id: 'mailbox', make: P.mailbox, x: -3.1, z: -4.75, ry: Math.atan2(-3.1, -4.75) + Math.PI, col: 0.3 });
add({ id: 'sign', make: P.signpost, x: 1.9, z: 9.8, col: 0.3 });
add({ id: 'bench1', make: P.bench, x: -3.6, z: 1.9, ry: Math.atan2(-3.6, 1.9) + Math.PI, col: 0.9 });
add({ id: 'bench2', make: P.bench, x: 10.5, z: 12.6, ry: -2.4, col: 0.9 });
add({ id: 'bench3', make: P.bench, x: -18.5, z: 22.8, ry: 2.3, col: 0.9 });
add({ id: 'plazaBench', make: P.bench, x: 3.7, z: -1.3, ry: -1.24, col: 1 });
add({ id: 'millBench', make: P.bench, x: -1.5, z: -26, ry: 1.3, col: 1 });
const dock = (id: string, x: number, z: number, p: Blocker) => add({ id, label: 'Steg', make: P.dock, x, z, ry: Math.atan2(-(p.x - x), -(p.z - z)), col: 0 });
add({ id: 'bridge', make: P.footbridge, x: 17, z: 15, col: 0 });
dock('dock1', 27, -3.9, ponds[2]);
dock('dock2', -21.4, 21, ponds[1]);
[
  // Laternen am Platzrand, dort wo die Häuser stehen (nicht in den Straßeneinfahrten)
  ...[0.43, 1.67, 2.3, 3.95, -1.0, -0.42].map((a) => [Math.sin(a) * 4.9, Math.cos(a) * 4.9]),
  [-1.5, 11.5], [1.5, -10.5], [-0.8, -22], [-9.5, 3.2], [-15, 10.5], [10, 9.4], [1.8, -27],
].forEach(([x, z], i) =>
  add({ id: 'lantern' + i, make: P.lantern, x, z, col: 0.3 }));

// "SKETCH TO CAD" am Dorfrand im Süden: im Querformat eine Zeile, im Hochformat (Handy, iPad hochkant)
// zwei Zeilen – die obere steht etwas dahinter auf einem hohen Steinsockel, damit beide lesbar bleiben
const ASPECT0 = innerWidth > 0 && innerHeight > 0 ? innerWidth / innerHeight : 16 / 9;
const PORTRAIT0 = ASPECT0 < 0.8;
const LZ = 19, step = 2.05, LETTER_W = 5.6 * 0.34, LETTER_H = 7 * 0.34;
const ROWS = PORTRAIT0
  ? [{ text: 'SKETCH', z: LZ - 0.7, lift: 3.25 }, { text: 'TO CAD', z: LZ, lift: 0.55 }]
  : [{ text: 'SKETCH TO CAD', z: LZ, lift: 0.55 }];
let letterN = 0;
ROWS.forEach((row) => {
  const w = (row.text.length - 1) * step;
  [...row.text].forEach((ch, i) => {
    if (ch === ' ') return;
    add({ id: 'L' + letterN++, make: () => P.letter(ch, 0.34, row.lift), x: i * step - w / 2, z: row.z, ry: 0, col: 0.9 });
  });
});
// Umriss des Schriftzugs fürs Kamera-Framing
const SIGN_BOX = {
  hw: Math.max(...ROWS.map((r) => (r.text.length - 1) * step + LETTER_W)) / 2,
  y0: Math.min(...ROWS.map((r) => r.lift)),
  y1: Math.max(...ROWS.map((r) => r.lift + LETTER_H)),
};
const SIGN_CY = (SIGN_BOX.y0 + SIGN_BOX.y1) / 2;
/** Abstand der Kamera vor dem Schriftzug, damit er bei Seitenverhältnis `aspect` komplett ins Bild passt. */
function signDist(aspect: number, fovDeg: number) {
  const tv = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  return Math.max(17, (SIGN_BOX.hw + 1.1) / (tv * aspect), ((SIGN_BOX.y1 - SIGN_BOX.y0) / 2 + 1.2) / tv);
}
/** Vertikaler FOV, der mindestens `minH` Grad horizontal zeigt (Hochformat sonst Tunnelblick). */
function fovFor(aspect: number, baseV: number, minH: number, maxV: number) {
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minH) / 2) / aspect));
  return THREE.MathUtils.clamp(v, baseV, maxV);
}

// Wald & Bäume per Noise – Kiefern eher im Nordwesten, sonst Herbstlaub
const blockFor = (r: number) => defs.filter((d) => d.col > 0).map((d) => ({ x: d.x, z: d.z, r: d.col + r }));
const coreBlock = blockFor(1.6);
const treeSpots: [number, number][] = [];
// Blickfeld auf den Schriftzug und die Flugbahn ins Dorf bleiben baumfrei
const SIGN_EYE = { x: 0, z: Math.min(LZ + signDist(ASPECT0, fovFor(ASPECT0, 58, 0, 70)), 50) };
const inSignView = (x: number, z: number) =>
  (z > 13 && z < SIGN_EYE.z + 3 && Math.abs(x) < 3 + 15 * THREE.MathUtils.clamp((SIGN_EYE.z + 2 - z) / (SIGN_EYE.z + 2 - 15), 0, 1)) ||
  (Math.abs(x) < 3.6 && z > 3 && z < SIGN_EYE.z + 3);
for (let i = 0; i < 9000 && treeSpots.length < 230; i++) {
  const a = hash(i, 11) * Math.PI * 2, r = 6 + Math.sqrt(hash(i, 13)) * (ISLAND_R - 9);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const dens = fbm(x * 0.045 + 3, z * 0.045 - 8) + (r > 22 ? 0.12 : -0.08);
  if (dens < 0.56) continue;
  if (inWater(x, z, ponds, 2.5) || distToPaths(x, z, paths) < 1.8 || inSignView(x, z)) continue;
  if (coreBlock.some((b) => Math.hypot(x - b.x, z - b.z) < b.r)) continue;
  if (treeSpots.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 2.75)) continue;
  treeSpots.push([x, z]);
}
treeSpots.forEach(([x, z], i) => {
  const pine = fbm(x * 0.03 - 20, z * 0.03 + 4) + (x < 0 && z < 0 ? 0.15 : -0.05) > 0.55;
  add({ id: 'tree' + i, make: () => (pine ? P.pine(i + 1) : P.autumnTree(i + 1, i % 8 === 0 || fbm(x * 0.09, z * 0.09) > 0.64)), x, z, ry: i * 1.3, col: 0.8 });
});

// ---------------------------------------------------------------- Welt

const blockers = blockFor(0.4);
const island = createIsland(paths, ponds, blockers, mask);
scene.add(island.group);
// Unter dem Schriftzug wächst Gras, damit nach dem Auflösen keine kahlen Stellen bleiben
const grass = createGrass(paths, ponds, defs.filter((d) => d.col > 0 && !/^L\d+$/.test(d.id)).map((d) => ({ x: d.x, z: d.z, r: d.col + 0.4 })), mask);
scene.add(grass);
const fireflies = createFireflies(mask);
scene.add(fireflies);
const leaves = new Leaves();
scene.add(leaves.mesh);

const sparks = new Sparks();
scene.add(sparks.points);
const sfx = new Sfx();
const gen = new Generator(scene, sfx, sparks);

const objs: SketchObj[] = defs.map((d) => {
  const group = P.bake(d.make());
  group.position.set(d.x, 0, d.z);
  group.rotation.y = d.ry ?? 0;
  scene.add(group);
  const o: SketchObj = { id: d.id, label: d.label, group, center: new THREE.Vector3(d.x, 0, d.z), state: 'hidden', u: makeRevealUniforms(0), minY: 0, maxY: 1 };
  gen.register(o);
  return o;
});

const fireObj = objs.find((o) => o.id === 'campfire')!;
const fireLight = new THREE.PointLight('#ff8a3a', 0, 11, 1.6);
fireLight.position.set(fireObj.center.x, 1.1, fireObj.center.z);
scene.add(fireLight);

gen.onDone = (o) => {
  if (o.group.userData.crown) leaves.sources.push(o.group.localToWorld(o.group.userData.crown.clone()));
};

// ---------------------------------------------------------------- Intro-Regie
//
// 1  Schwarzes Nichts → magischer Pinsel malt den Brunnen → Pinsel tippt hinein
// 2  Eine Welle läuft vom Brunnen nach außen und erschafft die Welt, die Kamera zoomt selbst heraus.
//    Zum Ende hin wird sie immer schneller – WUMM – der letzte schwarze Rest verpufft auf einen Schlag.
// 3  Kameraflug hinunter in die Ich-Perspektive vor den Schriftzug SKETCH TO CAD
// 4  Der Schriftzug wird rückwärts zur Skizze und zerstiebt zu Feenstaub
// 5  Flug durch die Lücke ins Dorf, Landung auf dem Platz am Brunnen → frei herumlaufen

const well = objs.find((o) => o.id === 'well')!;
// Sticker auf dem Brunnensockel (10-Eck, r 1.0→1.08, h 0.9): Base44 links, Einhorn rechts der Kante,
// die genau nach Süden (+z) zeigt – also mittig im Blick bei der Landung auf dem Dorfplatz
const stickers = [
  stickOnPrism(makeSticker('/stickers/base44.png', 0.48), -1, 10, 1.0, 1.08, 0.9, 0.47, 0.055),
  stickOnPrism(makeSticker('/stickers/unicorn.svg', 0.48), 0, 10, 1.0, 1.08, 0.9, 0.47, -0.055),
  // Greg (Meme-Krokodil) eine Fläche weiter links neben Base44
  stickOnPrism(makeSticker('/stickers/greg.png', 0.5), -2, 10, 1.0, 1.08, 0.9, 0.47),
  // Patrick rechts neben dem Einhorn (Bild hat schon einen eigenen weißen Sticker-Rand)
  stickOnPrism(makeSticker('/stickers/patrick.png', 0.52, false), 1, 10, 1.0, 1.08, 0.9, 0.47),
];
stickers.forEach((m) => scene.add(m)); // Brunnen steht im Ursprung
let stickerT = -1;
const letters = objs.filter((o) => /^L\d+$/.test(o.id));
const HERO = { sketch: 3.4, solid0: 3.1, solid: 1.5, fade0: 3.5, fade: 1.0 };
const T_IN0 = 0.5, T_DRAW = 1.7, T_SKETCHED = T_DRAW + HERO.sketch, T_WELL = T_DRAW + HERO.fade0 + HERO.fade;
const T_TAP = T_WELL + 0.15, T_BURST = T_TAP + 0.4;
const WAVE_DUR = 9.5, R_A = 44;                       // Welle beschleunigt bis R_A, dann Wumm
const T_WUMM = T_BURST + WAVE_DUR;
const T_FLY1 = T_WUMM + 1.15, FLY1_DUR = 4.6, T_SIGN = T_FLY1 + FLY1_DUR;
const T_DISSOLVE = T_SIGN + 1.0, T_FLY2 = T_DISSOLVE + 1.3, FLY2_DUR = 4.4, T_FP = T_FLY2 + FLY2_DUR;
const CAM0 = { dist: 6.8, pitch: 0.36, y: 1.4 }, CAM1 = { dist: 102, pitch: 0.92, y: 0 };
const EYE = 1.65, HOLD_DRIFT = 0.22;
let FOV_FP = 58, FOV_SIGN = 58;

const brush = new MagicBrush();
scene.add(brush.group);
const trail = new Sparks('#ffe3b0');
scene.add(trail.points);
const ring = createWaveRing();
scene.add(ring);
const ringU = (ring.material as THREE.ShaderMaterial).uniforms;
const postU = post.finish.uniforms;
const skyU = (sky.material as THREE.ShaderMaterial).uniforms;
const seaU = (sea.material as THREE.ShaderMaterial).uniforms;

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
const clamp01 = (k: number) => THREE.MathUtils.clamp(k, 0, 1);
const easeInOutSine = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(k));
const easeInOutCubic = (k: number) => { k = clamp01(k); return k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; };
const easeInOutQuint = (k: number) => { k = clamp01(k); return k < 0.5 ? 16 * k ** 5 : 1 - (-2 * k + 2) ** 5 / 2; };
const smoother = (k: number) => { k = clamp01(k); return k * k * k * (k * (k * 6 - 15) + 10); };
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const bez3 = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number) => {
  const u = 1 - t;
  return V3(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
};
const dirA = V3(0, 0, 0), dirB = V3(0, 0, 0);
const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) =>
  a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(c, t * t);

/** Radius der Welle: sanfter Start, dann immer schneller, nach R_A explodiert sie förmlich. */
function waveAt(tw: number) {
  if (tw <= 0) return 0;
  if (tw <= WAVE_DUR) { const k = tw / WAVE_DUR; return R_A * (easeInOutSine(k) * 0.6 + k ** 4 * 0.4); }
  const s = tw - WAVE_DUR;
  return Math.min(3000, R_A + (R_A * 1.6 / WAVE_DUR) * s + 190 * s * s);
}

// Kamera-Stationen
// Halte-Position vor dem Schriftzug hängt vom Seitenverhältnis ab (wird in resize() neu berechnet)
// Zweizeilig: Kamera tiefer und leicht nach oben blickend, damit die obere Zeile vor dem Himmel steht
const SIGN_LOOK = PORTRAIT0 ? V3(0, SIGN_CY + 0.9, LZ - 1.5) : V3(0, SIGN_CY - 0.2, LZ - 1.5);
const SIGN_POS = V3(0, SIGN_CY + 1.95, 36), SIGN_END = V3(0, 0, 0);
const PLAZA_POS = V3(0, EYE, 5.0), PLAZA_LOOK = V3(0, 1.15, 0);
let fly2 = new THREE.CatmullRomCurve3([SIGN_POS]);
function placeSignCam(aspect: number) {
  // nicht weiter zurück als die baumfreie Schneise reicht
  const d = Math.min(signDist(aspect, FOV_SIGN), SIGN_EYE.z - LZ);
  SIGN_POS.set(0, PORTRAIT0 ? 2.5 : SIGN_CY + 1.95 + Math.max(0, d - 17) * 0.06, LZ + d);
  SIGN_END.copy(SIGN_POS).add(V3(0, 0, -HOLD_DRIFT * (T_FLY2 - T_SIGN)));
  const mid = Math.min(27, SIGN_END.z - 4);
  fly2 = new THREE.CatmullRomCurve3([SIGN_END, V3(0, 3.1, mid), V3(0, 2.4, LZ), V3(0, 1.95, 11), PLAZA_POS], false, 'centripetal');
}

// ---------------------------------------------------------------- Ich-Perspektive (nach dem Intro)

const fp = { pos: V3(0, EYE, 5), yaw: 0, pitch: 0, yawT: 0, pitchT: 0, bob: 0 };
let free = false;
let dragging = false;
const last = new THREE.Vector2();
const gesture = () => { sfx.init(); sfx.resume(); };

canvas.addEventListener('pointerdown', (e) => {
  gesture();
  if (!free) return;
  dragging = true;
  last.set(e.clientX, e.clientY);
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('grabbing');
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  last.set(e.clientX, e.clientY);
  // Umsehen per Ziehen: Welt folgt dem Cursor
  fp.yawT += dx * 0.0042;
  fp.pitchT = THREE.MathUtils.clamp(fp.pitchT + dy * 0.0036, -1.15, 1.15);
});
const endDrag = () => { dragging = false; document.body.classList.remove('grabbing'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Touch-Joystick (Handy/iPad): links unten zum Laufen, Ziehen auf der restlichen Fläche zum Umsehen
const joy = { x: 0, y: 0, el: null as HTMLDivElement | null };
const touchUI = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
function showJoystick() {
  if (!touchUI || joy.el) return;
  const base = document.createElement('div');
  base.className = 'joy';
  base.innerHTML = '<div class="joy-knob"></div>';
  document.body.appendChild(base);
  joy.el = base;
  requestAnimationFrame(() => base.classList.add('on'));
  const knob = base.firstElementChild as HTMLDivElement;
  let id = -1;
  const move = (e: PointerEvent) => {
    const r = base.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy), max = R * 0.62;
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = dx / max; joy.y = dy / max;
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1; joy.x = joy.y = 0;
    knob.style.transform = '';
    base.classList.remove('active');
  };
  base.addEventListener('pointerdown', (e) => {
    gesture();
    id = e.pointerId;
    base.setPointerCapture(id);
    base.classList.add('active');
    move(e);
  });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  gesture();
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'm' && !e.repeat) sfx.toggle();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Kollision: einfache Kreise je Objekt
const colliders = defs.map((d, i) => ({
  o: objs[i], x: d.x, z: d.z,
  r: d.id.startsWith('house') ? 2.25 : d.id === 'well' ? 1.4 : d.id.startsWith('tree') ? 0.55 : d.col > 0 ? Math.max(0.3, d.col * 0.6) : 0,
})).filter((c) => c.r > 0);
function walkable(x: number, z: number) {
  if (Math.hypot(x, z) > coastRadius(Math.atan2(z, x)) - 2.5) return false;
  return !inWater(x, z, ponds, 0.3);
}
function moveFp(dx: number, dz: number) {
  let nx = fp.pos.x + dx, nz = fp.pos.z + dz;
  for (const c of colliders) {
    if (c.o.state === 'gone') continue;
    const ex = nx - c.x, ez = nz - c.z, d = Math.hypot(ex, ez), min = c.r + 0.35;
    if (d < min && d > 1e-4) { nx = c.x + (ex / d) * min; nz = c.z + (ez / d) * min; }
  }
  if (walkable(nx, nz)) { fp.pos.x = nx; fp.pos.z = nz; }
  else if (walkable(nx, fp.pos.z)) fp.pos.x = nx;
  else if (walkable(fp.pos.x, nz)) fp.pos.z = nz;
}

let time = 0, burst = false, twinkled = false, wummed = false, flew1 = false, dissolved = false, flew2 = false, waveR = 0;
let baseFov = 38;
function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), pr = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  post.setSize(w, h, pr);
  const a = w / h;
  camera.aspect = a;
  baseFov = a < 0.8 ? 52 : 38;
  FOV_FP = fovFor(a, 58, 62, 82);   // Hochformat: weiter, damit man im Dorf nicht durchs Schlüsselloch schaut
  FOV_SIGN = fovFor(a, 58, 0, 70);
  // Flug 2 nicht mitten im Flug umbauen
  if (!flew2) placeSignCam(a);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- Loop

const clock = new THREE.Timer();
const brushTarget = V3(0, 0, 0), penTip = V3(0, 0, 0), lastPen = V3(0, 1, 0);
const brushFrom = V3(5, 7, 3), brushTap = V3(0, 1.1, 0), brushHover = V3(0.2, 4.4, 0.4);
const focus = V3(0, CAM0.y, 0), look = V3(0, 0, 0), fly1From = V3(0, 0, 0), fly1Look = V3(0, 0, 0);
let dist = CAM0.dist, pitch = CAM0.pitch, yaw = 0.75, flash = 0;
let manual = false;

function frame(fixedDt?: number) {
  clock.update();
  const dt = fixedDt ?? Math.min(clock.getDelta(), 1 / 20);
  time += dt;
  const t = time;

  // ---------- Pinsel & Brunnen
  if (t >= T_IN0 && !twinkled) { twinkled = true; sfx.twinkle(); }
  if (t >= T_DRAW && well.state === 'hidden') gen.start(well, { timing: HERO, sequential: true, width: 3.2 });
  const firstPen = V3(0, 0.2, 1.1);
  if (t < T_DRAW) {
    const k = easeInOutSine((t - T_IN0) / (T_DRAW - T_IN0));
    brushTarget.copy(bez(brushFrom, V3(2.5, 1.5, 3.5), firstPen, k));
    brush.visible = smooth(T_IN0, T_IN0 + 0.5, t);
  } else if (t < T_SKETCHED) {
    if (gen.penTip(well, penTip)) lastPen.copy(penTip);
    brushTarget.copy(lastPen);
  } else if (t < T_TAP) {
    const k = easeInOutSine((t - T_SKETCHED) / 0.9);
    brushTarget.lerpVectors(lastPen, brushHover, k);
    brushTarget.y += Math.sin(t * 3) * 0.08 * k;
  } else if (t < T_BURST) {
    const k = (t - T_TAP) / (T_BURST - T_TAP);
    brushTarget.lerpVectors(brushHover, brushTap, k * k);
  } else {
    const k = clamp01((t - T_BURST) / 1.6);
    brushTarget.copy(bez(brushTap, V3(0, 6, 0), V3(-4, 14, -6), easeInOutSine(k)));
    brush.visible = 1 - smooth(0.4, 1, k);
  }
  const drawingHero = t >= T_DRAW && t < T_SKETCHED;
  if (brush.visible > 0.001 || t < T_BURST + 2) {
    brush.update(dt, t, brushTarget, camera, drawingHero ? 34 : t >= T_TAP && t < T_BURST ? 40 : 12);
    if (brush.visible > 0.05) trail.emit(brush.tip, drawingHero ? 3 : 2, 0.06, 0.35, 0.55 + brush.visible * 0.3);
  }

  // ---------- Welle
  if (t >= T_BURST && !burst) {
    burst = true;
    sfx.magic();
    sparks.emit(V3(0, 1.1, 0), 140, 0.6, 3.2, 1.6);
    trail.emit(V3(0, 1.2, 0), 120, 1.2, 2.5, 1.2);
  }
  const tw = t - T_BURST;
  if (t >= T_WUMM && !wummed) {
    // WUMM: der Rest der Dunkelheit verpufft auf einen Schlag
    wummed = true;
    sfx.boom(); sfx.magic(1.25);
    gen.maxStartsPerFrame = 10;
    flash = 0.5;
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * coastRadius(a);
      trail.emit(V3(Math.cos(a) * r, 0.4, Math.sin(a) * r), 1, 0.6, 3 + Math.random() * 4, 2.4);
    }
  }
  if (burst) waveR = waveAt(tw);
  if (burst && tw <= WAVE_DUR + 6) {
    if (tw <= WAVE_DUR + 2.5) mask.paint(0, 0, Math.min(waveR, 80), wummed ? dt * 2.5 : dt);
    let starts = 0;
    for (const o of objs) {
      if (o.state !== 'hidden' || Math.hypot(o.center.x, o.center.z) > waveR - 0.3) continue;
      if (!wummed && mask.sample(o.center.x, o.center.z) < 0.55) continue;
      gen.start(o);
      if (++starts >= gen.maxStartsPerFrame) break;
    }
    // Funken entlang der Front (nur über Land)
    const sz = 0.6 + dist * 0.035;
    for (let i = 0; i < (wummed ? 30 : 10); i++) {
      const a = Math.random() * Math.PI * 2;
      if (waveR > coastRadius(a) + 1) continue;
      trail.emit(V3(Math.cos(a) * waveR, 0.25, Math.sin(a) * waveR), 1, 0.4, 1.2 + dist * 0.02, sz);
    }
  }
  if (t > T_WUMM + 6) gen.maxStartsPerFrame = 3;
  const sw = tw - WAVE_DUR; // Zeit seit dem Wumm
  ringU.uR.value = waveR;
  ringU.uA.value = !burst ? 0 : sw < 0 ? smooth(0, 0.4, tw) * (0.8 + 0.6 * smooth(WAVE_DUR - 3, WAVE_DUR, tw))
    : 1.4 * (1 - smooth(0, 0.7, sw));
  ringU.uTime.value = t;
  gen.update(dt);
  if (drawingHero) sfx.drawing(0.8);

  // ---------- Schriftzug löst sich auf
  if (t >= T_DISSOLVE && !dissolved) {
    dissolved = true;
    sfx.twinkle(); sfx.magic(0.8);
    flash = Math.max(flash, 0.18);
    letters.forEach((o, i) => {
      gen.dissolve(o, i * 0.05, trail);
      trail.emit(o.center.clone().setY(1.4), 22, 0.7, 1.6, 1.1);
    });
  }

  // ---------- Kamera
  let fov = baseFov;
  if (t < T_FLY1) {
    // Orbit um den Brunnen, Zoom hängt an der Welle
    const kc = easeInOutSine(Math.min(1, waveR / R_A));
    dist = THREE.MathUtils.lerp(CAM0.dist + t * 0.12, CAM1.dist, kc);
    pitch = THREE.MathUtils.lerp(CAM0.pitch, CAM1.pitch, kc);
    focus.set(0, THREE.MathUtils.lerp(CAM0.y, CAM1.y, kc), 0);
    // Nach dem Wumm läuft die Drehung weich aus, damit die Kamera vor Flug 1 ruhig steht
    const ty = t < T_WUMM ? t : T_WUMM + 0.5 * (1 - Math.exp(-2 * (t - T_WUMM)));
    yaw = 0.75 - ty * 0.035;
    const off = V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    camera.position.copy(focus).add(off);
    look.copy(focus);
  } else if (t < T_SIGN) {
    // Flug 1: aus der Vogelperspektive hinunter vor den Schriftzug
    if (!flew1) { flew1 = true; fly1From.copy(camera.position); fly1Look.copy(look); sfx.whoosh(FLY1_DUR, 1); }
    const k = (t - T_FLY1) / FLY1_DUR;
    // Kubische Bézier, in y und z monoton: startet entlang der Blickrichtung (sanftes Hineingleiten),
    // biegt in einem weiten Bogen ab und landet waagerecht vor dem Schriftzug
    const ep = 0.5 * (easeInOutCubic(k) + easeInOutSine(k)), el = easeInOutSine(k);
    const c1 = fly1From.clone().addScaledVector(dirA.copy(fly1Look).sub(fly1From).normalize(), 18);
    c1.z = Math.max(c1.z, SIGN_POS.z + 12);
    const c2 = V3(SIGN_POS.x, SIGN_POS.y + 5, SIGN_POS.z + 12);
    camera.position.copy(bez3(fly1From, c1, c2, SIGN_POS, ep));
    // Blickrichtung (nicht Blickpunkt) drehen, damit die Kamera nicht kippt
    dirA.copy(fly1Look).sub(fly1From).normalize();
    dirB.copy(SIGN_LOOK).sub(SIGN_POS).normalize();
    look.copy(camera.position).add(dirA.lerp(dirB, el).normalize().multiplyScalar(10));
    fov = THREE.MathUtils.lerp(baseFov, FOV_SIGN, smoother(k));
  } else if (t < T_FLY2) {
    // Kurz stehen bleiben (ganz sanft weiterschweben)
    camera.position.copy(SIGN_POS).add(V3(0, 0, -HOLD_DRIFT * (t - T_SIGN)));
    look.copy(SIGN_LOOK);
    fov = FOV_SIGN;
  } else if (t < T_FP) {
    // Flug 2: durch den verschwundenen Schriftzug hinein auf den Dorfplatz
    if (!flew2) { flew2 = true; sfx.whoosh(FLY2_DUR * 0.9, 0.8); }
    const k = (t - T_FLY2) / FLY2_DUR;
    const e = easeInOutQuint(k * 0.92 + 0.08 * easeInOutSine(k));
    camera.position.copy(fly2.getPointAt(e));
    // Neigung als Winkel weich interpolieren: setzt exakt am Halte-Blick an (kein Nicken),
    // senkt sich nur leicht und endet genau im Dorfplatz-Blick
    const p0 = Math.atan2(SIGN_LOOK.y - SIGN_END.y, SIGN_END.z - SIGN_LOOK.z);
    const p1 = Math.atan2(PLAZA_LOOK.y - PLAZA_POS.y, PLAZA_POS.z - PLAZA_LOOK.z);
    const pt = THREE.MathUtils.lerp(p0, p1, smoother(k)) - 0.035 * Math.sin(Math.PI * k);
    look.copy(camera.position).add(V3(0, Math.sin(pt), -Math.cos(pt)).multiplyScalar(5));
    fov = THREE.MathUtils.lerp(FOV_SIGN, FOV_FP, smoother(k));
  } else {
    // Ich-Perspektive: WASD/Pfeile laufen, Ziehen zum Umsehen, Shift rennt
    if (!free) {
      free = true;
      fp.pos.copy(PLAZA_POS);
      const d = PLAZA_LOOK.clone().sub(PLAZA_POS);
      fp.yaw = fp.yawT = Math.atan2(-d.x, -d.z);
      fp.pitch = fp.pitchT = Math.atan2(d.y, Math.hypot(d.x, d.z));
      showJoystick();
    }
    let kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let kz = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const jm = Math.hypot(joy.x, joy.y);
    if (jm > 0.12) { kx += joy.x; kz -= joy.y; }
    // Joystick ganz ausgelenkt = rennen
    const speed = (keys.has('shift') || jm > 0.95 ? 7 : 3.4) * dt;
    if (kx || kz) {
      const n = Math.max(1, Math.hypot(kx, kz));
      const fx = -Math.sin(fp.yaw), fz = -Math.cos(fp.yaw), rx = Math.cos(fp.yaw), rz = -Math.sin(fp.yaw);
      moveFp(((fx * kz + rx * kx) / n) * speed, ((fz * kz + rz * kx) / n) * speed);
      fp.bob += speed * 2.6;
    }
    fp.yaw += (fp.yawT - fp.yaw) * (1 - Math.exp(-dt * 14));
    fp.pitch += (fp.pitchT - fp.pitch) * (1 - Math.exp(-dt * 14));
    camera.position.set(fp.pos.x, EYE + Math.sin(fp.bob) * 0.035, fp.pos.z);
    const cp = Math.cos(fp.pitch);
    look.set(fp.pos.x - Math.sin(fp.yaw) * cp * 10, camera.position.y + Math.sin(fp.pitch) * 10, fp.pos.z - Math.cos(fp.yaw) * cp * 10);
    fov = FOV_FP;
  }
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.lookAt(look);
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);

  // Schatten & Nebel wachsen mit der Kamerahöhe mit
  const H = Math.max(0, camera.position.y);
  const ext = THREE.MathUtils.clamp(H * 0.85 + 18, 18, 72);
  const sc = sun.shadow.camera;
  if (Math.abs(sc.right - ext) > 0.5) {
    Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, far: ext * 4 });
    sc.updateProjectionMatrix();
  }
  const fwd = V3(look.x - camera.position.x, 0, look.z - camera.position.z);
  const reach = Math.min(fwd.length(), ext * 0.55);
  const ground = V3(camera.position.x, 0, camera.position.z).addScaledVector(fwd.normalize(), reach);
  sun.position.copy(ground).addScaledVector(SUN_OFF, ext / 26);
  sun.target.position.copy(ground);
  const fog = scene.fog as THREE.Fog;
  fog.near = 28 + H * 1.15; fog.far = 170 + H * 2.4;
  postU.uBlur.value = 1 - 0.8 * smooth(T_FLY1, T_SIGN, t);

  // ---------- Leere schwarze Welt → Meer und Himmel kommen mit der Welle, beim Wumm ganz
  seaU.uWaveR.value = burst ? waveR : 0;
  skyU.uDay.value = !burst ? 0 : smooth(0.35, 1, tw / WAVE_DUR) * 0.5 + (wummed ? 0.5 * smooth(0, 0.5, sw) : 0);
  flash *= Math.exp(-dt * 4.5);
  postU.uFlash.value = flash;

  // ---------- Animationen
  if (well.state === 'done' && stickerT < 0) stickerT = 0;
  if (stickerT >= 0 && stickerT < 2) {
    stickerT += dt;
    stickers.forEach((m, i) => {
      const k = clamp01((stickerT - 0.25 - i * 0.18) / 0.45);
      m.visible = k > 0;
      m.scale.setScalar(Math.max(0.001, 1 + 0.25 * Math.sin(Math.PI * k) * (1 - k) - (1 - k) * (1 - k) * 0.9));
    });
  }
  for (const o of objs) {
    if (o.state === 'hidden' || o.state === 'gone') continue;
    if (o.group.userData.spin) o.group.userData.spin.rotation.z -= dt * 0.6;
    if (o.group.userData.flames) (o.group.userData.flames as THREE.Mesh[]).forEach((f, i) => {
      f.scale.set(1 + Math.sin(t * 9 + i * 2) * 0.12, 1 + Math.sin(t * 13 + i) * 0.22, 1 + Math.cos(t * 10 + i) * 0.12);
    });
  }
  fireLight.intensity = fireObj.state === 'done' ? 9 + Math.sin(t * 11) * 1.5 + Math.sin(t * 23) : 0;
  leaves.update(dt, t, ground);
  sparks.update(dt);
  trail.update(dt);
  seaU.uTime.value = t;
  island.waters.forEach((w) => (w.uniforms.uTime.value = t));
  (grass.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  (fireflies.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  postU.uTime.value = t;

  post.composer.render(dt);
  if (fixedDt === undefined && !manual) requestAnimationFrame(() => frame());
}
sfx.init();
requestAnimationFrame(() => frame());

// fürs Debuggen in der Konsole
Object.assign(window, {
  village: {
    objs, gen, mask, fp,
    get time() { return time; },
    marks: { T_BURST, T_WUMM, T_FLY1, T_SIGN, T_DISSOLVE, T_FLY2, T_FP },
    /** Simulation manuell vorspulen (für Screenshots in gedrosselten Tabs). */
    step: (seconds: number, fps = 30) => { manual = true; for (let i = 0; i < seconds * fps; i++) frame(1 / fps); },
    resume: () => { if (manual) { manual = false; requestAnimationFrame(() => frame()); } },
  },
});
