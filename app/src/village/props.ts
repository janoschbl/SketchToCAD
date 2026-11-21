import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PAL = {
  wood: '#995e3c',
  woodDark: '#503d48',
  woodLight: '#d89a61',
  stone: '#baa49b',
  stoneDark: '#827989',
  cream: '#f2dcb8',
  glass: '#ffd796',
  glassGlow: '#ffa645',
  pumpkin: '#e8772a',
  leafA: '#e8823a',
  leafB: '#f2b23c',
  leafC: '#c94e59',
  leafD: '#b7b84a',
  pine: '#35685e',
  pine2: '#567f58',
  hay: '#e2b553',
  red: '#c8433a',
  letter: '#f08b70',
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
export function M(color: string, emissive?: string, ei = 0) {
  const k = `${color}|${emissive ?? ''}|${ei}`;
  let m = cache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, emissive: emissive ?? '#000000', emissiveIntensity: ei });
    cache.set(k, m);
  }
  return m;
}
// Fenster: sanft warmes Glimmen statt greller Lichtflächen
const GLOW = () => M(PAL.glass, PAL.glassGlow, 1.05);

function add(p: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  p.add(m);
  return m;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

/** Satteldach aus zwei Platten + Giebelprisma. */
function gableRoof(g: THREE.Group, w: number, d: number, top: number, rh: number, wallMat: THREE.Material, roofMat: THREE.Material, over = 0.35) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, rh); shape.closePath();
  const pg = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  pg.translate(0, 0, -d / 2);
  add(g, pg, wallMat, 0, top, 0);
  const S = Math.hypot(w / 2, rh);
  const slope = Math.atan2(rh, w / 2);
  const L = S + over;
  for (const side of [1, -1]) {
    const dir = new THREE.Vector2(side * (w / 2) / S, -rh / S);
    const nrm = new THREE.Vector2(side * rh / S, (w / 2) / S);
    const cx = dir.x * (L / 2) + nrm.x * 0.08;
    const cy = top + rh + dir.y * (L / 2) + nrm.y * 0.08;
    add(g, B(L, 0.16, d + 0.6), roofMat, cx, cy, 0, 0, 0, -side * slope);
  }
  add(g, B(0.24, 0.24, d + 0.7), M(PAL.woodDark), 0, top + rh + 0.12, 0);
}

function windowFront(g: THREE.Group, x: number, y: number, z: number) {
  add(g, B(0.6, 0.6, 0.08), GLOW(), x, y, z);
  const w = M(PAL.woodDark);
  add(g, B(0.68, 0.08, 0.12), w, x, y, z + 0.01);
  add(g, B(0.08, 0.68, 0.12), w, x, y, z + 0.01);
  add(g, B(0.8, 0.1, 0.22), w, x, y - 0.36, z + 0.05);
  // Blumenkasten
  add(g, B(0.7, 0.16, 0.2), M(PAL.woodLight), x, y - 0.5, z + 0.12);
  const cols = ['#f08aa0', '#fff0c8', '#ff7f5a'];
  for (let i = 0; i < 3; i++) add(g, new THREE.IcosahedronGeometry(0.1, 0), M(cols[i]), x - 0.22 + i * 0.22, y - 0.36, z + 0.14);
}

