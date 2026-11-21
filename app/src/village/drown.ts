// Easteregg „Platsch“: Wer ins tiefe Wasser läuft, geht unter (Arme rudern nach oben) und taucht
// anschließend im Dorfbrunnen wieder auf – Hände greifen den Rand, man zieht sich heraus.
// Alles in Ich-Perspektive; die Arme hängen an der Kamera, das Wasser ist ein DOM-Overlay.
import * as THREE from 'three';

const SKIN = '#e9b48f', SLEEVE = '#4f74b8', CUFF = '#3c5a92';

function std(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
}

/** Ein Unterarm mit Hand (Ellbogen im Ursprung, Arm zeigt entlang +Y, Handfläche nach -Z). */
function makeArm(side: 1 | -1) {
  const arm = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.36, 7), std(SLEEVE));
  sleeve.position.y = 0.18;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 7), std(CUFF));
  cuff.position.y = 0.37;
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.08, 6), std(SKIN));
  wrist.position.y = 0.42;
  const hand = new THREE.Group();
  hand.position.y = 0.46;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.045), std(SKIN));
  palm.position.y = 0.06;
  hand.add(palm);
  const fingers: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(-0.04 + i * 0.027, 0.12, 0);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.085 - Math.abs(i - 1.5) * 0.012, 0.026), std(SKIN));
    seg.position.y = 0.04;
    f.add(seg);
    hand.add(f);
    fingers.push(f);
  }
  const thumb = new THREE.Group();
  thumb.position.set(side * 0.06, 0.05, 0);
  thumb.rotation.z = -side * 0.9;
  const tm = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.07, 0.028), std(SKIN));
  tm.position.y = 0.035;
  thumb.add(tm);
  hand.add(thumb);
  arm.add(sleeve, cuff, wrist, hand);
  arm.traverse((m) => { (m as THREE.Mesh).castShadow = false; m.renderOrder = 10; });
  return { arm, hand, fingers };
}

export interface Drown {
  readonly active: boolean;
  start(): void;
  /** Kamera überschreiben, solange die Szene läuft. Gibt am Ende die neue Laufposition zurück. */
  update(dt: number, camera: THREE.PerspectiveCamera, look: THREE.Vector3): { done: boolean; pos?: THREE.Vector3; yaw?: number } | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export function createDrown(opts: { camera: THREE.PerspectiveCamera; eye: number; onSplash?: (big: boolean) => void; onDone?: () => void }): Drown {
  const L = makeArm(-1), R = makeArm(1);
  const arms = new THREE.Group();
  arms.add(L.arm, R.arm);
  arms.visible = false;
  opts.camera.add(arms);

  // Wasser-Overlay: steigende Wasserlinie, Lichtstrahlen, Blasen, Abblende
  const ov = document.createElement('div');
  ov.className = 'vdrown';
  ov.innerHTML = `<div class="vdrown-water"><svg class="vdrown-wave" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 C 100 6, 200 36, 300 20 S 500 6, 600 20 S 800 36, 900 20 S 1100 6, 1200 20 V40 H0 Z"/></svg><div class="vdrown-rays"></div></div>
    <div class="vdrown-bubbles">${Array.from({ length: 16 }, (_, i) => `<i style="left:${(6 + ((i * 37) % 88)).toFixed(0)}%;animation-delay:${((i * 0.23) % 1.9).toFixed(2)}s;width:${6 + (i % 4) * 4}px;height:${6 + (i % 4) * 4}px"></i>`).join('')}</div>
    <div class="vdrown-dark"></div>
    <p class="vdrown-msg">Platsch! Zum Glück gibt’s den Brunnen.</p>`;
  document.body.appendChild(ov);
  const setV = (k: string, v: number) => ov.style.setProperty(k, v.toFixed(3));

  let t = -1;
  const from = new THREE.Vector3();
  let fromYaw = 0;
  const WELL0 = new THREE.Vector3(0, 1.12, 0.42);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  const D = { sink: 3.1, well: 3.1 };   // Zeitpunkte: bis 3.1 s untergehen, danach Brunnen
  const END = D.well + 3.2;

  function poseDrown(k: number, time: number) {
    // Arme schießen sofort nach oben und rudern
    const rise = ease(span(time, 0.0, 0.45));
    for (const [s, A] of [[-1, L], [1, R]] as const) {
      const ph = time * (k < 0.6 ? 9 : 5) + (s > 0 ? 1.4 : 0);
      A.arm.position.set(s * (0.2 + 0.05 * Math.sin(ph * 0.5)), -0.85 + rise * 0.55 + 0.06 * Math.sin(ph), -0.55);
      A.arm.rotation.set(-0.28 + 0.22 * Math.sin(ph * 0.8), 0, -s * (0.18 + 0.28 * Math.sin(ph)));
      A.hand.rotation.set(0.25 * Math.sin(ph + 1), 0, 0);
      A.fingers.forEach((f, i) => (f.rotation.x = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(ph * 1.6 + i))));
    }
  }
  function poseClimb(k: number) {
    // Hände greifen vorne den Brunnenrand, drücken dann nach unten, verschwinden
    const reach = ease(span(k, 0.0, 0.25)), push = ease(span(k, 0.35, 0.8)), out = ease(span(k, 0.82, 1));
    for (const [s, A] of [[-1, L], [1, R]] as const) {
      A.arm.position.set(s * 0.28, -0.42 - (1 - reach) * 0.35 - push * 0.3 - out * 0.45, -0.38 + push * 0.16);
      A.arm.rotation.set(-1.25 + (1 - reach) * 0.9 + push * 0.5, s * 0.08, -s * 0.1);
      A.hand.rotation.set(-0.55, 0, 0);
      A.fingers.forEach((f) => (f.rotation.x = 0.9 + reach * 0.4));
    }
  }

