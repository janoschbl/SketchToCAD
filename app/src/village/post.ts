import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Tilt-Shift (Miniatur-Look wie bei Bruno), warmes Grading, Vignette, Filmkorn. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uBlur: { value: 1 },
    uFocus: { value: 0.5 },
    uFlash: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uBlur, uFocus, uFlash; varying vec2 vUv;
    const vec2 P[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621),
      vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064),
      vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      float d = abs(vUv.y - uFocus) * 2.0;
      float amt = smoothstep(0.3, 1.0, d) * uBlur;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (amt > 0.01) {
        vec3 acc = col; float tot = 1.0;
        float ang = hash(vUv * uRes) * 6.2831;
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        for (int i = 0; i < 12; i++) { acc += texture2D(tDiffuse, vUv + rot * P[i] * amt * 9.0 / uRes).rgb; tot += 1.0; }
        col = acc / tot;
      }
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.95, 0.2, length(q * vec2(1.0, 1.25)));
      col = mix(col * vec3(0.62, 0.45, 0.55), col, v);
      col = mix(col, col * vec3(1.05, 0.98, 0.9) + vec3(0.02, 0.0, -0.01), 0.7);
      // magischer Lichtblitz (Wumm am Ende der Welle, Auflösen des Schriftzugs)
      col += uFlash * vec3(1.0, 0.86, 0.62) * (1.0 - 0.5 * length(q));
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.03;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.38, 0.55, 0.94);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  return {
    composer,
    finish,
    setSize(w: number, h: number, pr: number) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      finish.uniforms.uRes.value.set(w * pr, h * pr);
    },
  };
}
