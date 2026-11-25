// Brunnenkarte: echte Verwandlung Skizze → 3D-Modell.
// Die Kinderzeichnung (rosa Schmetterling) und das Modell, das unsere Pipeline daraus gebaut hat, liegen übereinander.
// Eine Linie fährt von unten nach oben: darunter ist schon das Modell, darüber noch die Zeichnung.
// Danach erwacht der Schmetterling: Er dreht sich in die Seitenansicht und schwebt ruhig, die Flügel schlagen langsam
// (Vertex-Shader dreht beide Hälften um die Körperachse).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL = '/well-demo/butterfly.glb';
const SKETCH = '/well-demo/sketch.png';
const LOOP = 14;                      // Sekunden pro Durchlauf
// Ablauf (Sekunden): Zeichnen · Pause · Verwandeln · Erwachen · Schweben · Ausblenden
const T_DRAW = 2.8, T_SWEEP0 = 3.4, T_SWEEP1 = 5.6, T_WAKE = 6.4, T_OUT0 = 12.8, T_OUT1 = 13.4;
const PEN = '#1d3b8f';

export type Stage = 'sketch' | 'model';
const ease = (k: number) => { k = Math.min(1, Math.max(0, k)); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };

export function mountDemo(canvas: HTMLCanvasElement, onStage: (s: Stage) => void, reduce: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // Licht mit Richtung statt flachem Rundumlicht: Hauptlicht schräg von oben, warmes Gegenlicht für die Kanten
  scene.add(new THREE.HemisphereLight('#fff4e6', '#6b4a5a', 1.0));
  const sun = new THREE.DirectionalLight('#ffffff', 2.6);
  sun.position.set(1.8, 3, 2.6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#ffd2a8', 1.4);
  rim.position.set(-2.5, 1.5, -2);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 5.2);

  // Schnittebenen: Modell nur unterhalb der Linie, Zeichnung nur oberhalb
  const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const drawn = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);    // beim Zeichnen: sichtbar ist nur, was oberhalb dieser Grenze liegt
  const clipAbove = [above], clipDrawn = [drawn];
  const pivot = new THREE.Group();
  scene.add(pivot);

  const sketchMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, clippingPlanes: [above], opacity: 0 });
  const sketch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sketchMat);
  scene.add(sketch);
  const lineMat = new THREE.MeshBasicMaterial({ color: PEN, transparent: true, opacity: 0 });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.025), lineMat);
  line.position.z = 0.6;
  scene.add(line);

  let modelMat: THREE.MeshStandardMaterial | null = null;
  const flap = { value: 0 };                       // Flügelwinkel (rad), wird pro Frame gesetzt
  const body = { value: new THREE.Vector4(0, 0, 0.04, 0.16) };   // Körpermitte (x, z) und Übergang Körper → Flügel (|z| von … bis)
  let minY = -1, maxY = 1, ready = false, raf = 0, stage: Stage | null = null, disposed = false;
  const t0 = performance.now();
  const pos = new THREE.Vector3(), restQ = new THREE.Quaternion(), flightQ = new THREE.Quaternion(), tmpQ = new THREE.Quaternion();
  const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

  Promise.all([
    new GLTFLoader().loadAsync(MODEL),
    new THREE.TextureLoader().loadAsync(SKETCH),
  ]).then(([gltf, tex]) => {
    if (disposed) return;
    const model = gltf.scene;
    modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, clippingPlanes: [below], transparent: true });
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = modelMat!;
      // Die Pipeline liefert blasse Farben → Sättigung und Kontrast anheben (einmal beim Laden)
      const col = m.geometry.attributes.color as THREE.BufferAttribute | undefined;
      if (col) {
        const c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < col.count; i++) {
          c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl);
          c.setHSL(hsl.h, Math.min(1, hsl.s * 1.9 + 0.08), Math.min(0.92, Math.max(0.06, 0.5 + (hsl.l - 0.5) * 1.35 - 0.07)));
          col.setXYZ(i, c.r, c.g, c.b);
        }
        col.needsUpdate = true;
      }
      // Flügelspannweite liegt in Geometrie-Koordinaten entlang z, Körper entlang y
      m.geometry.computeBoundingBox();
      const gb = m.geometry.boundingBox!, gc = gb.getCenter(new THREE.Vector3()), half = (gb.max.z - gb.min.z) / 2;
      body.value.set(gc.x, gc.z, half * 0.06, half * 0.3);
    });
    // Flügelschlag im Vertex-Shader: alles außerhalb des Körpers dreht sich um die Körperachse, links und rechts gegengleich
    modelMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFlap = flap; sh.uniforms.uBody = body;
      const rot = (v: string, src: string) => `
        { vec2 rel = ${src}.xz - uBody.xy; float side = sign(rel.y);
          float a = side * uFlap * smoothstep(uBody.z, uBody.w, abs(rel.y));
          float c = cos(a), s = sin(a);
          ${v} = vec3(${v}.x * c + ${v}.z * s, ${v}.y, -${v}.x * s + ${v}.z * c); }`;
      sh.vertexShader = 'uniform float uFlap;\nuniform vec4 uBody;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + rot('objectNormal', 'position'))
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec2 rel = transformed.xz - uBody.xy; float side = sign(rel.y);
          float a = side * uFlap * smoothstep(uBody.z, uBody.w, abs(rel.y));
          float c = cos(a), s = sin(a);
          transformed.xz = uBody.xy + vec2(rel.x * c + rel.y * s, -rel.x * s + rel.y * c); }`);
    };
    // Die Pipeline legt die Flügelfläche entlang z → um 90° drehen, damit die Oberseite zur Kamera zeigt
    const raw = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (raw.z > raw.x) model.rotation.y = -Math.PI / 2;
    model.updateMatrixWorld(true);
    // auf ~2 Einheiten Höhe normieren und mittig setzen
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = 2.1 / Math.max(size.x, size.y);
    model.scale.setScalar(k);
    model.position.copy(c).multiplyScalar(-k);
    pivot.add(model);
    minY = -size.y * k / 2; maxY = size.y * k / 2;
    // Zeichnung genau so groß wie die Vorderansicht des Modells
    tex.colorSpace = THREE.SRGBColorSpace;
    sketchMat.map = tex; sketchMat.needsUpdate = true;
    const img = tex.image as HTMLImageElement;
    const sh = size.y * k * 1.12;
    sketch.scale.set(sh * (img.width / img.height), sh, 1);
    sketch.position.z = size.z * k * 0.5;
    line.scale.x = size.x * k * 1.25;
    ready = true;
  }).catch(() => { /* ohne Modell bleibt die Fläche einfach leer */ });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function setStage(s: Stage) { if (s !== stage) { stage = s; onStage(s); } }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    resize();
    if (!ready || !modelMat) { renderer.render(scene, camera); return; }
    const t = reduce ? 6 : ((performance.now() - t0) / 1000) % LOOP;
    const span = maxY - minY;
    const draw = ease(t / T_DRAW);                               // Zeichnung entsteht von oben nach unten (langsam, wie mit der Hand)
    const sweep = ease((t - T_SWEEP0) / (T_SWEEP1 - T_SWEEP0));   // Linie fährt hoch und verwandelt
    const out = ease((t - T_OUT0) / (T_OUT1 - T_OUT0));
    const h = sweep >= 1 ? 1e3 : minY - 0.05 + sweep * (span + 0.3);   // nach der Verwandlung nichts mehr abschneiden
    below.constant = h; above.constant = -h;
    drawn.constant = -(maxY + 0.1 - draw * (span + 0.3));       // Grenze wandert von oben nach unten
    sketchMat.clippingPlanes = sweep > 0 ? clipAbove : clipDrawn;
    sketchMat.opacity = sweep >= 1 ? 0 : 1;                       // voll deckend, das Zeichnen übernimmt die Schnittebene
    modelMat.opacity = 1 - out;
    lineMat.opacity = sweep > 0 && sweep < 1 ? 1 : 0;
    line.position.y = Math.min(h, maxY + 0.2);

    // Erwachen und Schweben: Der Schmetterling dreht sich ruhig in die Seitenansicht und schwebt auf der Stelle,
    // die Flügel schlagen ruhig und gleichmäßig (anderthalb Mal pro Sekunde), beim Abschlag hebt er sich ein kleines Stück
    const wake = ease((t - T_SWEEP1 - 0.2) / (T_WAKE - T_SWEEP1 + 0.6));
    const ft = Math.max(0, t - T_SWEEP1 - 0.2);
    const phase = ft * Math.PI * 2 * 1.5;
    const beat = 0.5 - 0.5 * Math.cos(phase);                    // 0 = Flügel unten, 1 = oben
    flap.value = reduce ? 0.35 : wake * (0.12 + 0.62 * beat);
    const fly = ease((t - T_WAKE + 0.4) / 2.2);                    // langsam in die Flughaltung drehen
    const tau = Math.max(0, t - T_WAKE);
    pos.set(0.04 * Math.sin(tau * 0.35), 0.05 + 0.045 * Math.sin(phase - 1.2) * wake, 0).multiplyScalar(fly);
    // Seitenansicht: Körper waagerecht (Kopf nach links), Rücken nach oben und etwas zur Kamera, ganz leichtes Pendeln
    flightQ.setFromAxisAngle(Z_AXIS, Math.PI / 2)
      .premultiply(tmpQ.setFromAxisAngle(X_AXIS, -1.0))
      .premultiply(tmpQ.setFromAxisAngle(Y_AXIS, 0.38 + 0.08 * Math.sin(tau * 0.3)));
    pivot.quaternion.copy(restQ).slerp(flightQ, fly);
    pivot.position.copy(pos);
    pivot.scale.setScalar(1 - 0.12 * fly);
    setStage(sweep > 0.5 && out < 0.5 ? 'model' : 'sketch');
    renderer.render(scene, camera);
  }
  frame();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    pivot.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    sketchMat.map?.dispose(); sketchMat.dispose(); lineMat.dispose(); modelMat?.dispose();
    renderer.dispose();
  };
}
