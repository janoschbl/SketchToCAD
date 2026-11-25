import * as THREE from 'three';

export type Stage = 'sketch' | 'image' | 'model';

const IMAGE_SIZE = 2.34;
const DRAW_END = 1.95, IMAGE_END = 3.35, MODEL_START = 4.35, TAKEOFF = 5.05, FLIGHT_END = 10.55, LOOP = 11.25;
const smooth = (from: number, to: number, t: number) => THREE.MathUtils.smoothstep(t, from, to);
const clamp = THREE.MathUtils.clamp;

const ink = [
  'M200 141 C191 147 192 167 192 195 C190 225 194 283 200 302 C209 276 209 228 207 197 C207 167 210 147 200 141 M205 134 A6 6 0 1 1 193 134 A6 6 0 1 1 205 134',
  'M196 128 Q179 78 146 53 M202 128 Q214 81 252 51',
  'M198 176 C174 135 123 38 61 29 C10 20 6 59 15 111 C25 169 58 189 119 188 C150 189 180 184 198 176',
  'M202 176 C225 130 279 41 342 30 C388 22 395 56 384 111 C375 164 342 188 284 188 C248 188 220 183 202 176',
  'M190 183 C148 185 56 182 31 235 C11 276 23 329 68 356 C119 389 166 349 183 304 C195 274 199 232 198 198',
  'M208 184 C251 186 344 181 368 237 C389 284 370 333 329 359 C276 390 235 347 216 303 C205 271 201 229 203 198',
];
const marker = [
  'M38 54 Q133 90 167 153 Q76 147 40 91 Q83 128 123 153 Q81 162 52 136',
  'M360 54 Q274 92 233 154 Q328 147 361 93 Q319 126 275 154 Q318 164 348 137',
  'M158 212 C70 215 34 265 53 312 C78 364 135 338 154 285 C169 242 100 244 72 286',
  'M241 213 C325 211 365 270 346 314 C319 361 265 335 248 283 C228 237 298 247 330 287',
];

function drawSketch() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const makeStrokes = (paths: string[]) => paths.map((d) => {
    const measure = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    measure.setAttribute('d', d);
    return { path: new Path2D(d), length: measure.getTotalLength() };
  });
  const lines = makeStrokes(ink), fills = makeStrokes(marker);
  const stroke = (paths: typeof lines, amount: number, color: string, width: number) => {
    let budget = amount * paths.reduce((sum, path) => sum + path.length, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const { path, length } of paths) {
      if (budget <= 0) break;
      ctx.setLineDash(budget >= length ? [] : [budget, length]);
      ctx.stroke(path);
      budget -= length;
    }
  };
  let last = -1;
  return {
    texture,
    update(t: number) {
      const p = clamp(t / DRAW_END, 0, 1);
      if (last === p) return;
      last = p;
      ctx.setTransform(1.28, 0, 0, 1.28, 0, 0);
      ctx.clearRect(0, 0, 400, 400);
      ctx.lineCap = ctx.lineJoin = 'round';
      stroke(fills, smooth(0.43, 1, p), '#4599d0', 24);
      stroke(lines, smooth(0, 0.73, p), '#25394d', 4.4);
      texture.needsUpdate = true;
    },
  };
}

// Fore- and hindwing share a surface so bending never opens a gap along their seam.
function wingGeometry(side: number) {
  const g = new THREE.PlaneGeometry(1, 1, 28, 36);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const half = IMAGE_SIZE / 2;
  for (let i = 0; i < pos.count; i++) {
    const span = pos.getX(i) * side + 0.5;
    const y = pos.getY(i) * IMAGE_SIZE;
    // Exclude the body and antennae painted on the source image.
    const root = 0.058 + 0.34 * smooth(0.29, 0.97, y);
    const x = side * THREE.MathUtils.lerp(root, half, span);
    pos.setXYZ(i, x, y, 0);
    uv.setXY(i, x / IMAGE_SIZE + 0.5, y / IMAGE_SIZE + 0.5);
  }
  return g;
}

