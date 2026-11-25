// 3D-Ansicht des KI-Studios: ein Knoten pro Teil (gemeinsames Bild-Koordinatensystem, Kamera der Skizze auf +X).
// Nur Teile mit neuer Datei werden nachgeladen. Auswahl: Klick auf ein Teil. Radierer: über das Modell ziehen.
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { url, type Project } from './api';
import { buildElytraRig, buildFlightRig, exportFlightGlb, poseFlightHover, type FlightRig } from './flight';

export type Mode3d = 'orbit' | 'select' | 'erase';

export class View3d {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private cam = new T.PerspectiveCamera(32, 1, 0.01, 100);
  private controls: OrbitControls;
  private group = new T.Group();
  private nodes = new Map<string, { url: string; node: T.Object3D }>();
  private selected = new Set<string>();
  private ray = new T.Raycaster();
  private marks = new T.Group();
  private stroke: { part: string; pts: number[][] }[] | null = null;
  private ro: ResizeObserver;
  private loadSeq = 0;
  private clock = new T.Clock();
  private flight: { rig: FlightRig; mixer: T.AnimationMixer; hover: T.Group; speed: number } | null = null;
  private exporting = false;
  mode: Mode3d = 'orbit';
  /** Radius des 3D-Radierers in Welteinheiten (256 px der Skizze = 1). */
  radius = 0.05;
  onPick?: (part: string | null, add: boolean) => void;
  onErase?: (part: string, pts: number[][], radius: number) => void;

