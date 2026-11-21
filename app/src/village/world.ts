import * as THREE from 'three';
import { makeRevealUniforms, patchReveal, MASK_PARS, type RevealMask } from './reveal';

export const ISLAND_R = 58;
/** Gepflasterter Dorfplatz um den Brunnen – direkt dahinter beginnt der Häuserring. */
export const PLAZA_R = 6.0;
// Sonne tief im Westen, außerhalb des Blickfelds auf den Schriftzug (sonst blendet sie "SKETCH")
export const SUN_DIR = new THREE.Vector3(-1, 0.07, -0.45).normalize();

export const SKY = {
  top: new THREE.Color('#2f2656'),
  mid: new THREE.Color('#a04f70'),
  low: new THREE.Color('#f07a5a'),
  horizon: new THREE.Color('#ffbd7f'),
  sun: new THREE.Color('#ffd2a0'),
  cloud: new THREE.Color('#ff9b8c'),
  fog: new THREE.Color('#e9987a'),
};

// ---------------------------------------------------------------- Noise

export function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number) { return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15; }

// ---------------------------------------------------------------- Layout-Hilfen

export interface Blocker { x: number; z: number; r: number }
export interface PathDef { pts: [number, number][]; w: number }

// Radius samples run counter-clockwise around headlands and sheltered coves.
const headlands = [54, 49, 35, 51, 57, 44, 38, 54, 46, 39, 55, 48, 53, 57, 43, 37, 55, 47];
export function coastRadius(angle: number) {
  const t = (angle / (2 * Math.PI) + 1) % 1 * headlands.length;
  const i = Math.floor(t);
  return THREE.MathUtils.lerp(headlands[i], headlands[(i + 1) % headlands.length], THREE.MathUtils.smoothstep(t - i, 0, 1));
}

function shapeCoast(geo: THREE.BufferGeometry, radius: number) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const scale = coastRadius(Math.atan2(z, x)) / radius;
    pos.setXYZ(i, x * scale, pos.getY(i), z * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

export interface Lagoon extends Blocker { stretch: number; bend: number }
function bendAt(z: number, lake: Lagoon) {
  return lake.bend * Math.sin(z / lake.stretch / lake.r * Math.PI * 1.15);
}
function lakeShape(geo: THREE.BufferGeometry, lake: Lagoon) {
  const pos = geo.attributes.position;
  const coords: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    coords.push(x / lake.r, z / lake.r);
    pos.setXYZ(i, x + bendAt(z * lake.stretch, lake), pos.getY(i), z * lake.stretch);
  }
  geo.setAttribute('lakeCoord', new THREE.Float32BufferAttribute(coords, 2));
  geo.computeVertexNormals();
  return geo;
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
export function distToPaths(x: number, z: number, paths: PathDef[]) {
  let d = Infinity;
  for (const p of paths) for (let i = 0; i < p.pts.length - 1; i++) d = Math.min(d, distToSeg(x, z, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]) - p.w / 2);
  return d;
}
export const inWater = (x: number, z: number, ponds: Lagoon[], pad = 0) => {
  if (Math.hypot(x, z) > coastRadius(Math.atan2(z, x)) - 1.7 - pad) return true;
  return ponds.some(lake => {
    const dz = z - lake.z;
    return Math.hypot(x - lake.x - bendAt(dz, lake), dz / lake.stretch) < lake.r + pad;
  });
};

// ---------------------------------------------------------------- Himmel & Meer

const skyFn = /* glsl */ `
  uniform vec3 uTop, uMid, uLow, uHorizon, uSun, uCloud, uSunDir;
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 c = mix(uHorizon, uLow, smoothstep(0.0, 0.09, h));
    c = mix(c, uMid, smoothstep(0.07, 0.3, h));
    c = mix(c, uTop, smoothstep(0.28, 0.8, h));
    float sd = max(dot(d, uSunDir), 0.0);
    c += uSun * (pow(sd, 5.0) * 0.45 + pow(sd, 48.0) * 0.8);
    c += vec3(1.0, 0.92, 0.75) * smoothstep(0.9990, 0.9994, sd) * 3.0;
    return c;
  }`;
