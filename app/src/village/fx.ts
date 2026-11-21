import * as THREE from 'three';

/** Kleine additive Funken – beim Zeichnen am Stift und beim Materialisieren. */
export class Sparks {
  readonly points: THREE.Points;
  private n = 900;
  private pos = new Float32Array(this.n * 3);
  private vel = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private max = new Float32Array(this.n);
  private size = new Float32Array(this.n);
  private cursor = 0;

  constructor(color = '#ffc98a') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(3) } },
      vertexShader: `attribute float aLife; attribute float aSize; varying float vL;
        void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * aLife * (260.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vL;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
          if (vL <= 0.0) discard; gl_FragColor = vec4(uColor * a, a * vL); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, count: number, spread = 0.3, up = 1.2, size = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * 1.2;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      this.max[i] = 0.6 + Math.random() * 0.9;
      this.life[i] = 1;
      this.size[i] = (0.25 + Math.random() * 0.35) * size;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.max[i];
      this.vel[i * 3 + 1] -= dt * 0.6;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

/** Prozeduraler Sound: Stift-Kratzen, "Pop" beim Materialisieren, leiser Wind. */
export class Sfx {
  ctx?: AudioContext;
  private master?: GainNode;
  private scratch?: GainNode;
  private band?: BiquadFilterNode;
  muted = false;

  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Stift auf Papier
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.band = ctx.createBiquadFilter(); this.band.type = 'bandpass'; this.band.frequency.value = 3200; this.band.Q.value = 0.9;
    this.scratch = ctx.createGain(); this.scratch.gain.value = 0;
    src.connect(this.band).connect(this.scratch).connect(this.master);
    src.start();
    // Abendwind
    const w = ctx.createBufferSource(); w.buffer = buf; w.loop = true; w.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const wg = ctx.createGain(); wg.gain.value = 0.035;
    w.connect(lp).connect(wg).connect(this.master);
    w.start();
  }

  drawing(level: number) {
    if (!this.ctx || !this.scratch || !this.band) return;
    const t = this.ctx.currentTime;
    this.scratch.gain.setTargetAtTime(level * (0.05 + Math.random() * 0.05), t, 0.025);
    this.band.frequency.setTargetAtTime(2600 + Math.random() * 1600, t, 0.03);
  }

  pop(pitch = 1) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, delay] of [[523.25, 0], [783.99, 0.07], [1046.5, 0.14]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * pitch;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.06, t + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
      o.connect(g).connect(this.master); o.start(t + delay); o.stop(t + delay + 0.7);
    }
  }

  /** Magischer Glitzer-Akkord + aufsteigendes Rauschen – wenn die Welle losläuft. */
  magic(strength = 1) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); const d = i * 0.075;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.05 * strength, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.8);
      o.connect(g).connect(this.master!); o.start(t + d); o.stop(t + d + 1.9);
    });
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2.5, ctx.sampleRate), dd = buf.getChannelData(0);
    for (let i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(7000, t + 2.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09 * strength, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(bp).connect(g).connect(this.master); src.start(t); src.stop(t + 2.5);
  }

  /** Tiefes, weiches "Wumm" – die letzte Dunkelheit verpufft. */
  boom(strength = 1) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.4);
    this.noise(0.9, 300, 2600, 0.12 * strength, 0.02);
  }

  /** Luftzug für Kameraflüge. */
  whoosh(dur = 2, strength = 1) {
    this.noise(dur, 250, 1800, 0.07 * strength, dur * 0.45);
  }

  private noise(dur: number, f0: number, f1: number, gain: number, attack: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + attack + 0.01);
    bp.frequency.exponentialRampToValueAtTime(f0, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master); src.start(t); src.stop(t + dur);
  }

  /** Leises "Pling" – wenn der Pinsel erscheint. */
  twinkle() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [1568, 2093, 2637].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const d = i * 0.09;
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.035, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
      o.connect(g).connect(this.master!); o.start(t + d); o.stop(t + d + 1);
    });
  }

  resume() { this.ctx?.resume(); }

  toggle() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}

/** Leuchtender Ring auf dem Boden – die Front der magischen Welle, die die Welt erschafft. */
export function createWaveRing() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uR: { value: 0 }, uA: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffc477').multiplyScalar(1.5) } },
    vertexShader: `varying vec2 vP; void main(){ vP = (modelMatrix * vec4(position,1.0)).xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uR, uA, uTime; uniform vec3 uColor; varying vec2 vP;
      void main(){
        float r = length(vP), ang = atan(vP.y, vP.x);
        float w = 0.3 + uR * 0.01;
        float wob = sin(ang * 7.0 + uTime * 2.0) * 0.25 + sin(ang * 17.0 - uTime * 3.0) * 0.12;
        float d = r - uR - wob;
        float ring = exp(-d * d / (w * w));
        float trail = d < 0.0 ? exp(d / (1.5 + uR * 0.03)) * 0.06 : 0.0;
        float sparkle = pow(max(0.0, sin(ang * 90.0 + uTime * 6.0) * sin(r * 3.0 - uTime * 4.0)), 8.0) * ring;
        float a = (ring + trail + sparkle * 2.0) * uA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 150).rotateX(-Math.PI / 2), m);
  mesh.position.y = 0.12;
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return mesh;
}
