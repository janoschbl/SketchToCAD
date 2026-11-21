import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Gleicher Namens-Filter wie `_safe` im Prompt-Editor (prompt-editor/app/model_io.py). */
function safeName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'teil';
  return /^\d/.test(s) ? `t_${s}` : s;
}

/**
 * Reine Container-Knoten ohne eigene Geometrie (z. B. „world“ aus trimesh) auflösen,
 * damit jedes Teil des Modells einzeln anwählbar ist. Die Transformation des Containers
 * wandert auf seine Kinder, das Aussehen bleibt gleich.
 */
function unwrap(root: THREE.Object3D) {
  for (let i = 0; i < 4 && root.children.length === 1; i++) {
    const only = root.children[0];
    if ((only as THREE.Mesh).isMesh || !only.children.length) break;
    only.updateMatrix();
    for (const k of [...only.children]) { k.applyMatrix4(only.matrix); root.add(k); }
    root.remove(only);
  }
}

export interface ModelScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group; // alles, was bearbeitbar ist
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
  dirty: boolean;
  cache: HTMLCanvasElement | null;
  cacheKey: string;
  /** Größte Ausdehnung beim letzten Normieren (refit) – erkennt Größenänderungen durch andere Clients. */
  fitMax?: number;
  /** Blob-Hash dieser Szene auf dem Sync-Server (nach dem Upload). */
  srcHash?: string;
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
      yaw: 0.8, pitch: 0.45, dist: 8, dirty: true, cache: null, cacheKey: '',
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
      const lit = this.unlight(ms);
      new GLTFExporter().parse(ms.root.children[0], (r) => { this.relight(lit); resolve(r as ArrayBuffer); }, (e) => { this.relight(lit); reject(e); }, { binary: true });
    });
  }

  loadGLB(buf: ArrayBuffer): Promise<ModelScene> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buf, '', (gltf) => {
        const ms = this.base();
        const group = gltf.scene;
        group.updateMatrixWorld(true);
        while (group.children.length) {
          const c = group.children[0];
          c.applyMatrix4(group.matrix);
          ms.root.add(c);
        }
        unwrap(ms.root);
        this.refit(ms);
        resolve(ms);
      }, reject);
    });
  }

  /**
   * Maße des Modells in Modelleinheiten (glTF: Meter), ohne die Anzeige-Normierung.
   * [x, y, z] der Bounding Box aller Teile.
   */
  localBox(ms: ModelScene, precise = true): THREE.Box3 {
    const { position, scale } = ms.root;
    const p = position.clone(), s = scale.clone();
    ms.root.position.set(0, 0, 0); ms.root.scale.setScalar(1);
    ms.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const c of ms.root.children) box.expandByObject(c, precise); // precise: exakt auch bei gedrehten Teilen
    ms.root.position.copy(p); ms.root.scale.copy(s);
    ms.root.updateMatrixWorld(true);
    return box;
  }

  /** Echte Maße (Meter): Länge = längste waagerechte Achse, Breite = andere waagerechte, Höhe = Y. */
  dims(ms: ModelScene): { laenge: number; breite: number; hoehe: number } {
    const box = this.localBox(ms);
    if (box.isEmpty()) return { laenge: 0, breite: 0, hoehe: 0 };
    const s = box.getSize(new THREE.Vector3());
    return { laenge: Math.max(s.x, s.z), breite: Math.min(s.x, s.z), hoehe: s.y };
  }

  /** Reine Darstellung: Modell zentrieren und auf 3,5 Einheiten normieren (die Geometrie bleibt in Metern). */
  refit(ms: ModelScene) {
    const box = this.localBox(ms);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const s = 3.5 / Math.max(size.x, size.y, size.z, 1e-9);
    ms.root.scale.setScalar(s);
    ms.root.position.set(-center.x * s, -center.y * s, -center.z * s);
    ms.fitMax = Math.max(size.x, size.y, size.z);
    ms.dirty = true;
  }

  /**
   * Nach fremden Änderungen an Teil-Lagen: neu normieren, wenn sich die Gesamtgröße deutlich geändert hat
   * (echte Größe gesetzt). Kleine Verschiebungen einzelner Teile lassen die Ansicht ruhig.
   */
  refitIfResized(ms: ModelScene) {
    const size = this.localBox(ms, false).getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) / (ms.fitMax || 1);
    if (r > 1.5 || r < 1 / 1.5) this.refit(ms);
  }

  /**
   * Gibt jedem Teil (Top-Level-Objekt) einen eindeutigen, sicheren Namen – derselbe Name,
   * unter dem es der Prompt-Editor kennt. Bestehende sichere Namen bleiben erhalten.
   * Gruppen heißen so wie ihr Name, ihre Meshes `<name>__<k>` (Muster `<name>__*`).
   */
  nameParts(ms: ModelScene) {
    const used = new Set<string>();
    const take = (want: string) => {
      const base = safeName(want);
      let n = base, k = 2;
      while (used.has(n.toLowerCase())) n = `${base}_${k++}`;
      used.add(n.toLowerCase());
      return n;
    };
    ms.root.children.forEach((o, i) => {
      o.name = take(o.name || `teil_${String(i + 1).padStart(2, '0')}`);
      if (!(o as THREE.Mesh).isMesh) {
        let k = 1;
        o.traverse((c) => { if (c !== o && (c as THREE.Mesh).isMesh) c.name = `${o.name}__${k++}`; });
      }
    });
  }

  /** Teilname bzw. *-Muster für den Prompt-Editor (nach nameParts). */
  partPattern(obj: THREE.Object3D): string {
    return (obj as THREE.Mesh).isMesh ? obj.name : `${obj.name}__*`;
  }

  /**
   * Alle Teile mit ihrer aktuellen Lage als GLB – das ist die Eingabe für den Prompt-Editor.
   * Exportiert in echten Modelleinheiten (Meter): die Anzeige-Normierung des Wurzelknotens geht nicht mit.
   */
  async exportParts(ms: ModelScene): Promise<ArrayBuffer> {
    this.nameParts(ms);
    // Kopie ohne Normierung exportieren (Geometrie/Material geteilt), die angezeigte Szene bleibt unberührt.
    // Hervorhebung (Rückfrage „Teil anklicken“) nicht mit exportieren; userData würde beim Klonen als JSON kopiert.
    const lit = this.unlight(ms);
    const root = ms.root.clone(true);
    this.relight(lit);
    root.position.set(0, 0, 0); root.scale.setScalar(1); root.quaternion.identity();
    root.updateMatrixWorld(true);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(root, (r) => resolve(r as ArrayBuffer), reject, { binary: true });
    });
  }

  /** Hervorhebung vorübergehend abnehmen (Export, Ansichten für die KI); `relight` stellt sie wieder her. */
  private unlight(ms: ModelScene) {
    const lit = this.meshes(ms).filter((m) => m.userData.origMat).map((m) => ({ m, glow: m.material, orig: m.userData.origMat as THREE.Material | THREE.Material[] }));
    lit.forEach(({ m, orig }) => { m.material = orig; delete m.userData.origMat; });
    return lit;
  }

  private relight(lit: { m: THREE.Mesh; glow: THREE.Material | THREE.Material[]; orig: THREE.Material | THREE.Material[] }[]) {
    lit.forEach(({ m, glow, orig }) => { m.userData.origMat = orig; m.material = glow; });
  }

  /** Alle Meshes in fester Reihenfolge (Teile, wie sie der Prompt-Editor kennt). */
  meshes(ms: ModelScene): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    ms.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) out.push(o as THREE.Mesh); });
    return out;
  }

  /** Teile hervorheben (Auswahl bei Rückfragen „Klick das Teil an“); leere Menge hebt alles auf. */
  highlight(ms: ModelScene, names: Set<string>) {
    for (const m of this.meshes(ms)) {
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== ms.root) top = top.parent;
      const on = names.has(m.name) || names.has(top.name);
      const orig = m.userData.origMat as THREE.Material | THREE.Material[] | undefined;
      if (on && !orig) {
        m.userData.origMat = m.material;
        const glow = (mat: THREE.Material) => {
          const c = mat.clone() as THREE.MeshStandardMaterial;
          if ('emissive' in c && c.emissive) { c.emissive = new THREE.Color(0x7c5cff); c.emissiveIntensity = 0.9; }
          else if ('color' in c && c.color) (c as any).color = new THREE.Color(0x9d8cff);
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(glow) : glow(m.material);
      } else if (!on && orig) {
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        m.material = orig;
        delete m.userData.origMat;
      }
    }
    ms.dirty = true;
  }

  /**
   * Treffer an Bildschirmposition (normiert −1…1): Teil, Mesh-Name, Textur-UV (glTF: v nach unten)
   * und Punkt in Modellkoordinaten (Meter) – für Kommentar-Pins mit 3D-Ort.
   */
  hitInfo(ms: ModelScene, nx: number, ny: number, aspect: number) {
    ms.camera.aspect = aspect;
    ms.camera.updateProjectionMatrix();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), ms.camera);
    const hit = ray.intersectObjects(ms.root.children, true).find((h) => (h.object as THREE.Mesh).isMesh);
    if (!hit) return null;
    this.nameParts(ms);
    const local = ms.root.worldToLocal(hit.point.clone());
    return {
      part: hit.object.name,
      uv: hit.uv ? [+hit.uv.x.toFixed(4), +hit.uv.y.toFixed(4)] as [number, number] : null,
      p: [local.x, local.y, local.z] as [number, number, number],
    };
  }

  /** Punkt in Modellkoordinaten → Anteil (0…1) im Modellrahmen; null, wenn er hinter der Kamera liegt. */
  project(ms: ModelScene, p: [number, number, number], aspect: number): { x: number; y: number } | null {
    ms.camera.aspect = aspect;
    ms.camera.updateProjectionMatrix();
    ms.root.updateMatrixWorld(true);
    const v = ms.root.localToWorld(new THREE.Vector3(...p)).project(ms.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /**
   * Ansichten für die KI: vier normale Ansichten und zwei „Set-of-Marks“-Ansichten, in denen jedes Teil
   * eine eigene Farbe und seine Nummer trägt. `marken` ordnet Teilnamen den Nummern zu.
   */
  renderViews(ms: ModelScene, px = 512): { views: string[]; marken: Record<string, number> } {
    const W = px, H = Math.round(px * 0.75);
    const lit = this.unlight(ms); // Auswahl-Hervorhebung gehört nicht in die Bilder für die KI
    this.nameParts(ms);
    ms.root.updateMatrixWorld(true);
    const sphere = new THREE.Box3().setFromObject(ms.root).getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 1000);
    const shot = (yaw: number, pitch: number) => {
      const d = sphere.radius / Math.sin(THREE.MathUtils.degToRad(17.5)) * 1.05;
      cam.position.set(
        sphere.center.x + d * Math.cos(pitch) * Math.sin(yaw), sphere.center.y + d * Math.sin(pitch), sphere.center.z + d * Math.cos(pitch) * Math.cos(yaw));
      cam.up.set(0, 1, 0);
      if (Math.abs(pitch) > 1.5) cam.up.set(0, 0, -1);
      cam.lookAt(sphere.center);
      cam.updateMatrixWorld(true);
      this.renderer.setSize(W, H, false);
      this.renderer.render(ms.scene, cam);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(this.renderer.domElement, 0, 0);
      return { c, ctx };
    };
    const views: string[] = [];
    try {
      for (const [yaw, pitch] of [[0, 0.05], [Math.PI / 2, 0.05], [0, Math.PI / 2 - 0.001], [0.8, 0.45]]) views.push(shot(yaw, pitch).c.toDataURL('image/jpeg', 0.85));
      // Set-of-Marks: jedes Teil eigenfarbig, Nummer an der sichtbaren Mitte
      const meshes = this.meshes(ms);
      const marken: Record<string, number> = {};
      const saved = meshes.map((m) => m.material);
      meshes.forEach((m, i) => {
        marken[m.name] = i + 1;
        m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((i * 0.618034) % 1, 0.72, 0.52) });
      });
      for (const [yaw, pitch] of [[0.8, 0.45], [0.8 + Math.PI, 0.45]]) {
        const { c, ctx } = shot(yaw, pitch);
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        meshes.forEach((m, i) => {
          const center = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).project(cam);
          if (center.z > 1 || Math.abs(center.x) > 1 || Math.abs(center.y) > 1) return;
          const x = (center.x + 1) / 2 * W, y = (1 - center.y) / 2 * H, label = String(i + 1);
          const w = ctx.measureText(label).width + 8;
          ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x - w / 2, y - 10, w, 20);
          ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - 10, w, 20);
          ctx.fillStyle = '#111'; ctx.fillText(label, x, y + 1);
        });
        views.push(c.toDataURL('image/png'));
      }
      meshes.forEach((m, i) => { (m.material as THREE.Material).dispose(); m.material = saved[i]; });
      return { views, marken };
    } finally {
      this.relight(lit);
      ms.dirty = true;
    }
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

  // ---------- Auswahl direkt auf dem Canvas ----------
  /** Logos und andere Anbauteile (vom Prompt-Editor als eigene Teile `logo_*` angelegt). */
  isLogo(o: THREE.Object3D): boolean { return /^logo_/i.test(o.name); }

  private alphaCache = new WeakMap<object, CanvasRenderingContext2D | null>();

  /** Ist die Stelle (UV) eines Logo-Meshes sichtbar? Durchsichtige Ränder zählen nicht als Treffer. */
  private opaqueAt(m: THREE.Mesh, uv: THREE.Vector2 | undefined): boolean {
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const img = mat?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!uv || !img || !img.width) return true;
    let ctx = this.alphaCache.get(img);
    if (ctx === undefined) {
      try {
        const c = document.createElement('canvas');
        c.width = Math.min(256, img.width); c.height = Math.min(256, img.height);
        ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
      } catch { ctx = null; }
      this.alphaCache.set(img, ctx);
    }
    if (!ctx) return true;
    const x = Math.min(ctx.canvas.width - 1, Math.max(0, Math.floor(uv.x * ctx.canvas.width)));
    const y = Math.min(ctx.canvas.height - 1, Math.max(0, Math.floor((mat.map!.flipY ? 1 - uv.y : uv.y) * ctx.canvas.height)));
    return ctx.getImageData(x, y, 1, 1).data[3] > 25;
  }

  /** Objekte (Top-Level-Teile) gemeinsam um ihre gemeinsame Mitte skalieren – z. B. ein Logo vergrößern. */
  scaleObjects(ms: ModelScene, objs: THREE.Object3D[], factor: number) {
    ms.root.updateMatrixWorld(true);
    const inv = ms.root.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
      .multiply(new THREE.Matrix4().makeScale(factor, factor, factor))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    for (const o of objs) { o.applyMatrix4(M); o.updateMatrixWorld(true); }
    ms.dirty = true;
  }

  pick(ms: ModelScene, nx: number, ny: number): THREE.Object3D | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), ms.camera);
    const hit = ray.intersectObjects(ms.root.children, true).find((h) => {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh) return false;
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== ms.root) top = top.parent;
      return !this.isLogo(top) || this.opaqueAt(m, h.uv);
    });
    if (!hit) return null;
    let o: THREE.Object3D = hit.object;
    while (o.parent && o.parent !== ms.root) o = o.parent;
    return o;
  }
}
