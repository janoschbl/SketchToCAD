// Schmetterlings-Demo am Brunnen: Ein Stift schwebt um den Brunnen und zeichnet nacheinander Schmetterlinge in die Luft.
// Jede fertige Skizze wird farbig, erwacht, flattert erst um den Brunnen und fliegt dann davon (höchstens 3 gleichzeitig).
import * as THREE from 'three';

const INK = '#1e2d78';
const PALETTE = ['#ff8a5a', '#ffd166', '#f78fb3', '#8fd3f4', '#b9a2f2', '#9be2a5'];
const MAX_ALIVE = 3;
const DRAW_T = 3.4, FLY_T = 11, FADE_T = 1.6;

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

function wingMesh(pts: THREE.Vector2[], color: THREE.Color) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  const hinge = new THREE.Group();
  hinge.add(m);
  return { hinge, mesh: m };
}

const smooth = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

interface Fly {
  group: THREE.Group; ink: THREE.Mesh; wr: ReturnType<typeof wingMesh>; wl: ReturnType<typeof wingMesh>; mats: THREE.Material[];
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
    const ang = Math.atan2(cam.x, cam.z) + (Math.random() - 0.5) * 1.9;   // auf der Seite zur Kamera
    const r = 2.9;
    const spot = new THREE.Vector3(Math.sin(ang) * r, 1.9 + Math.random() * 0.5, Math.cos(ang) * r);
    const group = new THREE.Group();
    group.position.copy(spot);
    group.rotation.order = 'YXZ';
    group.rotation.y = Math.atan2(cam.x - spot.x, cam.z - spot.z);   // Skizze zeigt zum Betrachter
    group.scale.setScalar(0.62 + Math.random() * 0.18);
    const geom = new THREE.TubeGeometry(PATH, TUBE_SEG, 0.016, TUBE_RAD, false);
    geom.setDrawRange(0, 0);
    inkGeoms.push(geom);
    const inkMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true });
    const ink = new THREE.Mesh(geom, inkMat);
    const color = new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const wr = wingMesh(R, color), wl = wingMesh(L, color);
    group.add(wr.hinge, wl.hinge, ink);
    scene.add(group);
    return { group, ink, wr, wl, mats: [inkMat, wr.mesh.material as THREE.Material, wl.mesh.material as THREE.Material], age: 0, phase: 'draw', spot, ang, seed: Math.random() * 10 };
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
    f.wr.mesh.geometry.dispose(); f.wl.mesh.geometry.dispose();
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
        const t = f.age;
        const wake = smooth(t / 0.7);                 // Farbe füllt die Flügel, Tinte wird dünn
        (f.wr.mesh.material as THREE.MeshBasicMaterial).opacity = (f.wl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.92 * wake * (1 - smooth((t - (FLY_T - FADE_T)) / FADE_T));
        (f.mats[0] as THREE.MeshBasicMaterial).opacity = 1 - smooth((t - (FLY_T - FADE_T)) / FADE_T);
        // Flügelschlag (Scharnier an der Körpermitte), beim Erwachen noch langsam
        const flap = 0.25 + 0.95 * Math.abs(Math.sin(t * (6 + 9 * wake) + f.seed));
        f.wr.hinge.rotation.y = -flap * wake; f.wl.hinge.rotation.y = flap * wake;
        // Position & Blickrichtung
        const p0 = f.group.position;
        flyPos(f, t, tmp);
        const k = smooth(t / 1.2);
        const nx = THREE.MathUtils.lerp(f.spot.x, tmp.x, k), ny = THREE.MathUtils.lerp(f.spot.y, tmp.y, k), nz = THREE.MathUtils.lerp(f.spot.z, tmp.z, k);
        const vx = nx - p0.x, vz = nz - p0.z;
        p0.set(nx, ny, nz);
        if (Math.hypot(vx, vz) > 1e-4) {
          const h = Math.atan2(-vx, -vz);
          // sanft zur Flugrichtung drehen und aus der senkrechten Skizze in die Flugposition kippen
          const g = f.group;
          const dy = ((h - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          g.rotation.order = 'YXZ';
          g.rotation.y += dy * Math.min(1, dt * 4) * k;
          g.rotation.x = THREE.MathUtils.lerp(0, -1.15, k);
          g.rotation.z = Math.sin(t * 2 + f.seed) * 0.15 * k;
        }
        if (t >= FLY_T) { dispose(f); flies.splice(i, 1); }
      }
    },
  };
}