function makeButterfly(texture: THREE.Texture) {
  const group = new THREE.Group();
  const motion = { value: new THREE.Vector3() };
  const wingMaterial = new THREE.MeshStandardMaterial({
    map: texture, side: THREE.DoubleSide, alphaTest: 0.44, alphaToCoverage: true, roughness: 0.53, metalness: 0.04,
  });
  wingMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWingMotion = motion;
    shader.vertexShader = `
      uniform vec3 uWingMotion;

      vec3 flexWing(vec3 p) {
        float span = clamp((abs(p.x) - 0.06) / 1.11, 0.0, 1.0);
        float rear = 1.0 - smoothstep(-0.25, 0.22, p.y);
        float phase = uWingMotion.x - 0.80 * span - 0.40 * rear;
        float raised = max(0.0, sin(phase));
        float cup = raised * raised * raised;
        float load = uWingMotion.y;

        float bend = load * (-0.33 * cos(phase) + 0.24 * cup);
        float twist = span * load * (0.52 * sin(phase - 0.92) - 0.20 * cup);
        float axis = 0.18 - 0.34 * span;
        float chord = clamp((p.y + 0.90) / 1.88, 0.0, 1.0);
        float camber = 4.0 * chord * (1.0 - chord) * span
          * (0.045 * uWingMotion.z + load * (0.16 * cup - 0.09 * cos(phase)));

        p.x *= 1.0 - 0.42 * bend * bend * span;
        p.z += (p.y - axis) * sin(twist) + span * span * bend + camber;
        p.y = axis + (p.y - axis) * cos(twist);
        return p;
      }
    ` + shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      vec3 flexed = flexWing(position);
      vec3 along = flexWing(position + vec3(0.004, 0.0, 0.0)) - flexed;
      vec3 across = flexWing(position + vec3(0.0, 0.004, 0.0)) - flexed;
      objectNormal = normalize(cross(along, across));
    `).replace('#include <begin_vertex>', 'vec3 transformed = flexed;');
    // Morpho wing scales lose their blue sheen underneath, without changing the silhouette.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb * vec3(1.0, .8, .59),
        vec3(.32, .18, .072) * dot(diffuseColor.rgb, vec3(.3, .45, .65)), .43);
    `);
  };
  const wings = [-1, 1].map((side) => {
    const wing = new THREE.Mesh(wingGeometry(side), wingMaterial);
    wing.frustumCulled = false; // The vertex shader changes the wing's bounds.
    group.add(wing);
    return { wing, side };
  });

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#674932', roughness: 0.81 });
  const abdomen = [new THREE.Vector2(0.004, -0.62), new THREE.Vector2(0.019, -0.55)];
  for (let i = 0; i < 9; i++) {
    const y = -0.49 + i * 0.057, r = 0.022 + i * 0.0026;
    abdomen.push(new THREE.Vector2(r, y - 0.009), new THREE.Vector2(r * 1.2, y), new THREE.Vector2(r, y + 0.024));
  }
  abdomen.push(new THREE.Vector2(0.026, 0.037), new THREE.Vector2(0.001, 0.05));
  const body = new THREE.Mesh(new THREE.LatheGeometry(abdomen, 20), bodyMaterial);
  group.add(body);

  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const oval = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material = bodyMaterial) => {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  oval(0, 0.092, 0.012, 0.068, 0.155, 0.068);
  oval(0, 0.299, 0.012, 0.047, 0.062, 0.041);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: '#27201c', roughness: 0.35 });
  for (const side of [-1, 1]) {
    oval(0.033 * side, 0.318, 0.032, 0.019, 0.025, 0.018, eyeMaterial);
    const tip = new THREE.Vector3(0.303 * side, 0.965, 0.033);
    const antenna = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.021 * side, 0.343, 0.03), new THREE.Vector3(0.087 * side, 0.535, 0.052),
      new THREE.Vector3(0.18 * side, 0.742, 0.068), tip,
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(antenna, 16, 0.005, 5, false), bodyMaterial));
    oval(tip.x, tip.y, tip.z, 0.012, 0.026, 0.009, eyeMaterial);
  }
  return { group, wings, motion: motion.value };
}