function skyUniforms() {
  return {
    uTop: { value: SKY.top }, uMid: { value: SKY.mid }, uLow: { value: SKY.low }, uHorizon: { value: SKY.horizon },
    uSun: { value: SKY.sun }, uCloud: { value: SKY.cloud }, uSunDir: { value: SUN_DIR },
  };
}

export function createSky() {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms(), uDay: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform float uDay; ${skyFn}
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float band = smoothstep(0.015, 0.06, d.y) * (1.0 - smoothstep(0.12, 0.24, d.y));
        float ang = atan(d.x, d.z);
        float cl = sin(ang * 9.0 + sin(ang * 3.0) * 2.0) * 0.5 + 0.5;
        cl *= sin(ang * 4.0 - d.y * 40.0 + 1.0) * 0.5 + 0.5;
        cl = smoothstep(0.35, 0.75, cl) * band;
        float lit = pow(max(dot(d, uSunDir), 0.0), 3.0);
        c = mix(c, uCloud * (0.85 + lit * 0.8), cl * 0.55);
        gl_FragColor = vec4(c * uDay, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function createSea() {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uWaveR: { value: 0 }, uDeep: { value: new THREE.Color('#225467') } }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uWaveR; uniform vec3 uDeep; varying vec3 vW;
      ${skyFn}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec2 p = vW.xz;
        float att = 1.0 / (1.0 + length(vW.xz - cameraPosition.xz) * 0.012);
        float w1 = sin(dot(p, vec2(0.31, 0.17)) + uTime * 0.8), w2 = sin(dot(p, vec2(-0.23, 0.47)) * 1.6 - uTime * 1.2);
        float w3 = sin(dot(p, vec2(0.83, -0.52)) * 2.1 + uTime * 1.7), w4 = sin(dot(p, vec2(-0.61, -0.79)) * 3.3 - uTime * 2.1);
        vec3 N = normalize(vec3((w1 * 0.05 + w2 * 0.035 + w3 * 0.02) * att, 1.0, (w2 * 0.04 - w3 * 0.03 + w4 * 0.018) * att));
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 c = mix(uDeep, skyColor(R), 0.35 + 0.6 * fres);
        c += uSun * pow(max(dot(R, uSunDir), 0.0), 140.0) * 3.0;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
        gl_FragColor.rgb *= 1.0 - smoothstep(uWaveR - 6.0, uWaveR, length(vW.xz));
      }`,
    fog: true,
  });
  Object.assign(m.uniforms, skyUniforms());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.48;
  return mesh;
}

/** Unaufgedeckte Welt: dunkles Papier mit X-Raster (Hommage an Brunos Ladebildschirm). */
export function createDrawingPad(mask: RevealMask) {
  const R = ISLAND_R + 1.5;
  const m = new THREE.Mesh(
    shapeCoast(new THREE.CircleGeometry(R, 216).rotateX(-Math.PI / 2), R),
    new THREE.ShaderMaterial({
      uniforms: { uMask: mask.uMask, uWorld: mask.uWorld },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vP;
        ${MASK_PARS}
        void main(){
          if (maskEdge(vP) >= 0.0) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }`,
      transparent: true, depthWrite: false,
    }),
  );
  m.position.y = -0.06;
  return m;
}

// ---------------------------------------------------------------- Insel