export function cottage(o: { wall: string; roof: string; w?: number; d?: number; h?: number }) {
  const g = new THREE.Group();
  const w = o.w ?? 3.6, d = o.d ?? 3, h = o.h ?? 2.1;
  const wall = M(o.wall), roof = M(o.roof), wood = M(PAL.woodDark);
  add(g, B(w + 0.4, 0.35, d + 0.4), M(PAL.stone), 0, 0.175, 0);
  add(g, B(w, h, d), wall, 0, 0.35 + h / 2, 0);
  const top = 0.35 + h;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, B(0.2, h, 0.2), wood, sx * w / 2, 0.35 + h / 2, sz * d / 2);
  add(g, B(w + 0.1, 0.18, 0.2), wood, 0, top - 0.05, d / 2);
  add(g, B(w + 0.1, 0.18, 0.2), wood, 0, top - 0.05, -d / 2);
  const rh = w * 0.42;
  gableRoof(g, w, d, top, rh, wall, roof);
  // Kamin
  add(g, B(0.5, 1.3, 0.5), M(PAL.stoneDark), w * 0.24, top + rh * 0.62, -d * 0.22);
  add(g, B(0.62, 0.12, 0.62), M(PAL.stone), w * 0.24, top + rh * 0.62 + 0.68, -d * 0.22);
  // Tür
  add(g, B(0.78, 1.3, 0.1), M(PAL.wood), 0, 0.35 + 0.65, d / 2 + 0.05);
  add(g, B(0.9, 0.12, 0.14), wood, 0, 0.35 + 1.36, d / 2 + 0.06);
  add(g, new THREE.SphereGeometry(0.05, 6, 4), M('#e0b04a'), 0.25, 0.35 + 0.62, d / 2 + 0.13);
  add(g, B(1.1, 0.14, 0.55), M(PAL.stone), 0, 0.07, d / 2 + 0.45);
  // Fenster
  if (w > 3) { windowFront(g, -w * 0.3, 0.35 + h * 0.58, d / 2 + 0.04); windowFront(g, w * 0.3, 0.35 + h * 0.58, d / 2 + 0.04); }
  else windowFront(g, w * 0.3, 0.35 + h * 0.58, d / 2 + 0.04);
  for (const sx of [-1, 1]) add(g, B(0.08, 0.6, 0.6), GLOW(), sx * (w / 2 + 0.03), 0.35 + h * 0.58, 0);
  for (const sx of [-1, 1]) add(g, B(0.24, 0.73, 0.10), M(o.roof), w * 0.3 + sx * 0.45, 0.35 + h * 0.58, d / 2 + 0.07);
  const round = add(g, C(0.26, 0.26, 0.08, 12), GLOW(), 0, top + rh * 0.38, d / 2 + 0.03, Math.PI / 2);
  round.castShadow = false;
  return g;
}

export function windmill() {
  const g = new THREE.Group();
  add(g, C(1.75, 1.85, 0.5, 8), M(PAL.stone), 0, 0.25, 0);
  add(g, C(1.05, 1.5, 5.5, 8), M('#ecd6b2'), 0, 0.5 + 2.75, 0);
  add(g, C(1.32, 1.32, 0.16, 8), M(PAL.woodDark), 0, 2.4, 0);
  add(g, new THREE.ConeGeometry(1.4, 1.7, 8), M('#b4473a'), 0, 6.0 + 0.85, 0);
  add(g, B(0.75, 1.25, 0.14), M(PAL.wood), 0, 1.12, 1.5, -0.08);
  add(g, B(0.45, 0.5, 0.1), GLOW(), 0, 3.9, 1.18, -0.08);
  add(g, C(0.22, 0.22, 0.7, 8), M(PAL.woodDark), 0, 5.4, 1.2, Math.PI / 2);
  const blades = new THREE.Group();
  blades.position.set(0, 5.4, 1.6);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = i * Math.PI / 2 + 0.3;
    add(arm, B(0.13, 3.2, 0.1), M(PAL.woodDark), 0, 1.6, 0);
    add(arm, B(0.8, 2.3, 0.05), M('#f6e8cc'), 0.46, 1.95, -0.02);
    add(arm, B(0.05, 2.3, 0.08), M(PAL.wood), 0.86, 1.95, 0);
    for (const y of [1.1, 1.8, 2.5]) add(arm, B(0.83, 0.055, 0.08), M(PAL.woodLight), 0.45, y, 0.03);
    blades.add(arm);
  }
  blades.userData.keep = true;
  g.add(blades);
  g.userData.spin = blades;
  return g;
}

