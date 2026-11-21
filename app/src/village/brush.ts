import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,214,150,0.85)');
  grd.addColorStop(0.45, 'rgba(255,120,70,0.25)');
  grd.addColorStop(1, 'rgba(255,90,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Magischer Pinsel: Holzstiel mit Goldzwinge, Borsten mit leuchtend roter Tintenspitze.
 * Der Ursprung der Gruppe ist die Pinselspitze, der Stiel zeigt nach +Y.
 */
export class MagicBrush {
  readonly group = new THREE.Group();
  readonly tip = new THREE.Vector3();
  private body = new THREE.Group();
  private halo: THREE.Sprite;
  private light: THREE.PointLight;
  private vel = new THREE.Vector3();
  private lean = new THREE.Vector2();
  visible = 0;

  constructor() {
    const handleMat = new THREE.MeshStandardMaterial({ color: '#4a2f7a', roughness: 0.35, metalness: 0.1 });
    const gold = new THREE.MeshStandardMaterial({ color: '#f6c453', roughness: 0.25, metalness: 0.85, emissive: '#5a3a00', emissiveIntensity: 0.4 });
    const bristle = new THREE.MeshStandardMaterial({ color: '#f5e6cf', roughness: 0.8 });
    const ink = new THREE.MeshStandardMaterial({ color: '#ff4b2b', emissive: '#ff5a2a', emissiveIntensity: 2.6, roughness: 0.4 });

    // Borsten: bauchige Lathe-Form, unten spitz
    const prof = [[0, 0], [0.05, 0.08], [0.1, 0.22], [0.115, 0.36], [0.1, 0.48], [0.075, 0.55]].map(([x, y]) => new THREE.Vector2(x, y));
    const br = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), bristle);
    br.position.y = 0.0;
    const tipProf = [[0, 0], [0.05, 0.08], [0.085, 0.17], [0.0, 0.17]].map(([x, y]) => new THREE.Vector2(x, y));
    const tipMesh = new THREE.Mesh(new THREE.LatheGeometry(tipProf, 18), ink);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.078, 0.26, 18), gold);
    ferrule.position.y = 0.66;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.016, 8, 24), gold);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.78;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 1.35, 18), handleMat);
    handle.position.y = 1.47;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 10), gold);
    cap.position.y = 2.16;
    // kleiner Stern am Stielende
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshStandardMaterial({ color: '#fff2c4', emissive: '#ffd27a', emissiveIntensity: 3 }));
    star.position.y = 2.3;
    star.userData.spin = true;
    this.body.add(br, tipMesh, ferrule, ring, handle, cap, star);
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd7a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(0.9);
    this.light = new THREE.PointLight('#ffb27a', 0, 7, 1.6);
    this.light.position.y = 0.15;
    this.group.add(this.body, this.halo, this.light);
    this.group.visible = false;
  }

  /** Spitze folgt `target` gefedert; der Stiel lehnt sich gegen die Bewegungsrichtung. */
  update(dt: number, time: number, target: THREE.Vector3, camera: THREE.Camera, stiffness = 26) {
    const p = this.group.position;
    const k = 1 - Math.exp(-dt * stiffness);
    const prev = p.clone();
    p.lerp(target, k);
    this.vel.subVectors(p, prev).divideScalar(Math.max(dt, 1e-4));
    this.tip.copy(p);
    // Neigung: Grundneigung zur Kamera-Seite + Bewegung
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const vx = this.vel.dot(right), vz = this.vel.dot(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2));
    this.lean.lerp(new THREE.Vector2(THREE.MathUtils.clamp(-vx * 0.06, -0.6, 0.6), THREE.MathUtils.clamp(vz * 0.04, -0.4, 0.4)), 1 - Math.exp(-dt * 6));
    const yaw = Math.atan2(-right.z, right.x); // lokales X = Kamera-rechts, lokales Z = zur Kamera
    this.body.rotation.set(-0.35 + this.lean.y + Math.sin(time * 1.7) * 0.04, yaw, -0.45 + this.lean.x + Math.sin(time * 1.3) * 0.05, 'YXZ');
    const s = this.visible;
    this.group.visible = s > 0.001;
    this.body.scale.setScalar(Math.max(0.001, s));
    this.halo.scale.setScalar((0.7 + Math.sin(time * 9) * 0.08) * s * 1.3);
    this.light.intensity = 7 * s;
    this.body.children.forEach((c) => { if (c.userData.spin) c.rotation.y = time * 2.4; });
  }
}
