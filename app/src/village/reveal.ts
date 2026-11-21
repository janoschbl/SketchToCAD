import * as THREE from 'three';

/**
 * "Materialisieren": ein Objekt wird entlang einer Front sichtbar, an der Front leuchtet ein
 * warmes Band – wie die Ring-Reveals bei bruno-simon.com bzw. die glühenden Fugen bei igloo.inc.
 *  - height: Objekt wächst von unten nach oben (einzelne Modelle)
 *  - mask:   Landschaft erscheint dort, wo die RevealMask schon "aufgedeckt" ist
 */
export interface RevealUniforms {
  uReveal: { value: number };
  uGlow: { value: THREE.Color };
  uBand: { value: number };
}

export function makeRevealUniforms(start: number, glow = '#ff7a3d', band = 0.45): RevealUniforms {
  return { uReveal: { value: start }, uGlow: { value: new THREE.Color(glow) }, uBand: { value: band } };
}

export const WORLD_HALF = 64;

/** Aufgedeckte Fläche der Welt (256×256 Texel, 1 Texel ≈ 0,5 m). Wird um den Fokus herum "gemalt". */
export class RevealMask {
  readonly size = 256;
  readonly data = new Uint8Array(this.size * this.size);
  readonly tex: THREE.DataTexture;
  readonly uMask: { value: THREE.DataTexture };
  readonly uWorld = { value: WORLD_HALF };

  constructor() {
    this.tex = new THREE.DataTexture(this.data, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.uMask = { value: this.tex };
  }

  private toTex(w: number) { return ((w + WORLD_HALF) / (2 * WORLD_HALF)) * this.size - 0.5; }

  paint(cx: number, cz: number, radius: number, dt: number, accepts?: (x: number, z: number) => boolean) {
    const s = this.size, k = (2 * WORLD_HALF) / s;
    const x0 = Math.max(0, Math.floor(this.toTex(cx - radius))), x1 = Math.min(s - 1, Math.ceil(this.toTex(cx + radius)));
    const z0 = Math.max(0, Math.floor(this.toTex(cz - radius))), z1 = Math.min(s - 1, Math.ceil(this.toTex(cz + radius)));
    let changed = false;
    for (let j = z0; j <= z1; j++) {
      const wz = (j + 0.5) * k - WORLD_HALF;
      for (let i = x0; i <= x1; i++) {
        const wx = (i + 0.5) * k - WORLD_HALF;
        const d = Math.hypot(wx - cx, wz - cz);
        if (d > radius) continue;
        const idx = j * s + i, v = this.data[idx];
        if (v >= 255 || (accepts && !accepts(wx, wz))) continue;
        const speed = 680 + 220 * Math.min(1, (radius - d) / 4);
        this.data[idx] = Math.min(255, v + Math.max(1, Math.round(dt * speed)));
        changed = true;
      }
    }
    if (changed) this.tex.needsUpdate = true;
  }

  sample(x: number, z: number) {
    const i = Math.round(this.toTex(x)), j = Math.round(this.toTex(z));
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return 0;
    return this.data[j * this.size + i] / 255;
  }

  clear() { this.data.fill(0); this.tex.needsUpdate = true; }
}

/** GLSL: Abstand zur Reveal-Front (>0 = sichtbar) mit organisch welliger Schwelle. */
export const MASK_PARS = /* glsl */ `
  uniform sampler2D uMask; uniform float uWorld;
  float maskEdge(vec2 p) {
    float th = 0.5 + 0.16 * sin(p.x * 0.55 + sin(p.y * 0.45) * 2.0) * sin(p.y * 0.5 + 1.3) + 0.07 * sin(p.x * 2.1 + p.y * 1.7);
    return (texture2D(uMask, p / (2.0 * uWorld) + 0.5).r - th) * 3.0;
  }`;

export type RevealMode = 'height' | 'mask';

export function patchReveal(mat: THREE.Material, u: RevealUniforms, mode: RevealMode, mask?: RevealMask) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = u.uReveal;
    shader.uniforms.uGlow = u.uGlow;
    shader.uniforms.uBand = u.uBand;
    if (mask) { shader.uniforms.uMask = mask.uMask; shader.uniforms.uWorld = mask.uWorld; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRevealPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 rvp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rvp = instanceMatrix * rvp;
        #endif
        vRevealPos = (modelMatrix * rvp).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRevealPos;\nuniform float uReveal;\nuniform vec3 uGlow;\nuniform float uBand;\n${mode === 'mask' ? MASK_PARS : ''}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float rEdge = ${mode === 'mask' ? 'maskEdge(vRevealPos.xz)' : 'uReveal - vRevealPos.y'};
        if (rEdge < 0.0) discard;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += uGlow * (1.0 - smoothstep(0.0, uBand, rEdge)) * ${mode === 'mask' ? '1.1' : '3.0'};
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'reveal-' + mode;
}