const flightPath = new THREE.CatmullRomCurve3([
  [0, 0, 0], [-0.07, 0.08, 0.02], [-0.09, 0.24, -0.10], [0.20, 0.46, -0.23],
  [0.67, 0.56, -0.40], [1.15, 0.48, -0.68], [1.85, 0.65, -0.95], [3.24, 1.26, -1.28],
].map(([x, y, z]) => new THREE.Vector3(x, y, z)));

export function mountDemo(canvas: HTMLCanvasElement, imageUrl: string, onStage: (stage: Stage) => void, onReady: () => void, reduce: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.z = 5.2;
  scene.add(new THREE.HemisphereLight('#fff5dd', '#aab8cb', 1.65));
  const key = new THREE.DirectionalLight('#fff1d4', 2.0);
  key.position.set(-2, 3.5, 3);
  const fill = new THREE.DirectionalLight('#bcdeff', 1.25);
  fill.position.set(3, 1, -3);
  scene.add(key, fill);

  const sketch = drawSketch();
  function sheet(texture: THREE.Texture, reverse: boolean) {
    const visibility = { value: 1 };
    const sweep = { value: 0 };
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uVisibility = visibility;
      shader.uniforms.uSweep = sweep;
      shader.fragmentShader = 'uniform float uVisibility; uniform float uSweep;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float edge = 0.72 * (1.0 - vMapUv.x) + 0.28 * vMapUv.y;
         float converted = smoothstep(edge - .05, edge + .05, uSweep);
         diffuseColor.a *= uVisibility * ${reverse ? '(1.0 - converted)' : 'converted'};`,
      );
    };
    material.customProgramCacheKey = () => reverse ? 'well-sketch' : 'well-image';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(IMAGE_SIZE, IMAGE_SIZE), material);
    mesh.position.set(0, 0.075, 0.13);
    scene.add(mesh);
    return { mesh, sweep, visibility };
  }

  const shadowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { strength: { value: 0 } },
    vertexShader: 'varying vec2 tex; void main() { tex = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec2 tex; uniform float strength; void main() { gl_FragColor = vec4(.23, .13, .10, strength * pow(max(0., 1. - length((tex - .5) * 2.)), 2.6)); }',
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 1.70), shadowMaterial);
  shadow.position.z = -0.78;
  scene.add(shadow);

  const drawing = sheet(sketch.texture, true);
  let photo: ReturnType<typeof sheet> | undefined;
  let butterfly: ReturnType<typeof makeButterfly> | undefined;
  let specimen: THREE.Texture | undefined;
  let stage: Stage = 'sketch', disposed = false, playing = !reduce;
  let t = 0, lastFrame = 0, raf = 0;

  const heading = new THREE.Vector3(), ahead = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const rotation = new THREE.Matrix4(), target = new THREE.Quaternion(), bank = new THREE.Quaternion();
  const restPose = new THREE.Quaternion(), axisY = new THREE.Vector3(0, 1, 0), axisX = new THREE.Vector3(1, 0, 0);
  const tilt = new THREE.Euler();

  function render() {
    if (!photo || !butterfly || disposed) return;
    const sweep = THREE.MathUtils.lerp(-0.07, 1.07, smooth(DRAW_END, IMAGE_END, t));
    const relief = reduce ? 1 : smooth(MODEL_START + 0.17, TAKEOFF + 0.10, t);
    const flight = Math.max(0, t - TAKEOFF);
    const progress = clamp(flight / (FLIGHT_END - TAKEOFF), 0, 1);
    const departing = smooth(0.30, 2.25, flight);
    const { group, wings, motion } = butterfly;

    drawing.mesh.visible = !reduce && t > 0 && t < IMAGE_END;
    drawing.sweep.value = sweep;
    if (drawing.mesh.visible) sketch.update(t);
    photo.mesh.visible = !reduce && t >= DRAW_END && t < MODEL_START + 0.33;
    photo.sweep.value = sweep;
    photo.visibility.value = 1 - smooth(MODEL_START + 0.04, MODEL_START + 0.33, t);
    photo.mesh.renderOrder = 1;

    group.visible = (reduce || t >= MODEL_START) && t < FLIGHT_END;
    shadow.visible = !reduce && t >= DRAW_END && t < FLIGHT_END;
    if (group.visible) {
      const pathProgress = progress - 0.05 * Math.sin(progress * Math.PI);
      flightPath.getPoint(pathProgress, group.position);
      const glide = smooth(1.52, 1.90, flight) - smooth(2.21, 2.62, flight)
        + smooth(3.51, 3.89, flight) - smooth(4.32, 4.74, flight);
      const liftOff = smooth(0, 0.47, flight);
      const effort = liftOff * (1 - 0.92 * glide);
      const phase = 2 * Math.PI * (2.45 * flight + 0.07 * Math.sin(2.7 * flight));
      const beat = Math.sin(phase);
      const fold = reduce ? 0.29 : THREE.MathUtils.lerp(0.31 * Math.sin(relief * 2.55), 0.18 + 0.09 * glide, liftOff);
      const stroke = fold + effort * (0.62 * beat + 0.15 * Math.max(0, beat) ** 2);
      motion.set(phase, effort, relief);

      tilt.set(-0.19 * relief, -0.31 * relief, 0.13 * relief);
      restPose.setFromEuler(tilt);
      group.quaternion.copy(restPose);
      let turn = 0;
      if (flight > 0) {
        flightPath.getTangent(pathProgress, heading);
        flightPath.getTangent(Math.min(1, pathProgress + 0.032), ahead);
        up.set(0, 0.38, 1);
        right.crossVectors(heading, up).normalize();
        up.crossVectors(right, heading);
        target.setFromRotationMatrix(rotation.makeBasis(right, heading, up));
        turn = clamp(ahead.cross(heading).dot(up) * 1.4, -0.35, 0.35);
        target.multiply(bank.setFromAxisAngle(axisY, turn));
        target.multiply(bank.setFromAxisAngle(axisX, effort * 0.10 * Math.sin(phase - 0.55)));
        group.quaternion.slerp(target, smooth(0.12, 1.16, flight));
        group.position.y += effort * 0.044 * Math.cos(phase - 0.45);
        group.position.z += effort * 0.018 * Math.sin(phase - 0.9);
      }
      for (const { wing, side } of wings) {
        wing.rotation.y = -side * stroke + 0.26 * turn * effort * beat;
        wing.rotation.z = side * (0.025 * relief + 0.084 * effort * Math.sin(phase - 0.68));
      }
      group.position.y += 0.075;
      const scale = (1 - liftOff * 0.055 - departing * 0.27) * (1 - smooth(0.62, 1, progress) * 0.23);
      group.scale.setScalar(scale);
    }

    if (shadow.visible) {
      const { x, y } = group.position;
      shadow.position.x = x * 0.82 + 0.08;
      shadow.position.y = y * 0.77 - 0.07 - departing * 0.29;
      shadow.scale.setScalar(1 - departing * 0.19);
      shadowMaterial.uniforms.strength.value = 0.16 * smooth(DRAW_END, IMAGE_END, t) * (1 - 0.72 * departing) * (1 - smooth(0.7, 1, progress));
    }

    const next = reduce || t >= MODEL_START ? 'model' : t >= DRAW_END ? 'image' : 'sketch';
    if (stage !== next) { stage = next; onStage(stage); }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }

  function frame(now: number) {
    if (lastFrame) t = (t + Math.min((now - lastFrame) / 1000, 0.085)) % LOOP;
    lastFrame = now;
    render();
    raf = requestAnimationFrame(frame);
  }

  function syncPlayback() {
    cancelAnimationFrame(raf);
    lastFrame = 0;
    if (photo && playing && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', syncPlayback);
  const ready = new THREE.TextureLoader().loadAsync(imageUrl).then((texture) => {
    if (disposed) { texture.dispose(); return; }
    specimen = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    photo = sheet(texture, false);
    butterfly = makeButterfly(texture);
    scene.add(butterfly.group);
    resize();
    onReady();
    syncPlayback();
  });

  return {
    ready,
    setPlaying(value: boolean) { playing = value && !reduce; syncPlayback(); },
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
      cancelAnimationFrame(raf);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          materials.add(object.material as THREE.Material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      sketch.texture.dispose();
      specimen?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
