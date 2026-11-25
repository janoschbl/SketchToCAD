// Schmetterlings-Demo am Brunnen: Ein Stift schwebt um den Brunnen und zeichnet nacheinander Schmetterlinge flach auf den Platz.
// Jede fertige Skizze verwandelt sich an Ort und Stelle in den echten Schmetterling (die Linien gehen dabei ganz in ihm auf),
// erst dann hebt er ab, flattert um den Brunnen und fliegt davon (höchstens 3 gleichzeitig, jedes Mal an einer anderen Stelle).
import * as THREE from 'three';

const INK = '#1e2d78';
const PALETTE = ['#ff8a5a', '#ffd166', '#f78fb3', '#8fd3f4', '#b9a2f2', '#9be2a5'];
const MAX_ALIVE = 3;
const DRAW_T = 2.6, MORPH_T = 1.1, FLY_T = 12, FADE_T = 1.6;
const SKETCH_SCALE = 0.5, REAL_SCALE = 0.2;   // Skizze am Boden gut lesbar, der echte Schmetterling deutlich kleiner
const GROUND_Y = 0.045;                          // knapp über dem Platz (Platz liegt auf 0.02)
const FLAT = -Math.PI / 2;                       // Skizze liegt flach, Oberkante zeigt vom Betrachter weg

// Rechter Flügel (Obergröße 1): von der Körpermitte über den oberen und unteren Lappen zurück
const WING_R: [number, number][] = [[0, 0], [0.18, 0.34], [0.55, 0.78], [0.98, 0.78], [1.04, 0.36], [0.45, 0.06], [0.82, -0.18], [0.9, -0.62], [0.55, -0.8], [0.24, -0.42], [0, 0]];
const mirror = (pts: [number, number][]) => pts.map(([x, y]) => [-x, y] as [number, number]);

function samplePts(pts: [number, number][], n: number) {
  return new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(n);
}
const R = samplePts(WING_R, 64), L = samplePts(mirror(WING_R), 64);
const BODY: THREE.Vector2[] = [];
for (let i = 0; i <= 10; i++) BODY.push(new THREE.Vector2(0, 0.38 - i * 0.098));
const PATH = new THREE.CatmullRomCurve3([...R, ...L, ...BODY].filter((_, i) => i % 2 === 0).map((p) => new THREE.Vector3(p.x, p.y, 0)), false, 'centripetal');
const TUBE_SEG = 260, TUBE_RAD = 4;

// Flügeltextur: Farbverlauf, dunkler Rand, Adern und helle Punkte (rechter Flügel, Koordinaten wie WING_R)
const WX = 1.06, WY0 = -0.82, WY1 = 0.8;
function wingTexture(hex: string) {
  const W = 256, H = Math.round((W * (WY1 - WY0)) / WX), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const P = (x: number, y: number) => [(x / WX) * W, ((WY1 - y) / (WY1 - WY0)) * H] as const;
  g.beginPath();
  R.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath();
  const col = new THREE.Color(hex), dark = col.clone().multiplyScalar(0.45);
  const [cx, cy] = P(0, 0);
  const grad = g.createRadialGradient(cx, cy, 4, cx, cy, W * 1.05);
  grad.addColorStop(0, '#' + dark.getHexString()); grad.addColorStop(0.18, hex); grad.addColorStop(0.75, '#' + col.clone().offsetHSL(0.02, 0, 0.12).getHexString()); grad.addColorStop(1, hex);
  g.fillStyle = grad; g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(30,20,50,0.35)'; g.lineWidth = 2;
  for (let i = 0; i < 7; i++) { const [x, y] = P(0.98, 0.72 - i * 0.3); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }   // Adern
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, r] of [[0.9, 0.62, 0.05], [0.72, 0.7, 0.035], [0.95, 0.42, 0.03], [0.78, -0.55, 0.045], [0.6, -0.68, 0.03], [0.86, -0.38, 0.03]] as const) { const [px, py] = P(x, y); g.beginPath(); g.arc(px, py, r * W, 0, 7); g.fill(); }   // helle Punkte am Rand
  g.restore();
  g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#2b1d3a';   // dunkler Rand
  g.beginPath(); R.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function wingGeom() {
  const g = new THREE.ShapeGeometry(new THREE.Shape(R));
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / WX, (pos.getY(i) - WY0) / (WY1 - WY0));
  return g;
}
const WING_GEOM = wingGeom();
function wingMesh(tex: THREE.Texture, mirrored: boolean) {
  const m = new THREE.Mesh(WING_GEOM, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.02 }));
  if (mirrored) m.scale.x = -1;
  const hinge = new THREE.Group();
  hinge.add(m);
  return { hinge, mesh: m };
}

const smooth = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