  return {
    get active() { return t >= 0; },
    start() {
      if (t >= 0) return;
      t = 0;
      from.copy(opts.camera.position);
      const d = new THREE.Vector3();
      opts.camera.getWorldDirection(d);
      fromYaw = Math.atan2(-d.x, -d.z);
      arms.visible = true;
      document.body.classList.add('drowning');
      ov.classList.add('on', 'under');
      opts.onSplash?.(true);
    },
    update(dt, camera, look) {
      if (t < 0) return null;
      t += dt;
      const fwdX = -Math.sin(fromYaw), fwdZ = -Math.cos(fromYaw);
      if (t < D.well) {
        // ---------- Untergehen
        const k = t / D.sink;
        const sink = ease(span(t, 0, 1.6));
        camera.position.set(from.x + fwdX * sink * 0.8, opts.eye - sink * 1.35 - 0.12 * Math.sin(t * 7) * (1 - sink), from.z + fwdZ * sink * 0.8);
        const pitch = 0.08 + ease(span(t, 0.3, 1.8)) * 0.75;   // Blick nach oben zur Oberfläche
        look.set(camera.position.x + fwdX * Math.cos(pitch) * 10, camera.position.y + Math.sin(pitch) * 10, camera.position.z + fwdZ * Math.cos(pitch) * 10);
        setV('--level', ease(span(t, 0.0, 1.1)) * 1.15);
        setV('--dark', ease(span(t, 1.5, D.sink)));
        poseDrown(k, t);
        arms.visible = t < D.sink - 0.15;
        if (t + dt >= D.well) opts.onSplash?.(false);
        return { done: false };
      }
      // ---------- Im Brunnen auftauchen und herausklettern
      const w = t - D.well;
      if (!ov.classList.contains('surfaced')) { ov.classList.add('surfaced'); ov.classList.remove('under'); arms.visible = true; }
      setV('--dark', 1 - ease(span(w, 0, 0.5)));
      setV('--level', 1.15 * (1 - ease(span(w, 0.05, 0.6))));
      const lookUp = 1 - ease(span(w, 0.6, 1.3));                       // erst steil nach oben (Dach, Seil, Eimer), dann nach vorne
      const pull = ease(span(w, 1.25, 2.25)), hop = ease(span(w, 2.3, 3.1));
      camera.position.set(0, WELL0.y + pull * 0.95 - hop * (WELL0.y + 0.95 - opts.eye) + Math.sin(Math.PI * hop) * 0.18,
        WELL0.z + pull * 0.95 + hop * 0.85);
      // Blick: erst hoch zu Kurbel und Eimer (man steckt im Brunnen), dann nach vorne zum Dorfplatz (+Z)
      const up = tmp.set(0, 2.45, -0.15).sub(camera.position).normalize();
      const fwdPitch = -0.3 * ease(span(w, 1.0, 1.6)) * (1 - hop);
      const fwd = tmp2.set(0, Math.sin(fwdPitch), Math.cos(fwdPitch));
      look.copy(camera.position).addScaledVector(up.multiplyScalar(lookUp).addScaledVector(fwd, 1 - lookUp).normalize(), 10);
      poseClimb(span(w, 0.9, 2.9));
      arms.visible = w > 0.85 && w < 2.95;
      ov.classList.toggle('msg', w > 0.6 && w < 3.1);
      if (t >= END) {
        t = -1;
        arms.visible = false;
        ov.classList.remove('on', 'surfaced', 'msg');
        document.body.classList.remove('drowning');
        setV('--level', 0); setV('--dark', 0);
        opts.onDone?.();
        return { done: true, pos: new THREE.Vector3(0, opts.eye, WELL0.z + 0.95 + 0.85), yaw: Math.PI };
      }
      return { done: false };
    },
  };
}