export function well() {
  const g = new THREE.Group();
  add(g, C(1.0, 1.08, 0.9, 10), M(PAL.stone), 0, 0.45, 0);
  add(g, C(1.08, 1.08, 0.14, 10), M(PAL.stoneDark), 0, 0.92, 0);
  add(g, C(0.84, 0.84, 0.06, 10), M('#347d83'), 0, 1.0, 0).userData.noInk = true;
  for (const sx of [-1, 1]) add(g, B(0.16, 1.85, 0.16), M(PAL.wood), sx * 0.88, 0.9 + 0.92, 0);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    add(g, B(0.48, 0.18, 0.23), M(i % 3 ? PAL.stone : '#d2bda5'), Math.sin(a) * 0.96, 0.99, Math.cos(a) * 0.96, 0, a);
  }
  const roof = M('#aa5244');
  for (const side of [1, -1]) add(g, B(1.0, 0.1, 1.6), roof, side * 0.42, 2.95, 0, 0, 0, -side * 0.62);
  add(g, B(0.16, 0.16, 1.7), M(PAL.woodDark), 0, 3.24, 0);
  add(g, C(0.05, 0.05, 1.95, 6), M(PAL.woodDark), 0, 2.2, 0, 0, 0, Math.PI / 2);
  add(g, C(0.02, 0.02, 0.75, 4), M('#d6c3a0'), 0, 1.8, 0);
  add(g, C(0.2, 0.15, 0.3, 8), M(PAL.woodLight), 0, 1.3, 0);
  return g;
}

export function stall() {
  const g = new THREE.Group();
  add(g, B(3.0, 1.0, 1.2), M(PAL.woodLight), 0, 0.5, 0);
  add(g, B(3.15, 0.1, 1.35), M(PAL.wood), 0, 1.03, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, B(0.14, 2.5, 0.14), M(PAL.wood), sx * 1.42, 1.25, sz * 0.55);
  for (let i = 0; i < 6; i++) add(g, B(0.52, 0.08, 1.8), M(i % 2 ? '#f6e6c8' : '#d6503b'), -1.3 + i * 0.52, 2.55, 0.15, -0.28);
  for (let i = 0; i < 6; i++) add(g, B(0.52, 0.26, 0.04), M(i % 2 ? '#f6e6c8' : '#d6503b'), -1.3 + i * 0.52, 2.2, 1.02);
  add(g, B(0.7, 0.36, 0.5), M(PAL.wood), -0.8, 1.26, 0);
  for (let i = 0; i < 5; i++) add(g, new THREE.IcosahedronGeometry(0.1, 0), M('#d23d33'), -0.95 + (i % 3) * 0.15, 1.5, -0.1 + Math.floor(i / 3) * 0.2);
  for (let j = 0; j < 7; j++) add(g, B(0.32, 0.74, 0.06), M(j % 2 ? PAL.wood : PAL.woodLight), (j - 3) * 0.4, 0.5, 0.62);
  pumpkin(g, 0.4, 1.08, 0.15, 0.32);
  pumpkin(g, 0.95, 1.08, -0.1, 0.24);
  add(g, C(0.28, 0.32, 0.7, 10), M(PAL.wood), 1.9, 0.35, 0.5);
  return g;
}

function pumpkin(p: THREE.Object3D, x: number, y: number, z: number, r = 0.35) {
  const m = add(p, new THREE.SphereGeometry(r, 9, 6), M(PAL.pumpkin), x, y + r * 0.7, z);
  m.scale.y = 0.72;
  add(p, C(0.04, 0.06, 0.18, 5), M('#5c6b2c'), x, y + r * 1.35, z, 0.2);
}

export function lantern() {
  const g = new THREE.Group();
  for (const y of [0.4, 2.36]) add(g, B(0.22, 0.08, 0.22), M('#cc9d62'), 0, y, 0);
  add(g, B(0.42, 0.22, 0.42), M(PAL.stone), 0, 0.11, 0);
  add(g, B(0.16, 2.4, 0.16), M(PAL.woodDark), 0, 1.4, 0);
  add(g, B(0.46, 0.08, 0.46), M('#3a2a2a'), 0, 2.6, 0);
  add(g, B(0.32, 0.44, 0.32), M('#f2c98e', '#ff9a3c', 1.3), 0, 2.86, 0).castShadow = false;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, B(0.05, 0.46, 0.05), M('#3a2a2a'), sx * 0.18, 2.86, sz * 0.18);
  add(g, new THREE.ConeGeometry(0.38, 0.34, 4), M('#3a2a2a'), 0, 3.24, 0, 0, Math.PI / 4);
  return g;
}