export function createIsland(paths: PathDef[], ponds: Lagoon[], blockers: Blocker[], mask: RevealMask) {
  const reveal = makeRevealUniforms(0, '#ff6a3d', 0.22);
  const group = new THREE.Group();
  const std = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, ...o });
    patchReveal(m, reveal, 'mask', mask);
    return m;
  };
  const tmp = new THREE.Color();

  // Boden mit Farbflecken
  const ground = shapeCoast(new THREE.RingGeometry(0, ISLAND_R, 216, 120).rotateX(-Math.PI / 2), ISLAND_R);
  const gp = ground.attributes.position;
  const cols = new Float32Array(gp.count * 3);
  const cA = new THREE.Color('#628743'), cB = new THREE.Color('#8b9a3e'), cC = new THREE.Color('#b4af59'), cEdge = new THREE.Color('#efd494');
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const n = fbm(x * 0.06 + 10, z * 0.06);
    tmp.copy(cA).lerp(cB, THREE.MathUtils.smoothstep(n, 0.3, 0.6)).lerp(cC, THREE.MathUtils.smoothstep(n, 0.62, 0.8) * 0.8);
    const inland = coastRadius(Math.atan2(z, x)) - Math.hypot(x, z);
    tmp.lerp(cEdge, 1 - THREE.MathUtils.smoothstep(inland, 1.2, 3.4));
    gp.setY(i, -0.6 * (1 - THREE.MathUtils.smoothstep(inland, 0, 2)));

    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ground.computeVertexNormals();
  const gm = new THREE.Mesh(ground, std({ vertexColors: true }));
  gm.receiveShadow = true;
  group.add(gm);

  // Wege
  const pathMat = std({ color: '#d6a86e', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
  const pavers: THREE.Matrix4[] = [];
  const stonePose = new THREE.Object3D();
  for (const p of paths) {
    const curve = new THREE.CatmullRomCurve3(p.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const N = Math.max(8, Math.round(curve.getLength() * 2.5));
    const rows = Math.floor(curve.getLength() / 0.52);
    for (let row = 0; row < rows; row++) {
      for (let side = -1; side <= 1; side++) {
        const t = (row + (side === 0 ? 0.75 : 0.28)) / rows;
        const pt = curve.getPointAt(t), dir = curve.getTangentAt(t);
        if (Math.hypot(pt.x, pt.z) < PLAZA_R - 0.05) continue;
        const shift = side * p.w * 0.29;
        stonePose.position.set(pt.x + dir.z * shift, 0.024, pt.z - dir.x * shift);
        stonePose.rotation.y = Math.atan2(dir.x, dir.z) + (hash(row, side) - 0.5) * 0.09;
        stonePose.scale.set(p.w * 0.27, 0.035, 0.46);
        stonePose.updateMatrix();
        pavers.push(stonePose.matrix.clone());
      }
    }
    const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, pt = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const w = (p.w / 2) * (0.85 + fbm(pt.x * 0.5, pt.z * 0.5) * 0.35);
      pos.push(pt.x - tan.z * w, 0.012, pt.z + tan.x * w, pt.x + tan.z * w, 0.012, pt.z - tan.x * w);
      nrm.push(0, 1, 0, 0, 1, 0);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, pathMat);
    m.receiveShadow = true;
    group.add(m);
  }
  const paving = new THREE.InstancedMesh(new THREE.BoxGeometry(), std({ color: '#ffffff' }), pavers.length);
  const clay = ['#d4a276', '#dfb887', '#ce986e', '#e0af80'];
  pavers.forEach((matrix, i) => {
    paving.setMatrixAt(i, matrix);
    paving.setColorAt(i, tmp.set(clay[Math.floor(hash(i, 31) * clay.length)]));
  });
  paving.receiveShadow = true;
  group.add(paving);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 64).rotateX(-Math.PI / 2), std({ color: '#d4b08e', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  group.add(plaza);
  const NS = 44;
  const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.08, 0.45), std({ color: '#c49e7c' }), NS);
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    stones.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * (PLAZA_R + 0.05), 0.04, Math.sin(a) * (PLAZA_R + 0.05)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(1, 1, 1)));
  }
  stones.receiveShadow = true;
  group.add(stones);

  // Teiche
  const waters: THREE.ShaderMaterial[] = [];
  for (const pond of ponds) {
    const sand = new THREE.Mesh(lakeShape(new THREE.RingGeometry(pond.r - 0.3, pond.r + 0.55, 96, 4).rotateX(-Math.PI / 2), pond), std({ color: '#e2c08c', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    sand.position.set(pond.x, 0.02, pond.z);
    sand.receiveShadow = true;
    group.add(sand);
    const wm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uDeep: { value: new THREE.Color('#18495c') }, uShallow: { value: new THREE.Color('#71c8ae') },
        uSunset: { value: new THREE.Color('#ffb27a') }, uGlow: { value: new THREE.Color('#ff7a3d') },
      }]),
      vertexShader: `#include <common>
        #include <fog_pars_vertex>
        attribute vec2 lakeCoord; varying vec2 vLake; varying vec3 vW;
        void main(){ vLake = lakeCoord; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        ${MASK_PARS}
        uniform float uTime; uniform vec3 uDeep, uShallow, uSunset, uGlow; varying vec2 vLake; varying vec3 vW;
        void main(){
          float e = maskEdge(vW.xz);
          if (e < 0.0) discard;
          vec2 p = vW.xz;
          float r = length(vLake);
          vec3 c = mix(uDeep, uShallow, smoothstep(0.55, 1.0, r));
          float s = sin(p.x * 2.2 + uTime * 1.2 + sin(p.y * 1.7 + uTime) * 1.4) * sin(p.y * 2.6 - uTime * 0.9);
          c = mix(c, uSunset, smoothstep(0.89, 0.99, s) * 0.36);
          c = mix(c, vec3(1.0, 0.95, 0.85), (1.0 - smoothstep(0.004, 0.018, abs(r - 0.94 - 0.015 * sin(p.x * 2.0 + uTime) - 0.011 * sin(p.y * 2.7)))) * 0.78);
          c += uGlow * (1.0 - smoothstep(0.0, 0.22, e)) * 1.1;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`,
      fog: true,
    });
    wm.uniforms.uMask = mask.uMask;
    wm.uniforms.uWorld = mask.uWorld;
    waters.push(wm);
    const water = new THREE.Mesh(lakeShape(new THREE.RingGeometry(0, pond.r, 96, 24).rotateX(-Math.PI / 2), pond), wm);
    water.position.set(pond.x, 0.04, pond.z);
    group.add(water);
    const lilyMat = std({ color: '#6f8f4a' }), blossomMat = std({ color: '#f7b2c4', emissive: '#f28aa8', emissiveIntensity: 0.3 });
    for (let i = 0; i < Math.round(pond.r * 1.5); i++) {
      const a = i * 1.9 + pond.x, rr = 1.2 + ((i * 0.37) % 1) * (pond.r - 2);
      const lily = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 9, 1, false, 0.4, Math.PI * 1.8), lilyMat);
      lily.position.set(pond.x + Math.cos(a) * rr + bendAt(Math.sin(a) * rr * pond.stretch, pond), 0.06, pond.z + Math.sin(a) * rr * pond.stretch);
      group.add(lily);
      if (i % 2 === 0) {
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), blossomMat);
        fl.position.copy(lily.position).setY(0.13);
        group.add(fl);
      }
    }
  }

  const ok = (x: number, z: number, pad: number) =>
    !inWater(x, z, ponds, 1.0) && distToPaths(x, z, paths) > pad && !blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad);

  // Steine
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std({ color: '#ffffff', flatShading: true }), 140);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let ri = 0;
  // Broken outcrops interrupt the waterline, with small stones at the foot of each slab.
  for (const pond of ponds) {
    for (const angle of [-1.4, -0.25, 1.35]) {
      for (let j = 0; j < 5; j++) {
        const theta = angle + j * 0.105;
        const radius = pond.r + (hash(j, pond.x) - 0.5) * 0.65;
        const size = 0.32 + hash(j, pond.z) * 0.58;
        p.set(pond.x + Math.cos(theta) * radius + bendAt(Math.sin(theta) * radius * pond.stretch, pond), size * 0.19, pond.z + Math.sin(theta) * radius * pond.stretch);
        q.setFromEuler(e.set(0.2, theta, hash(j, 8) * 0.35));
        s.set(size, size * 0.75, size * 1.25);
        rocks.setMatrixAt(ri, m4.compose(p, q, s));
        rocks.setColorAt(ri++, tmp.set(j % 2 ? '#a2979e' : '#817986'));
      }
    }
  }
  for (let i = 0; i < 3000 && ri < 140; i++) {
    const a = hash(i, 3) * Math.PI * 2, r = 5 + Math.sqrt(hash(i, 7)) * (ISLAND_R - 7);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (fbm(x * 0.08 + 7, z * 0.08) < 0.55 || !ok(x, z, 0.6)) continue;
    const sc = 0.2 + hash(i, 9) * (r > ISLAND_R - 10 ? 0.9 : 0.5);
    p.set(x, sc * 0.3, z); e.set(hash(i, 1) * 3, hash(i, 2) * 3, 0); q.setFromEuler(e); s.set(sc, sc * 0.7, sc);
    rocks.setMatrixAt(ri, m4.compose(p, q, s));
    rocks.setColorAt(ri, tmp.set(i % 3 ? '#888191' : '#c0aaa1'));
    ri++;
  }
  rocks.count = ri;
  rocks.castShadow = true; rocks.receiveShadow = true;
  group.add(rocks);

  // Blumen
  const FN = 2600;
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), std({ color: '#ffffff', flatShading: true }), FN);
  const fcol = ['#f28fa0', '#fff0c8', '#b99ad8', '#ffd35a', '#ff8a5c'].map((c) => new THREE.Color(c));
  let fi = 0;
  for (let tries = 0; tries < 40000 && fi < FN; tries++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 1.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (fbm(x * 0.12 + 40, z * 0.12) < 0.54 || !ok(x, z, 0.2)) continue;
    flowers.setMatrixAt(fi, m4.makeTranslation(x, 0.22 + Math.random() * 0.15, z));
    flowers.setColorAt(fi, fcol[Math.floor(fbm(x * 0.3, z * 0.3) * 9) % fcol.length]);
    fi++;
  }
  flowers.count = fi;
  group.add(flowers);

  return { group, waters };
}

