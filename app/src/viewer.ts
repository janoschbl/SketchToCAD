import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface ModelScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group; // alles, was bearbeitbar ist
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
  /** Bildschirm-Rechteck (clientX/Y) – nur fürs Gizmo, wird von der Engine gesetzt */
  rect: { left: number; top: number; width: number; height: number };
  tc: TransformControls | null;
  proxy: HTMLElement | null;
  dirty: boolean;
  cache: HTMLCanvasElement | null;
  cacheKey: string;
}

/** Ein gemeinsamer WebGL-Renderer für alle 3D-Objekte auf dem Canvas. */
export class Viewer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

  constructor() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
  }

  private base(): ModelScene {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 2.4);
    dl.position.set(5, 8, 6);
    scene.add(dl);
    const root = new THREE.Group();
    scene.add(root);
    const ms: ModelScene = {
      scene, root, camera: new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 200), target: new THREE.Vector3(0, 0, 0),
      yaw: 0.8, pitch: 0.45, dist: 8, rect: { left: 0, top: 0, width: 1, height: 1 }, tc: null, proxy: null, dirty: true, cache: null, cacheKey: '',
    };
    this.applyCam(ms);
    return ms;
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  applyCam(ms: ModelScene) {
    const { yaw, pitch, dist, target } = ms;
    ms.camera.position.set(target.x + dist * Math.cos(pitch) * Math.sin(yaw), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch) * Math.cos(yaw));
    ms.camera.lookAt(target);
    ms.dirty = true;
  }

  orbit(ms: ModelScene, dx: number, dy: number) {
    ms.yaw -= dx * 0.01;
    ms.pitch = Math.max(-1.45, Math.min(1.45, ms.pitch + dy * 0.01));
    this.applyCam(ms);
  }

  dolly(ms: ModelScene, f: number) {
    ms.dist = Math.max(2, Math.min(60, ms.dist * f));
    this.applyCam(ms);
  }

  /** Ein einzelnes, frei stehendes Modell – Form wechselt mit dem Seed. */
  demo(seed: number): ModelScene {
    const ms = this.base();
    const hue = (seed * 0.137) % 1;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.65, 0.55), roughness: 0.45, metalness: 0.1 });
    const geos = [
      () => new THREE.BoxGeometry(2.6, 2.6, 2.6),
      () => new THREE.TorusKnotGeometry(1.3, 0.45, 120, 20),
      () => new THREE.SphereGeometry(1.5, 40, 28),
      () => new THREE.ConeGeometry(1.5, 3, 40),
      () => new THREE.TorusGeometry(1.4, 0.55, 24, 48),
      () => new THREE.IcosahedronGeometry(1.7, 0),
    ];
    ms.root.add(new THREE.Mesh(geos[Math.abs(Math.round(seed)) % geos.length](), mat));
    return ms;
  }

  /** Dreiecks-Mesh (z-oben, wie MeshPad es liefert) → Szene: aufgerichtet, zentriert, auf Größe 3,5 normiert. */
  fromMesh(V: number[], F: number[]): ModelScene {
    const ms = this.base();
    const pos = new Float32Array(V.length);
    for (let i = 0; i < V.length; i += 3) { pos[i] = V[i]; pos[i + 1] = V[i + 2]; pos[i + 2] = -V[i + 1]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(F);
    geo.computeBoundingBox();
    const box = geo.boundingBox!, size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 3.5 / Math.max(size.x, size.y, size.z, 1e-6);
    geo.translate(-c.x, -c.y, -c.z); geo.scale(s, s, s);
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9d8cff, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(flat, mat);
    mesh.name = 'magic';
    ms.root.add(mesh);
    return ms;
  }

  /** Objekte der Szene als GLB – für den Upload (Sync) und andere Clients. */
  toGLB(ms: ModelScene): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(ms.root.children[0], (r) => resolve(r as ArrayBuffer), reject, { binary: true });
    });
  }

  loadGLB(buf: ArrayBuffer): Promise<ModelScene> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, '', (gltf) => {
        const ms = this.base();
        const group = gltf.scene;
        group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const s = 3.5 / Math.max(size.x, size.y, size.z || 1);
        while (group.children.length) {
          const c = group.children[0];
          c.applyMatrix4(group.matrix);
          ms.root.add(c);
        }
        ms.root.scale.setScalar(s);
        ms.root.position.set(-center.x * s, -center.y * s, -center.z * s);
        resolve(ms);
      }, reject);
    });
  }

  /** Rendert das Modell in sein Cache-Canvas (nur wenn nötig). */
  render(ms: ModelScene, aspect: number, pw: number): HTMLCanvasElement {
    const ph = Math.max(1, Math.round(pw / aspect));
    const key = `${pw}x${ph}`;
    if (ms.cache && !ms.dirty && ms.cacheKey === key) return ms.cache;
    this.renderer.setSize(pw, ph, false);
    ms.camera.aspect = aspect;
    ms.camera.updateProjectionMatrix();
    this.renderer.render(ms.scene, ms.camera);
    if (!ms.cache) ms.cache = document.createElement('canvas');
    if (ms.cache.width !== pw || ms.cache.height !== ph) { ms.cache.width = pw; ms.cache.height = ph; }
    const c = ms.cache.getContext('2d')!;
    c.clearRect(0, 0, pw, ph);
    c.drawImage(this.renderer.domElement, 0, 0);
    ms.cacheKey = key;
    ms.dirty = false;
    return ms.cache;
  }

  // ---------- Gizmo & Auswahl direkt auf dem Canvas ----------
  /** TransformControls hängt an einem unsichtbaren Proxy-Element; die Engine leitet Pointer-Events weiter. */
  ensureTC(ms: ModelScene, onChange: () => void): TransformControls {
    if (ms.tc) return ms.tc;
    const proxy = document.createElement('div') as any;
    proxy.getBoundingClientRect = () => ({ ...ms.rect, x: ms.rect.left, y: ms.rect.top, right: ms.rect.left + ms.rect.width, bottom: ms.rect.top + ms.rect.height });
    proxy.setPointerCapture = () => {};
    proxy.releasePointerCapture = () => {};
    const tc = new TransformControls(ms.camera, proxy);
    tc.addEventListener('change', () => { ms.dirty = true; onChange(); });
    ms.scene.add(tc.getHelper());
    ms.tc = tc;
    ms.proxy = proxy;
    return tc;
  }

  pick(ms: ModelScene, nx: number, ny: number): THREE.Object3D | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), ms.camera);
    const hit = ray.intersectObjects(ms.root.children, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D = hit.object;
    while (o.parent && o.parent !== ms.root) o = o.parent;
    return o;
  }
}