export function autumnTree(seed: number, blossom = false) {
  const g = new THREE.Group();
  const r = (k: number) => { const x = Math.sin(seed * 91.7 + k * 13.1) * 43758.5; return x - Math.floor(x); };
  const h = 1.6 + r(1) * 0.9;
  add(g, C(0.16, 0.28, h, 6), M(PAL.wood), 0, h / 2, 0);
  const pal = blossom ? ['#da8197', '#e993a4', '#da748d', '#e9a5ac'] : ['#839b44', '#b0b748', PAL.leafA, '#719547'];
  const main = pal[Math.floor(r(2) * 4)];
  const s = 1.1 + r(3) * 0.5;
  const foliage = new THREE.IcosahedronGeometry(1, 1);
  const highlight = M(new THREE.Color(main).lerp(new THREE.Color(blossom ? '#ffdfd8' : '#ffdc83'), 0.24).getStyle());
  for (let i = 0; i < 6; i++) {
    const angle = i * 2.4 + r(4);
    const reach = (0.66 + r(i + 9) * 0.32) * s;
    const x = Math.cos(angle) * reach, z = Math.sin(angle) * reach;
    const y = h + (0.1 + i * 0.2) * s;
    const limb = add(g, C(0.08, 0.14, Math.hypot(reach, 0.85), 6), M(PAL.wood), x / 2, y - 0.425, z / 2);
    limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0.85, z).normalize());
    const lobe = add(g, foliage, i > 3 ? highlight : M(main), x, y, z, r(i), angle);
    lobe.scale.set(0.88 * s, (0.57 + r(i + 20) * 0.24) * s, 0.83 * s);
  }
  add(g, foliage, highlight, 0, h + 1.35 * s, 0).scale.set(s, s * 0.76, s);
  if (blossom) {
    const petals = M('#ffd3cf');
    for (let i = 0; i < 17; i++) {
      const angle = i * 2.4;
      const reach = (0.7 + r(i + 80) * 0.45) * s;
      const y = h + (0.6 + r(i + 52)) * s;
      add(g, new THREE.IcosahedronGeometry(0.22 * s, 0), petals, Math.cos(angle) * reach, y, Math.sin(angle) * reach).userData.noInk = true;
    }
  }
  g.userData.crown = new THREE.Vector3(0, h + 0.9 * s, 0);
  return g;
}

export function pine(seed: number) {
  const g = new THREE.Group();
  const s = 1 + (Math.sin(seed * 12.9) * 0.5 + 0.5) * 0.5;
  add(g, C(0.14, 0.2, 1, 6), M(PAL.wood), 0, 0.5, 0);
  add(g, new THREE.ConeGeometry(1.3 * s, 1.7 * s, 7), M(PAL.pine), 0, 1 + 0.75 * s, 0);
  add(g, new THREE.ConeGeometry(1.06 * s, 1.55 * s, 9), M(PAL.pine2), 0.08 * s, 1 + 1.6 * s, 0, 0, 0.4);
  add(g, new THREE.ConeGeometry(0.68 * s, 1.25 * s, 7), M('#779568'), 0.13 * s, 1 + 2.4 * s, 0, 0, 0.8);
  return g;
}

function fence(g: THREE.Group, ax: number, az: number, bx: number, bz: number) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 1.1));
  const ang = Math.atan2(bz - az, bx - ax);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(g, B(0.14, 0.95, 0.14), M(PAL.woodLight), ax + (bx - ax) * t, 0.47, az + (bz - az) * t);
  }
  for (const y of [0.4, 0.75]) add(g, B(len, 0.09, 0.07), M(PAL.wood), (ax + bx) / 2, y, (az + bz) / 2, 0, -ang);
}