// ---------------------------------------------------------------- Gras

export function createGrass(paths: PathDef[], ponds: Lagoon[], blockers: Blocker[], mask: RevealMask) {
  const blade = new THREE.BufferGeometry();
  // One tussock shares a root and wind phase, with three different leaf profiles.
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = i * 2.4, dx = Math.cos(angle), dz = Math.sin(angle);
    const height = 1 - i * 0.16, offset = i * 5;
    for (const [width, y, bend] of [[-0.12, 0, 0.025], [0.12, 0, 0.025], [-0.053, 0.55, 0.12], [0.053, 0.55, 0.12], [0, 1, 0.28]]) {
      positions.push(dx * bend - dz * width, y * height, dz * bend + dx * width);
    }
    indices.push(...[0, 1, 2, 1, 3, 2, 2, 3, 4].map(index => offset + index));
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  blade.setIndex(indices);
  const N = 55000;
  const tint = new Float32Array(N * 3);
  const mesh = new THREE.InstancedMesh(blade, new THREE.ShaderMaterial(), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const golds = ['#ffffff', '#ffd890', '#f0a070', '#c8e8a0', '#a8c878'].map((c) => new THREE.Color(c));
  let n = 0;
  for (let tries = 0; tries < N * 5 && n < N; tries++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 0.6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const dens = fbm(x * 0.08 + 5, z * 0.08 - 3);
    if (Math.random() > THREE.MathUtils.smoothstep(dens, 0.20, 0.65) * 0.72 + 0.28) continue;
    if (inWater(x, z, ponds, 0.7) || Math.hypot(x, z) < PLAZA_R + 0.15 || distToPaths(x, z, paths) < 0.15) continue;
    if (blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r * 0.85)) continue;
    p.set(x, 0, z);
    e.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    q.setFromEuler(e);
    s.set(1 + Math.random() * 0.6, 0.12 + dens * dens * 0.94 + Math.random() * 0.16, 1);
    mesh.setMatrixAt(n, m4.compose(p, q, s));
    const c = golds[Math.min(golds.length - 1, Math.floor((dens * 0.8 + Math.random() * 0.2) * golds.length))];
    tint.set([c.r, c.g, c.b], n * 3);
    n++;
  }
  mesh.count = n;
  blade.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uBase: { value: new THREE.Color('#3f5a26') }, uTip: { value: new THREE.Color('#c9c060') }, uGlow: { value: new THREE.Color('#ff7a3d') },
  }]);
  uniforms.uMask = mask.uMask;
  uniforms.uWorld = mask.uWorld;
  mesh.material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      ${MASK_PARS}
      uniform float uTime;
      attribute vec3 aTint;
      varying float vH; varying float vE; varying vec3 vTint;
      void main(){
        float h = position.y;
        vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vE = maskEdge(base.xz);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        // Halme wachsen an der Reveal-Front aus dem Boden
        wp.y = mix(base.y, wp.y, smoothstep(0.0, 0.6, vE));
        float wind = sin(uTime * 1.5 + base.x * 0.3 + base.z * 0.22) * 0.55 + sin(uTime * 2.9 + base.x * 0.9 + base.z * 0.5) * 0.25;
        float hh = h * h;
        wp.x += wind * 0.2 * hh * (wp.y + 0.3);
        wp.z += wind * 0.08 * hh;
        vH = h; vTint = aTint;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform vec3 uBase, uTip, uGlow;
      varying float vH; varying float vE; varying vec3 vTint;
      void main(){
        if (vE < 0.0) discard;
        vec3 c = mix(uBase, uTip * vTint, smoothstep(0.0, 1.0, vH));
        c *= 0.62 + 0.55 * vH;
        c += uGlow * (1.0 - smoothstep(0.0, 0.25, vE)) * 0.9;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true,
  });
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- Glühwürmchen & Blätter