interface Fly {
  group: THREE.Group; ink: THREE.Mesh; wr: ReturnType<typeof wingMesh>; wl: ReturnType<typeof wingMesh>; body: THREE.Mesh; tex: THREE.Texture; mats: THREE.Material[];
  age: number; phase: 'draw' | 'fly'; spot: THREE.Vector3; ang: number; seed: number;
}

export function createButterflies(scene: THREE.Scene) {
  const flies: Fly[] = [];
  const inkGeoms: THREE.BufferGeometry[] = [];
  // Stift: Spitze im Ursprung der Gruppe
  const pen = new THREE.Group();
  {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), new THREE.MeshBasicMaterial({ color: '#f2b84b' }));
    body.position.y = 0.38;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 8), new THREE.MeshBasicMaterial({ color: '#f4dcc0' }));
    tip.rotation.x = Math.PI; tip.position.y = 0.05;
    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8), new THREE.MeshBasicMaterial({ color: INK }));
    lead.rotation.x = Math.PI; lead.position.y = 0.0175;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.07, 8), new THREE.MeshBasicMaterial({ color: '#d8562e' }));
    cap.position.y = 0.69;
    pen.add(body, tip, lead, cap);
    pen.rotation.set(0.45, 0, -0.35);
    pen.visible = false;
    scene.add(pen);
  }
  const penPos = new THREE.Vector3(0, 3, 3);
  let penState: 'idle' | 'move' | 'draw' = 'idle', penT = 0, wait = 1.2, penFrom = new THREE.Vector3(), cur: Fly | null = null;
  const tmp = new THREE.Vector3();

  function spawn(cam: THREE.Vector3): Fly {
    const side = Math.random() < 0.5 ? -1 : 1;
    // jedes Mal woanders auf dem Platz, aber im Blickfeld: links oder rechts vom Brunnen, nah oder weiter weg
    const camAng = Math.atan2(cam.x, cam.z);
    let ang = camAng, r = 3;
    const spot = new THREE.Vector3();
    for (let tries = 0; tries < 8; tries++) {
      ang = camAng + side * (0.35 + Math.random() * 1.15);
      r = 2.7 + Math.random() * 2.4;
      spot.set(Math.sin(ang) * r, GROUND_Y, Math.cos(ang) * r);
      if (Math.hypot(spot.x - cam.x, spot.z - cam.z) > 2.6 && flies.every((o) => o.spot.distanceTo(spot) > 1.4)) break;   // nicht vor den Füßen, nicht auf einem anderen
    }
    const group = new THREE.Group();
    group.position.copy(spot);
    group.rotation.order = 'YXZ';
    group.rotation.y = Math.atan2(cam.x - spot.x, cam.z - spot.z);   // Skizze liegt lesbar zum Betrachter
    group.rotation.x = FLAT;
    group.scale.setScalar(SKETCH_SCALE);
    const geom = new THREE.TubeGeometry(PATH, TUBE_SEG, 0.035, TUBE_RAD, false);
    geom.setDrawRange(0, 0);
    inkGeoms.push(geom);
    const inkMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true });
    const ink = new THREE.Mesh(geom, inkMat);
    const tex = wingTexture(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const wr = wingMesh(tex, false), wl = wingMesh(tex, true);
    const bodyMat = new THREE.MeshBasicMaterial({ color: '#2b1d3a', transparent: true, opacity: 0 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.62, 4, 8), bodyMat);
    body.position.y = -0.02;
    const ant = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 4, 16, Math.PI), bodyMat);
    ant.position.y = 0.34; ant.scale.set(1, 1.3, 1);
    body.add(ant); ant.position.set(0, 0.34, 0);
    group.add(wr.hinge, wl.hinge, body, ink);
    scene.add(group);
    return { group, ink, wr, wl, body, tex, mats: [inkMat, wr.mesh.material as THREE.Material, wl.mesh.material as THREE.Material, bodyMat], age: 0, phase: 'draw', spot, ang, seed: Math.random() * 10 };
  }

  /** Flugbahn: erst Kreise um den Brunnen, dann spiralförmig nach außen und oben davon */
  function flyPos(f: Fly, t: number, out: THREE.Vector3) {
    const out0 = Math.max(0, (t - FLY_T * 0.5) / (FLY_T * 0.5));
    const r = 3.3 + 0.25 * Math.sin(t * 0.9 + f.seed) + out0 * out0 * 17;
    const a = f.ang + t * 0.5;
    out.set(Math.sin(a) * r, 2.3 + 0.35 * Math.sin(t * 1.7 + f.seed) + out0 * out0 * 6, Math.cos(a) * r);
  }

  function dispose(f: Fly) {
    scene.remove(f.group);
    f.ink.geometry.dispose();
    f.body.geometry.dispose(); f.tex.dispose();
    f.mats.forEach((m) => m.dispose());
  }

  return {
    update(dt: number, time: number, cam: THREE.Vector3, active: boolean) {
      // Stiftsteuerung
      if (active) {
        const alive = flies.length;
        if (penState === 'idle') {
          wait -= dt;
          pen.visible = true;
          // sanft um den Brunnen schweben, solange nichts zu zeichnen ist
          const a = time * 0.4;
          penPos.set(Math.sin(a) * 3.4, 2.9 + Math.sin(time * 1.3) * 0.15, Math.cos(a) * 3.4);
          if (wait <= 0 && alive < MAX_ALIVE) { cur = spawn(cam); flies.push(cur); penFrom.copy(penPos); penState = 'move'; penT = 0; }
        } else if (penState === 'move' && cur) {
          penT += dt;
          PATH.getPoint(0, tmp); cur.group.localToWorld(tmp);
          penPos.lerpVectors(penFrom, tmp, smooth(penT / 1.1));
          if (penT >= 1.1) { penState = 'draw'; penT = 0; }
        } else if (penState === 'draw' && cur) {
          penT += dt;
          const p = Math.min(1, penT / DRAW_T), e = p * p * (3 - 2 * p) * 0.4 + p * 0.6;
          cur.ink.geometry.setDrawRange(0, Math.floor(e * TUBE_SEG) * TUBE_RAD * 6);
          PATH.getPoint(e, tmp); cur.group.localToWorld(tmp);
          penPos.copy(tmp);
          penPos.x += Math.sin(time * 41) * 0.004; penPos.y += Math.sin(time * 37) * 0.004;
          if (p >= 1) { cur.phase = 'fly'; cur.age = 0; cur = null; penState = 'idle'; wait = 1.8; }
        }
        pen.position.copy(penPos);
      } else if (penState === 'idle') pen.visible = false;

      // Schmetterlinge
      for (let i = flies.length - 1; i >= 0; i--) {
        const f = flies[i];
        if (f.phase === 'draw') { f.age += dt; continue; }
        f.age += dt;
        // 1) Verwandlung am Boden: Linien gehen in den farbigen Schmetterling über, er zieht sich dabei zusammen
        const m = smooth(f.age / MORPH_T);
        const t = Math.max(0, f.age - MORPH_T);        // Flugzeit, beginnt erst nach der Verwandlung
        const fade = 1 - smooth((t - (FLY_T - FADE_T)) / FADE_T);
        (f.wr.mesh.material as THREE.MeshBasicMaterial).opacity = (f.wl.mesh.material as THREE.MeshBasicMaterial).opacity = m * fade;
        (f.mats[3] as THREE.MeshBasicMaterial).opacity = m * fade;
        (f.mats[0] as THREE.MeshBasicMaterial).opacity = (1 - m) * 0.9;   // bei fertigem Schmetterling ist die Skizze weg
        f.ink.visible = m < 1;
        f.group.scale.setScalar(THREE.MathUtils.lerp(SKETCH_SCALE, REAL_SCALE, m));
        // Flügelschlag (Scharnier an der Körpermitte): am Ende der Verwandlung ein, zwei langsame Schläge, dann normal
        const wake = smooth(f.age / (MORPH_T + 0.4));
        const flap = 0.2 + 0.85 * Math.abs(Math.sin(t * (6 + 12 * smooth(t / 0.6)) + f.seed));
        f.wr.hinge.rotation.y = -flap * wake; f.wl.hinge.rotation.y = flap * wake;
        if (f.age < MORPH_T) continue;
        // 2) Abheben und Flug
        const p0 = f.group.position;
        flyPos(f, t, tmp);
        const k = smooth(t / 1.2);
        const nx = THREE.MathUtils.lerp(f.spot.x, tmp.x, k), ny = THREE.MathUtils.lerp(f.spot.y, tmp.y, k), nz = THREE.MathUtils.lerp(f.spot.z, tmp.z, k);
        const vx = nx - p0.x, vz = nz - p0.z;
        p0.set(nx, ny, nz);
        if (Math.hypot(vx, vz) > 1e-4) {
          const h = Math.atan2(-vx, -vz);
          // sanft zur Flugrichtung drehen und aus der flachen Bodenlage in die Flugposition aufrichten
          const g = f.group;
          const dy = ((h - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          g.rotation.order = 'YXZ';
          g.rotation.y += dy * Math.min(1, dt * 4) * k;
          g.rotation.x = THREE.MathUtils.lerp(FLAT, -1.15, k);
          g.rotation.z = Math.sin(t * 2 + f.seed) * 0.15 * k;
        }
        if (t >= FLY_T) { dispose(f); flies.splice(i, 1); }
      }
    },
  };
}