export function garden() {
  const g = new THREE.Group();
  const W = 3.2, D = 2.3;
  fence(g, -W, -D, W, -D);
  fence(g, W, -D, W, D);
  fence(g, -W, D, -0.7, D);
  fence(g, 0.7, D, W, D);
  fence(g, -W, -D, -W, D);
  for (let i = 0; i < 3; i++) add(g, B(5.6, 0.12, 0.7), M('#7a4b33'), 0, 0.06, -1.3 + i * 1.3).userData.noInk = true;
  for (const z of [-1.72, -0.88, -0.42, 0.42, 0.88, 1.72]) add(g, B(5.65, 0.1, 0.09), M(PAL.woodLight), 0, 0.09, z);
  const pos = [[-2.2, -1.3], [-0.6, -1.3], [1.4, -1.2], [-1.6, 0], [0.4, 0.1], [2.2, 0], [-2.4, 1.3], [1.0, 1.3]];
  pos.forEach(([x, z], i) => pumpkin(g, x, 0.1, z, 0.28 + (i % 3) * 0.08));
  // Vogelscheuche
  add(g, B(0.12, 2.1, 0.12), M(PAL.wood), 2.3, 1.05, -1.6 + 0.9);
  add(g, B(1.4, 0.1, 0.1), M(PAL.wood), 2.3, 1.6, -0.7);
  add(g, B(0.6, 0.7, 0.3), M('#5d7fa3'), 2.3, 1.45, -0.7);
  add(g, new THREE.SphereGeometry(0.24, 8, 6), M('#e9c98a'), 2.3, 2.0, -0.7);
  add(g, C(0.45, 0.45, 0.05, 10), M(PAL.hay), 2.3, 2.17, -0.7);
  add(g, C(0.18, 0.24, 0.26, 10), M(PAL.hay), 2.3, 2.3, -0.7);
  return g;
}

export function campfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    add(g, new THREE.DodecahedronGeometry(0.2, 0), M(PAL.stoneDark), Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, a, a * 2);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(g, C(0.07, 0.09, 1.0, 6), M(PAL.woodDark), Math.cos(a) * 0.22, 0.4, Math.sin(a) * 0.22, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  add(g, C(0.74, 0.8, 0.05, 12), M('#4c4143'), 0, 0.03, 0);
  const flames: THREE.Mesh[] = [];
  const fcol: [string, string][] = [['#ff9a3a', '#ff6a1a'], ['#ffd36a', '#ffb02a'], ['#ff7a3a', '#ff4a1a']];
  fcol.forEach(([c, e], i) => {
    const f = add(g, new THREE.ConeGeometry(0.28 - i * 0.06, 0.9 - i * 0.15, 6), M(c, e, 2.2), (i - 1) * 0.1, 0.55, (i % 2) * 0.08);
    f.castShadow = false; f.userData.noInk = i > 0; f.userData.keep = true;
    flames.push(f);
  });
  for (const [x, z, ry] of [[-1.9, 0.2, 0.2], [1.9, -0.3, -0.3]] as const) add(g, C(0.28, 0.3, 1.5, 9), M(PAL.wood), x, 0.28, z, Math.PI / 2, ry, 0);
  g.userData.flames = flames;
  return g;
}

export function bench() {
  const g = new THREE.Group();
  for (const x of [-0.72, 0.72]) {
    add(g, B(0.14, 0.075, 0.58), M(PAL.woodLight), x, 0.74, 0);
    add(g, B(0.08, 0.22, 0.08), M(PAL.woodDark), x, 0.61, 0.2);
    add(g, B(0.24, 0.10, 0.58), M(PAL.stoneDark), x, 0.05, 0);
  }
  for (let i = 0; i < 3; i++) add(g, B(1.7, 0.07, 0.15), M(PAL.woodLight), 0, 0.5, -0.17 + i * 0.17);
  for (const sx of [-1, 1]) { add(g, B(0.1, 0.5, 0.45), M(PAL.woodDark), sx * 0.72, 0.25, 0); add(g, B(0.1, 0.55, 0.08), M(PAL.woodDark), sx * 0.72, 0.8, -0.24); }
  for (let i = 0; i < 2; i++) add(g, B(1.7, 0.12, 0.06), M(PAL.woodLight), 0, 0.75 + i * 0.22, -0.26);
  return g;
}

