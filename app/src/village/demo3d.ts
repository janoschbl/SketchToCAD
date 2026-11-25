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

// Each wing takes a different patch of the same image. Cut along the forewing seam
// and add spanwise camber so the shape catches light as it folds.
function wingGeometry(side: number, fore: boolean) {
  const g = new THREE.PlaneGeometry(1, 1, 24, 18);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const half = IMAGE_SIZE / 2;
  const rootY = fore ? 0.065 : 0.035;
  for (let i = 0; i < pos.count; i++) {
    const span = pos.getX(i) * side + 0.5;
    const chord = pos.getY(i) + 0.5;
    const seam = THREE.MathUtils.lerp(0.065, -0.04, span);
    const x = side * THREE.MathUtils.lerp(fore ? 0.057 + chord * 0.36 : 0.09 - chord * 0.033, half, span);
    const y = fore ? THREE.MathUtils.lerp(seam - 0.011, half, chord) : THREE.MathUtils.lerp(-half, seam + 0.006, chord);
    const z = 0.022 * Math.sin(Math.PI * span) + 0.05 * span ** 2 * (fore ? chord : 1 - chord);
    pos.setXYZ(i, x, y - rootY, z - (fore ? 0 : 0.012));
    uv.setXY(i, x / IMAGE_SIZE + 0.5, y / IMAGE_SIZE + 0.5);
  }
  g.computeVertexNormals();
  return g;
}

function makeButterfly(texture: THREE.Texture) {
  const group = new THREE.Group();
  const flex = { value: new THREE.Vector2() };
  const wingMaterial = new THREE.MeshStandardMaterial({
    map: texture, side: THREE.DoubleSide, alphaTest: 0.44, alphaToCoverage: true, roughness: 0.53, metalness: 0.04,
  });
  wingMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWingFlex = flex;
    // The tips and trailing edges follow the stroke a little after the wing roots.
    shader.vertexShader = 'uniform vec2 uWingFlex;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float span = abs(2.0 * uv.x - 1.0);
      transformed.z += span * span * (uWingFlex.x + (0.5 - uv.y) * uWingFlex.y);
    `);
    // Morpho wing scales lose their blue sheen underneath, without changing the silhouette.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb * vec3(1.0, .8, .59),
        vec3(.32, .18, .072) * dot(diffuseColor.rgb, vec3(.3, .45, .65)), .43);
    `);
  };
  const wings = [-1, 1].flatMap((side) => [true, false].map((fore) => {
    const wing = new THREE.Mesh(wingGeometry(side, fore), wingMaterial);
    wing.position.y = fore ? 0.065 : 0.035;
    group.add(wing);
    return { wing, fore, side };
  }));

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
  return { group, wings, flex: flex.value };
}

const flightPath = new THREE.CatmullRomCurve3([
  [0, 0, 0], [-0.30, 0.09, 0.04], [-0.53, 0.36, -0.08], [-0.26, 0.60, -0.32],
  [0.28, 0.56, -0.54], [0.91, 0.36, -0.81], [1.61, 0.57, -1.05], [2.85, 1.28, -1.26],
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
  const restPose = new THREE.Quaternion(), axisY = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Euler();

  function render() {
    if (!photo || !butterfly || disposed) return;
    const sweep = THREE.MathUtils.lerp(-0.07, 1.07, smooth(DRAW_END, IMAGE_END, t));
    const relief = reduce ? 1 : smooth(MODEL_START + 0.17, TAKEOFF + 0.10, t);
    const flight = Math.max(0, t - TAKEOFF);
    const progress = clamp(flight / (FLIGHT_END - TAKEOFF), 0, 1);
    const departing = smooth(0.15, 1.65, flight);
    const { group, wings, flex } = butterfly;

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
      const pathProgress = progress + 0.012 * Math.sin(progress * Math.PI * 2);
      flightPath.getPoint(pathProgress, group.position);
      const burst = (1 - smooth(1.62, 1.94, flight) + smooth(2.16, 2.39, flight))
        * (1 - smooth(3.38, 3.65, flight) + smooth(4.04, 4.37, flight));
      const phase = 2 * Math.PI * (2.7 * flight + 0.08 * Math.sin(flight * 2.1));
      const beat = 0.18 + burst * (0.54 * Math.sin(phase) + 0.08 * Math.sin(phase * 2 + 0.5));
      const unfold = smooth(0, 0.62, flight);
      const stroke = reduce ? 0.34 : THREE.MathUtils.lerp(Math.sin(relief * 2.55) * 0.34, beat, unfold);
      flex.set(0.065 * Math.cos(phase - 0.45), 0.12 * Math.cos(phase - 0.85)).multiplyScalar(unfold * burst);
      for (const { wing, fore, side } of wings) {
        const follow = fore ? stroke : stroke - unfold * burst * 0.12 * Math.cos(phase) - 0.035 * relief;
        wing.rotation.set((fore ? 1 : -1) * follow * 0.11, -side * follow, side * relief * (fore ? 0.018 : -0.04));
      }

      tilt.set(-0.19 * relief, -0.31 * relief, 0.13 * relief);
      restPose.setFromEuler(tilt);
      group.quaternion.copy(restPose);
      if (flight > 0) {
        flightPath.getTangent(pathProgress, heading);
        flightPath.getTangent(Math.min(1, pathProgress + 0.032), ahead);
        up.set(-0.08 * Math.sin(flight * 1.7), 0.51, 1);
        right.crossVectors(heading, up).normalize();
        up.crossVectors(right, heading);
        target.setFromRotationMatrix(rotation.makeBasis(right, heading, up));
        const turn = ahead.cross(heading).dot(up);
        target.multiply(bank.setFromAxisAngle(axisY, clamp(turn, -0.32, 0.32) + burst * 0.045 * Math.sin(phase)));
        group.quaternion.slerp(target, smooth(0.18, 1.15, flight));
        // The body lags each downstroke; small glides interrupt the wingbeat.
        group.position.y += unfold * burst * 0.026 * Math.sin(phase - 1.2);
        group.position.z += unfold * burst * 0.013 * Math.sin(phase - 0.8);
      }
      group.position.y += 0.075;
      const scale = (1 - departing * 0.44) * (1 - smooth(0.62, 1, progress) * 0.19);
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
