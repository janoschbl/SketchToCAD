// Easteregg „Splash“: Wer ins tiefe Wasser läuft, rutscht aus, kippt nach hinten ins Wasser, saust durch eine
// Röhren-Wasserrutsche unter dem Dorf hindurch und schießt aus dem Dorfbrunnen wieder heraus – die Hände greifen
// den Rand, man zieht sich heraus. Alles in Ich-Perspektive; Wasser/Spritzer sind ein DOM-Overlay.
import * as THREE from 'three';

const SKIN = '#e9b48f', SLEEVE = '#4f74b8', CUFF = '#3c5a92';

function std(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
}

/** Ein Unterarm mit Hand (Ellbogen im Ursprung, Arm zeigt entlang +Y). Nur beim Herausklettern sichtbar. */
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

/** Röhren-Wasserrutsche tief unter der Insel: Spirale mit Schlenkern, innen orange mit hellen Ringen. */
function makeSlide() {
  const pts: THREE.Vector3[] = [];
  const turns = 2.3, n = 28, R = 7, drop = 34;
  for (let i = 0; i <= n; i++) {
    const k = i / n, a = k * turns * Math.PI * 2;
    const r = R + Math.sin(k * 9) * 1.6;
    pts.push(new THREE.Vector3(Math.cos(a) * r, -80 - k * drop + Math.sin(k * 13) * 0.8, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d')!;
  // v = rund um die Röhre: unten (Wasser) türkis, Seiten/oben orange; u = entlang: helle Ringe für Tempo
  const gv = c.createLinearGradient(0, 0, 0, 128);
  gv.addColorStop(0, '#ff9a4a'); gv.addColorStop(0.3, '#ff7a2e'); gv.addColorStop(0.42, '#3fc1cf'); gv.addColorStop(0.58, '#3fc1cf');
  gv.addColorStop(0.7, '#ff7a2e'); gv.addColorStop(1, '#ff9a4a');
  c.fillStyle = gv; c.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 512; x += 64) { c.fillStyle = 'rgba(255,245,225,0.55)'; c.fillRect(x, 0, 10, 128); }
  c.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 40; i++) c.fillRect(Math.random() * 512, 44 + Math.random() * 40, 18 + Math.random() * 30, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 1);
  const geo = new THREE.TubeGeometry(curve, 400, 1.25, 18, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, curve, tex };
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

export function createDrown(opts: { camera: THREE.PerspectiveCamera; scene: THREE.Scene; eye: number; onSplash?: (big: boolean) => void; onWhoosh?: (dur: number) => void; onDone?: () => void }): Drown {
  const L = makeArm(-1), R = makeArm(1);
  const arms = new THREE.Group();
  arms.add(L.arm, R.arm);
  arms.visible = false;
  opts.camera.add(arms);
  const slide = makeSlide();
  opts.scene.add(slide.mesh);

  // Overlay: Wasserlinie, Spritzer/Blasen, Abblende, Meldung
  const ov = document.createElement('div');
  ov.className = 'vdrown';
  ov.innerHTML = `<div class="vdrown-water"><svg class="vdrown-wave" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 C 100 6, 200 36, 300 20 S 500 6, 600 20 S 800 36, 900 20 S 1100 6, 1200 20 V40 H0 Z"/></svg><div class="vdrown-rays"></div></div>
    <div class="vdrown-bubbles">${Array.from({ length: 16 }, (_, i) => `<i style="left:${(6 + ((i * 37) % 88)).toFixed(0)}%;animation-delay:${((i * 0.23) % 1.9).toFixed(2)}s;width:${6 + (i % 4) * 4}px;height:${6 + (i % 4) * 4}px"></i>`).join('')}</div>
    <div class="vdrown-speed"></div>
    <div class="vdrown-dark"></div>
    <p class="vdrown-msg">Splash! Good thing there’s a well.</p>`;
  document.body.appendChild(ov);
  const setV = (k: string, v: number) => ov.style.setProperty(k, v.toFixed(3));

  let t = -1;
  const from = new THREE.Vector3();
  let fromYaw = 0;
  const WELL0 = new THREE.Vector3(0, 1.12, 0.42);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // Zeitplan (s): Ausrutschen → Platsch → Rutsche → Brunnen
  const T = { slip: 0.95, splash: 1.35, slide: 4.0, well: 4.25 };
  const END = T.well + 3.2;

  function poseClimb(k: number) {
    // Hände kommen vom unteren Bildrand, greifen vorne den Brunnenrand, drücken nach unten, verschwinden
    const reach = ease(span(k, 0.0, 0.25)), push = ease(span(k, 0.35, 0.8)), out = ease(span(k, 0.82, 1));
    for (const [s, A] of [[-1, L], [1, R]] as const) {
      A.arm.position.set(s * 0.28, -0.42 - (1 - reach) * 0.35 - push * 0.3 - out * 0.45, -0.38 + push * 0.16);
      A.arm.rotation.set(-1.25 + (1 - reach) * 0.9 + push * 0.5, s * 0.08, -s * 0.1);
      A.hand.rotation.set(-0.55, 0, 0);
      A.fingers.forEach((f) => (f.rotation.x = 0.9 + reach * 0.4));
    }
  }

  function finish() {
    t = -1;
    arms.visible = false;
    slide.mesh.visible = false;
    opts.camera.up.copy(UP);
    ov.className = 'vdrown';
    setV('--level', 0); setV('--dark', 0); setV('--flash', 0);
    document.body.classList.remove('drowning');
    opts.onDone?.();
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
      document.body.classList.add('drowning');
      ov.classList.add('on');
    },
    update(dt, camera, look) {
      if (t < 0) return null;
      const prev = t;
      t += dt;
      const fwdX = -Math.sin(fromYaw), fwdZ = -Math.cos(fromYaw);
      camera.up.copy(UP);

      if (t < T.splash) {
        // ---------- Ausrutschen: kleiner Schritt nach vorn, Füße rutschen weg, Kippen nach hinten (Blick in den Himmel)
        const lurch = Math.sin(Math.PI * span(t, 0, 0.35)) * 0.12;
        const fall = ease(span(t, 0.25, T.slip));
        const back = fall * 0.55;                                   // Füße rutschen nach vorn, Oberkörper kippt nach hinten
        camera.position.set(from.x + fwdX * (0.3 + lurch - back), opts.eye - fall * (opts.eye - 0.6), from.z + fwdZ * (0.3 + lurch - back));
        const pitch = -0.05 + fall * 1.15 + Math.sin(t * 22) * 0.02 * (1 - fall);
        look.set(camera.position.x + fwdX * Math.cos(pitch) * 10, camera.position.y + Math.sin(pitch) * 10, camera.position.z + fwdZ * Math.cos(pitch) * 10);
        // leichtes Wegkippen zur Seite
        tmp.set(fwdZ, 0, -fwdX).multiplyScalar(0.35 * fall);
        camera.up.set(0, 1, 0).add(tmp).normalize();
        setV('--level', ease(span(t, T.slip - 0.1, T.splash)) * 1.2);
        if (prev < T.slip - 0.1 && t >= T.slip - 0.1) { opts.onSplash?.(true); ov.classList.add('under'); }
        return { done: false };
      }

      if (t < T.slide) {
        // ---------- Röhrenrutsche: mit Tempo durch Kurven, Schräglage nach außen
        if (!slide.mesh.visible) { slide.mesh.visible = true; ov.classList.add('sliding'); ov.classList.remove('under'); opts.onWhoosh?.(T.slide - T.splash); }
        const k = span(t, T.splash, T.slide);
        const u = Math.min(0.985, 0.02 + ease(k) * 0.96);
        const p = slide.curve.getPointAt(u, tmp);
        const tan = slide.curve.getTangentAt(u, tmp2).normalize();
        const tanB = slide.curve.getTangentAt(Math.min(1, u + 0.02), tmp3).normalize();
        // „unten“ in der Röhre = Welt-unten senkrecht zur Fahrtrichtung, zur Kurvenaußenseite geneigt
        const down = new THREE.Vector3(0, -1, 0).addScaledVector(tan, tan.y).normalize();
        const outward = tanB.clone().sub(tan).multiplyScalar(-14);
        const bank = down.clone().add(outward).normalize();
        camera.position.copy(p).addScaledVector(bank, 0.62);
        look.copy(slide.curve.getPointAt(Math.min(1, u + 0.025))).addScaledVector(bank, 0.5);
        camera.up.copy(bank).negate();
        setV('--level', THREE.MathUtils.lerp(1.2, 0.2, ease(span(t, T.splash, T.splash + 0.35))));
        setV('--flash', ease(span(t, T.slide - 0.3, T.slide)));
        return { done: false };
      }

      // ---------- Aus dem Brunnen schießen und herausklettern
      const w = t - T.well;
      if (slide.mesh.visible) { slide.mesh.visible = false; ov.classList.remove('sliding'); ov.classList.add('surfaced'); opts.onSplash?.(false); }
      setV('--flash', 1 - ease(span(t, T.slide, T.well + 0.35)));
      setV('--level', 0.9 * (1 - ease(span(w, 0.0, 0.55))));
      const lookUp = 1 - ease(span(w, 0.6, 1.3));
      const pull = ease(span(w, 1.25, 2.25)), hop = ease(span(w, 2.3, 3.1));
      const popUp = Math.sin(Math.PI * span(w, -0.25, 0.45)) * 0.35;   // kurz aus dem Wasser „hochschießen“
      camera.position.set(0, WELL0.y + popUp + pull * 0.95 - hop * (WELL0.y + 0.95 - opts.eye) + Math.sin(Math.PI * hop) * 0.18,
        WELL0.z + pull * 0.95 + hop * 0.85);
      // Blick: erst hoch zu Kurbel und Eimer (man steckt im Brunnen), dann nach vorne zum Dorfplatz (+Z)
      const up = tmp.set(0, 2.45, -0.15).sub(camera.position).normalize();
      const fwdPitch = -0.3 * ease(span(w, 1.0, 1.6)) * (1 - hop);
      const fwd = tmp2.set(0, Math.sin(fwdPitch), Math.cos(fwdPitch));
      look.copy(camera.position).addScaledVector(up.multiplyScalar(lookUp).addScaledVector(fwd, 1 - lookUp).normalize(), 10);
      poseClimb(span(w, 0.9, 2.9));
      arms.visible = w > 0.85 && w < 2.95;
      ov.classList.toggle('msg', w > 0.5 && w < 3.0);
      if (t >= END) {
        finish();
        return { done: true, pos: new THREE.Vector3(0, opts.eye, WELL0.z + 0.95 + 0.85), yaw: Math.PI };
      }
      return { done: false };
    },
  };
}