export function mailbox() {
  const g = new THREE.Group();
  add(g, B(0.12, 1.05, 0.12), M(PAL.wood), 0, 0.52, 0);
  add(g, B(0.38, 0.3, 0.58), M(PAL.red), 0, 1.15, 0);
  add(g, B(0.26, 0.055, 0.04), M(PAL.woodDark), 0, 1.2, 0.3);
  const top = add(g, new THREE.CylinderGeometry(0.19, 0.19, 0.58, 10, 1, false, 0, Math.PI), M(PAL.red), 0, 1.3, 0, 0, Math.PI / 2, Math.PI / 2);
  void top;
  add(g, B(0.04, 0.3, 0.06), M('#f2c94c'), 0.22, 1.35, 0.1);
  add(g, B(0.04, 0.08, 0.16), M('#f2c94c'), 0.22, 1.47, 0.16);
  return g;
}

export function hay() {
  const g = new THREE.Group();
  const m = M(PAL.hay);
  add(g, C(0.55, 0.55, 1.1, 10), m, -0.6, 0.55, 0, 0, 0, Math.PI / 2);
  add(g, C(0.55, 0.55, 1.1, 10), m, 0.6, 0.55, 0.1, 0, 0.1, Math.PI / 2);
  add(g, C(0.55, 0.55, 1.1, 10), m, 0, 1.5, 0.05, 0, -0.1, Math.PI / 2);
  for (const [x, y, z] of [[-0.6, 0.55, 0], [0.6, 0.55, 0.1], [0, 1.5, 0.05]]) {
    for (const dx of [-0.32, 0.32]) add(g, C(0.562, 0.562, 0.06, 10), M('#ae8449'), x + dx, y, z, 0, 0, Math.PI / 2);
  }
  add(g, B(0.9, 0.12, 0.12), M(PAL.woodDark), 1.3, 0.06, 0.9, 0, 0.6).userData.noInk = true;
  return g;
}

export function crates() {
  const g = new THREE.Group();
  const crate = (x: number, y: number, z: number, s: number, r: number) => {
    for (const dy of [0.12, 0.88]) add(g, B(s + 0.055, 0.085, s + 0.055), M(PAL.woodDark), x, y + s * dy, z, 0, r);
    add(g, B(s, s, s), M(PAL.woodLight), x, y + s / 2, z, 0, r);
    add(g, B(s + 0.04, 0.1, s + 0.04), M(PAL.wood), x, y + s * 0.5, z, 0, r);
  };
  crate(0, 0, 0, 0.8, 0.1); crate(0.85, 0, 0.15, 0.7, -0.2); crate(0.35, 0.8, 0.05, 0.6, 0.35);
  add(g, C(0.32, 0.36, 0.85, 10), M(PAL.wood), -0.85, 0.42, 0.3);
  add(g, C(0.37, 0.37, 0.06, 10), M('#3a2a2a'), -0.85, 0.62, 0.3);
  return g;
}

export function signpost() {
  const g = new THREE.Group();
  add(g, C(0.18, 0.23, 0.22, 6), M(PAL.stone), 0, 0.11, 0);
  add(g, B(0.14, 2.1, 0.14), M(PAL.wood), 0, 1.05, 0);
  add(g, B(1.2, 0.3, 0.07), M(PAL.woodLight), 0.4, 1.75, 0, 0, 0.3);
  add(g, B(1.0, 0.28, 0.07), M(PAL.woodLight), -0.35, 1.32, 0, 0, -0.45);
  add(g, new THREE.ConeGeometry(0.2, 0.25, 4), M(PAL.woodDark), 0, 2.2, 0, 0, Math.PI / 4);
  return g;
}