export function createFireflies(mask: RevealMask) {
  const N = 600;
  const base = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 3);
    base.set([Math.cos(a) * r, 0.4 + Math.random() * 2.6, Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMask: mask.uMask, uWorld: mask.uWorld, uColor: { value: new THREE.Color('#ffd27a').multiplyScalar(3.2) } },
    vertexShader: `${MASK_PARS}
      uniform float uTime; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime * (0.35 + aSeed * 0.4) + aSeed * 40.0;
        p += vec3(sin(t) * 1.1, sin(t * 1.7) * 0.45, cos(t * 0.8) * 1.1);
        vA = (0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 30.0)) * smoothstep(0.3, 1.2, maskEdge(position.xz));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.6 + aSeed * 0.6) * vA * (220.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; if (vA <= 0.01) discard; gl_FragColor = vec4(uColor * a * vA, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export class Leaves {
  readonly mesh: THREE.InstancedMesh;
  private n = 220;
  private p: THREE.Vector3[] = [];
  private v: number[] = [];
  private rot: THREE.Euler[] = [];
  private spin: number[] = [];
  private rest: number[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);
  sources: THREE.Vector3[] = [];

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.13), mat, this.n);
    const cols = ['#e8823a', '#f2b23c', '#d2523a', '#ff9a4a', '#c7452f'].map((c) => new THREE.Color(c));
    for (let i = 0; i < this.n; i++) {
      this.p.push(new THREE.Vector3(0, -50, 0));
      this.v.push(0.4 + Math.random() * 0.5);
      this.rot.push(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      this.spin.push(1 + Math.random() * 3);
      this.rest.push(Math.random() * 3);
      this.mesh.setColorAt(i, cols[i % cols.length]);
    }
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** Blätter fallen bevorzugt von Bäumen in der Nähe des Fokus. */
  update(dt: number, t: number, focus: THREE.Vector3) {
    const near = this.sources.filter((s) => Math.abs(s.x - focus.x) < 22 && Math.abs(s.z - focus.z) < 18);
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (p.y <= 0.03) {
        this.rest[i] -= dt;
        if (this.rest[i] <= 0 && near.length) {
          const s = near[Math.floor(Math.random() * near.length)];
          p.set(s.x + (Math.random() - 0.5) * 2.4, s.y + (Math.random() - 0.3) * 1.2, s.z + (Math.random() - 0.5) * 2.4);
          this.rest[i] = 2 + Math.random() * 4;
        }
      } else {
        p.y -= this.v[i] * dt;
        p.x += (Math.sin(t * 0.9 + i) * 0.6 + 0.5) * dt;
        p.z += Math.cos(t * 0.7 + i * 1.3) * 0.3 * dt;
        this.rot[i].x += this.spin[i] * dt; this.rot[i].z += this.spin[i] * 0.6 * dt;
        if (p.y < 0.03) { p.y = 0.03; this.rot[i].x = -Math.PI / 2; this.rot[i].z = 0; }
      }
      this.q.setFromEuler(this.rot[i]);
      this.mesh.setMatrixAt(i, this.m4.compose(p, this.q, this.one));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