  constructor(private host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.scene.add(new T.HemisphereLight(0xffffff, 0x9a9a9a, 2.3));
    const sun = new T.DirectionalLight(0xffffff, 1.5);
    sun.position.set(3, 3, 1);
    this.scene.add(sun);
    const back = new T.DirectionalLight(0xffffff, 0.6);
    back.position.set(-3, 1, -2);
    this.scene.add(back);
    this.scene.add(this.group, this.marks);
    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.frontView();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      const dt = this.clock.getDelta();
      if (this.flight && !this.exporting) {
        this.flight.mixer.update(dt * this.flight.speed);
        poseFlightHover(this.flight.hover, this.clock.elapsedTime);
      }
      this.controls.update();
      this.renderer.render(this.scene, this.cam);
    });
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
  }

  destroy() {
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  /** Kamera wie in der Skizze (von vorn, +X), leicht schräg, damit man die Tiefe sieht. */
  frontView(angle = 0.35) {
    this.controls.target.set(0, 0, 0);
    this.cam.position.set(3.2 * Math.cos(angle), 0.6, 3.2 * Math.sin(angle));
  }

  /** Flug-Vorschau: Teile → Skinned Mesh mit Flügelschlag. Beim Abschalten wieder die bearbeitbaren Teile. */
  setFlight(on: boolean, speed = 1, kind: 'wings' | 'elytra' = 'wings') {
    if (this.flight) {
      this.scene.remove(this.flight.hover);
      this.flight.mixer.stopAllAction();
      this.flight.rig.root.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); });
      this.flight = null;
    }
    this.group.visible = true;
    if (!on) return null;
    const meshes: T.Mesh[] = [];
    this.group.updateMatrixWorld(true);
    this.group.traverse((o: any) => { if (o.isMesh && o.visible) meshes.push(o); });
    const rig = kind === 'elytra' ? buildElytraRig(meshes) : buildFlightRig(meshes);
    if (!rig) return null;
    rig.root.traverse((o: any) => { if (o.isMesh) for (const mat of [o.material].flat()) if (mat.emissive) mat.emissive.set(0x000000); });
    const hover = new T.Group();
    hover.add(rig.root);
    this.scene.add(hover);
    const mixer = new T.AnimationMixer(rig.root);
    mixer.clipAction(rig.clip).play();
    this.flight = { rig, mixer, hover, speed };
    this.group.visible = false;
    // Schräg von vorn oben, damit Auf- und Abschlag gut zu sehen sind
    this.controls.target.set(0, 0, 0);
    const d = rig.info.span * 2.9;
    this.cam.position.set(-0.75 * d, 0.55 * d, 0.65 * d);
    return rig.info;
  }

  setFlightSpeed(k: number) { if (this.flight) this.flight.speed = k; }
  get flying() { return !!this.flight; }
  get flightLabel() { return this.flight?.rig.label ?? ''; }

  async exportFlight(): Promise<File | null> {
    if (!this.flight) return null;
    this.exporting = true;
    try { return await exportFlightGlb(this.flight.rig); } finally { this.exporting = false; }
  }

  clear() {
    this.setFlight(false);
    this.loadSeq++;
    for (const n of this.nodes.values()) this.group.remove(n.node);
    this.nodes.clear();
    this.selected.clear();
  }

  async setProject(p: Project, flash?: string) {
    const seq = ++this.loadSeq;
    const keep = new Set(p.parts.map((q) => q.id));
    for (const [id, n] of this.nodes) if (!keep.has(id)) { this.group.remove(n.node); this.nodes.delete(id); }
    await Promise.all(p.parts.map(async (q) => {
      const u = url(q.url);
      const have = this.nodes.get(q.id);
      if (have?.url === u) return;
      const g = await new GLTFLoader().loadAsync(u);
      if (seq !== this.loadSeq) return;
      g.scene.name = q.id;
      g.scene.userData.part = q.id;
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.userData.part = q.id;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // Teile haben kein eigenes Material → glTF-Standard wäre voll metallisch. Matt, beidseitig (dünne Flügel).
        for (const m of mats) if ('metalness' in m) { m.metalness = 0; m.roughness = 0.8; m.side = T.DoubleSide; m.needsUpdate = true; }
      });
      if (have) this.group.remove(have.node);
      this.group.add(g.scene);
      this.nodes.set(q.id, { url: u, node: g.scene });
    }));
    this.paintSel();
    if (flash) this.flash(flash);
  }

  setSelected(ids: string[]) {
    this.selected = new Set(ids);
    this.paintSel();
  }

  private glow(id: string, col: number, k: number) {
    this.nodes.get(id)?.node.traverse((o: any) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m.emissive) { m.emissive.set(col); m.emissiveIntensity = k; }
    });
  }

  private paintSel() {
    for (const id of this.nodes.keys()) this.glow(id, this.selected.has(id) ? 0x5b5bff : 0x000000, this.selected.has(id) ? 0.45 : 0);
  }

  flash(id: string) {
    this.glow(id, 0xff7a00, 0.45);
    setTimeout(() => this.paintSel(), 1400);
  }

  private hit(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.cam);
    const h = this.ray.intersectObject(this.group, true).find((x) => x.object.visible);
    return h ? { part: h.object.userData.part as string, point: h.point } : null;
  }

  private downAt: { x: number; y: number } | null = null;
  private down = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.mode !== 'erase' || this.flight) return;
    const h = this.hit(e);
    if (!h) return; // daneben: normal drehen
    this.controls.enabled = false;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }
    this.stroke = [];
    this.addMark(h.part, h.point);
  };
  private move = (e: PointerEvent) => {
    if (!this.stroke) return;
    const h = this.hit(e);
    if (h) this.addMark(h.part, h.point);
  };
  private up = (e: PointerEvent) => {
    if (this.stroke) {
      const s = this.stroke;
      this.stroke = null;
      this.controls.enabled = true;
      const by = new Map<string, number[][]>();
      for (const x of s) by.set(x.part, [...(by.get(x.part) ?? []), ...x.pts]);
      for (const [part, pts] of by) this.onErase?.(part, pts, this.radius);
      setTimeout(() => this.marks.clear(), 600);
      return;
    }
    const d = this.downAt;
    this.downAt = null;
    if (this.mode === 'select' && !this.flight && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) {
      const h = this.hit(e);
      this.onPick?.(h?.part ?? null, e.shiftKey);
    }
  };
  private addMark(part: string, p: T.Vector3) {
    // Punkt in Weltkoordinaten der Teile (Gruppe ist nicht transformiert)
    const last = this.stroke!.at(-1);
    const prev = last?.pts.at(-1);
    if (prev && Math.hypot(prev[0] - p.x, prev[1] - p.y, prev[2] - p.z) < this.radius * 0.4) return;
    if (last?.part === part) last.pts.push([p.x, p.y, p.z]);
    else this.stroke!.push({ part, pts: [[p.x, p.y, p.z]] });
    const m = new T.Mesh(new T.SphereGeometry(this.radius, 12, 8), new T.MeshBasicMaterial({ color: 0xff3b6b, transparent: true, opacity: 0.45, depthTest: false }));
    m.position.copy(p);
    this.marks.add(m);
  }
}