export function footbridge() {
  const g = new THREE.Group();
  const height = (x: number) => 0.14 + Math.max(0, 1 - (x / 4.1) ** 2) * 0.43;
  for (let i = -10; i <= 10; i++) {
    const x = i * 0.4;
    add(g, B(0.385, 0.12, 1.48), M(i % 3 ? PAL.woodLight : '#c28d61'), x, height(x), 0, 0, 0, -0.051 * x);
  }
  for (const z of [-0.69, 0.69]) {
    for (let x = -4; x <= 4; x += 2) {
      add(g, C(0.075, 0.1, height(x) + 0.78), M(PAL.woodDark), x, (height(x) + 0.78) / 2, z);
      if (x === 4) continue;
      const dy = height(x + 2) - height(x);
      add(g, B(Math.hypot(2, dy), 0.085, 0.095), M(PAL.woodLight), x + 1, height(x) + dy / 2 + 0.69, z, 0, 0, Math.atan2(dy, 2));
    }
  }
  return g;
}

export function dock() {
  const g = new THREE.Group();
  for (const x of [-0.68, 0.68]) add(g, B(0.11, 0.1, 2.5), M(PAL.woodLight), x, 0.57, -1.8);
  for (let i = 0; i < 9; i++) add(g, B(1.5, 0.09, 0.36), M(i % 3 ? PAL.woodLight : '#a8774b'), 0, 0.22, -i * 0.4, 0, (i % 2 - 0.5) * 0.04);
  for (const sx of [-1, 1]) for (const z of [-0.6, -3.0]) add(g, C(0.08, 0.08, 0.9, 6), M(PAL.woodDark), sx * 0.68, 0.15, z);
  add(g, C(0.09, 0.09, 1.3, 6), M(PAL.woodDark), 0.68, 0.45, -3.2);
  add(g, C(0.12, 0.12, 0.3, 8), M('#e8d6b0'), 0.68, 0.8, -3.2);
  return g;
}

// ---------------------------------------------------------------- Pixelbuchstaben

const FONT: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};

export function letter(ch: string, px = 0.34, lift = 0.55) {
  const g = new THREE.Group();
  // Dunkler Sockel hebt den Buchstaben übers Gras und sorgt für Kontrast
  add(g, B(px * 5.6, lift, px * 2.2), M(PAL.stoneDark), 0, lift / 2, 0);
  const rows = FONT[ch];
  const mat = M(PAL.letter);
  rows.forEach((row, ri) => {
    let x = 0;
    while (x < 5) {
      if (row[x] !== '#') { x++; continue; }
      let e = x;
      while (e < 5 && row[e] === '#') e++;
      const len = e - x;
      add(g, B(len * px, px, px * 1.4), mat, (x + len / 2 - 2.5) * px, lift + (6 - ri + 0.5) * px, 0);
      x = e;
    }
  });
  return g;
}

// ---------------------------------------------------------------- Backen

/**
 * Fasst alle Meshes eines Props zu wenigen Meshes zusammen (Farbe als Vertex-Color, ein Mesh je
 * Leucht-Material). Teile mit userData.keep (Windmühlenflügel, Flammen) bleiben animierbar.
 * Für die Skizze merken wir uns die Original-Geometrien (userData.ink / userData.live).
 */
export function bake(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const ink: { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[] = [];
  const live: THREE.Mesh[] = [];
  const remove: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.keep) {
        c.traverse((m) => { if ((m as THREE.Mesh).isMesh && !m.userData.noInk) live.push(m as THREE.Mesh); });
        continue;
      }
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) { visit(c); continue; }
      const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mesh.userData.noInk) ink.push({ geo: mesh.geometry, m: rel });
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.clearGroups();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.applyMatrix4(rel);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([mat.color.r, mat.color.g, mat.color.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const glow = mat.emissiveIntensity > 0;
      const key = glow ? `g${mat.emissive.getHexString()}${mat.emissiveIntensity}` : 'base';
      let b = buckets.get(key);
      if (!b) {
        b = { mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0, emissive: glow ? mat.emissive : '#000000', emissiveIntensity: mat.emissiveIntensity }), geos: [], shadow: !glow };
        buckets.set(key, b);
      }
      b.geos.push(g);
      remove.push(mesh);
    }
  };
  visit(root);
  remove.forEach((m) => m.removeFromParent());
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(b.geos), b.mat);
    m.castShadow = b.shadow;
    m.receiveShadow = true;
    root.add(m);
  }
  root.userData.ink = ink;
  root.userData.live = live;
  return root;
}
