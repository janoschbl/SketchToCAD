// Wegweiser im Dorf: ein echter 3D-Pfeil als Quest-Guide und Holzschilder an Brunnen und Museum.
// Der Pfeil schwebt vor dir und zeigt zum nächsten Ziel; bist du nah dran, verschwindet er und das Schild übernimmt.
import * as THREE from 'three';

const WOOD = '#8a5634', WOOD_DARK = '#503d48', PAPER = '#fbf3e2', INK = '#3a2418', ACCENT = '#ff5a2e';
const ROUND = '"Fredoka", "Nunito", ui-rounded, system-ui, sans-serif';

/** Schildtafel: Holzrahmen, helle Fläche, runde Schrift (wird neu gezeichnet, sobald Fredoka geladen ist) */
function plate(lines: { text: string; size: number; color?: string }[], w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.round(512 * (h / w));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = () => {
    const c = cv.getContext('2d')!;
    c.fillStyle = PAPER; c.fillRect(0, 0, cv.width, cv.height);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
    let y = (cv.height - total) / 2;
    for (const l of lines) {
      c.font = `600 ${l.size}px ${ROUND}`;
      c.fillStyle = l.color ?? INK;
      c.fillText(l.text, cv.width / 2, y + (l.size * 1.15) / 2 + 2);
      y += l.size * 1.15;
    }
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load(`600 80px Fredoka`).then(draw).catch(() => {});
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
}

function box(w: number, h: number, d: number, color: string) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
  m.castShadow = true;
  return m;
}

/** Schild mit Rahmen, beidseitig beschriftet */
function board(lines: Parameters<typeof plate>[0], w: number, h: number) {
  const g = new THREE.Group();
  g.add(box(w + 0.08, h + 0.08, 0.05, WOOD));
  const face = plate(lines, w, h);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
    p.position.z = s * 0.027; p.rotation.y = s < 0 ? Math.PI : 0;
    g.add(p);
  }
  return g;
}

/** Hängeschild am Brunnen: hängt an zwei Seilen unter dem Dachfirst, über dem Eimer, und dreht sich langsam zu dir */
export function wellSign(touch: boolean) {
  const g = new THREE.Group();
  const b = board([{ text: touch ? 'Tap me!' : 'Click me!', size: 104 }], 0.86, 0.34);
  g.add(b);
  for (const x of [-0.3, 0.3]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4), new THREE.MeshStandardMaterial({ color: '#d6c3a0' }));
    rope.position.set(x, 0.38, 0);
    g.add(rope);
  }
  g.position.set(0, 2.62, 0);   // zwischen Kurbelwelle (2.2) und Dachfirst (3.24)
  return g;
}

/** Aufsteller (Kundenstopper) vor der Museumstür */
export function museumSign(touch: boolean) {
  const g = new THREE.Group();
  const lines = [{ text: 'Demo inside', size: 80 }, { text: touch ? 'Tap here' : 'Click here', size: 96, color: ACCENT }];
  const front = board(lines, 0.86, 0.7), back = board(lines, 0.86, 0.7);
  front.position.set(0, 0.7, 0.18); front.rotation.x = -0.24;
  back.position.set(0, 0.7, -0.18); back.rotation.set(0.24, Math.PI, 0);
  const foot = (z: number) => { const f = box(0.94, 0.05, 0.05, WOOD_DARK); f.position.set(0, 0.03, z); return f; };
  g.add(front, back, foot(0.3), foot(-0.3));
  return g;
}

/** Quest-Pfeil: Pfeilform, extrudiert; Spitze zeigt entlang -z */
export function questArrow() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5); s.lineTo(0.42, -0.02); s.lineTo(0.16, -0.02); s.lineTo(0.16, 0.42); s.lineTo(-0.16, 0.42); s.lineTo(-0.16, -0.02); s.lineTo(-0.42, -0.02); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  geo.translate(0, 0, -0.06);
  geo.rotateX(Math.PI / 2);    // flach legen: Spitze zeigt nach -z
  const mesh = new THREE.Mesh(geo, [
    // immer obenauf gezeichnet: der Pfeil soll nie in einer Wand oder im Brunnen verschwinden
    new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.55, flatShading: true, depthTest: false, depthWrite: false }),
    new THREE.MeshStandardMaterial({ color: '#d8451f', roughness: 0.6, flatShading: true, depthTest: false, depthWrite: false }),
  ]);
  mesh.renderOrder = 10;
  const g = new THREE.Group();
  g.add(mesh);
  g.visible = false;
  return g;
}

const tmpQ = new THREE.Quaternion(), tilt = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();

/**
 * Pfeil pro Frame bewegen: knapp über dem Boden vor dir, zeigt in Richtung Ziel.
 * Nah am Ziel (< 4,5 m) schrumpft er weg, dort zeigt das Schild, wo man klicken kann.
 */
export function updateArrow(arrow: THREE.Group, camera: THREE.Camera, target: THREE.Vector3 | null, t: number, dt: number) {
  if (!target) { arrow.visible = false; arrow.userData.init = false; return; }
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const dx = target.x - camera.position.x, dz = target.z - camera.position.z, dist = Math.hypot(dx, dz);
  const near = dist < 4.5;
  want.copy(camera.position).addScaledVector(fwd, 2.7); want.y = 0.2 + Math.sin(t * 2.4) * 0.03;
  tmpE.set(0, Math.atan2(-dx, -dz), 0);         // zeigt flach zum Ziel …
  tmpQ.setFromEuler(tmpE);
  // … und kippt mit der Oberseite zu dir, damit die Pfeilform immer gut lesbar ist
  right.set(-fwd.z, 0, fwd.x);
  tmpQ.premultiply(tilt.setFromAxisAngle(right, 0.75));
  if (!arrow.userData.init) { arrow.position.copy(want); arrow.quaternion.copy(tmpQ); arrow.scale.setScalar(0); arrow.userData.init = true; }
  const k = 1 - Math.exp(-dt * 9);
  arrow.position.lerp(want, k);
  arrow.quaternion.slerp(tmpQ, k);
  // nah am Ziel übernimmt das Schild („Click me!“) → Pfeil schrumpft weg
  const sc = THREE.MathUtils.lerp(arrow.scale.x, near ? 0 : 0.42, 1 - Math.exp(-dt * 8));
  arrow.scale.setScalar(sc);
  arrow.visible = sc > 0.01;
}
