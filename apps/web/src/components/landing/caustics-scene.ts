import * as THREE from "three";
import { runLoop } from "../canvas-loop";

type Theme = "light" | "dark";
export type Caustics = { setTheme: (t: Theme) => void; dispose: () => void };

const INK = { light: { color: "#1f3dff", alpha: 0.2 }, dark: { color: "#8ea2ff", alpha: 0.17 } };

// sunlight through a moving surface: the bright net is where two drifting cell layers meet, warped by the swell above
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uInk; uniform float uAlpha; uniform vec2 uPointer; uniform float uNear;
varying vec2 vUv;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// distance between the nearest and second-nearest moving cell centre: near zero on cell walls
float walls(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * hash2(n + g));
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  return f2 - f1;
}

void main() {
  vec2 px = vUv * uRes;
  vec2 p = px / 185.0;
  float t = uTime * 0.55;
  p += 0.22 * vec2(sin(p.y * 1.3 + t * 0.9), cos(p.x * 1.1 - t * 0.7));
  // the cursor bends the light like a finger in the water
  vec2 dp = px - uPointer;
  float lens = uNear * exp(-dot(dp, dp) / 26000.0);
  p += normalize(dp + 0.001) * lens * 0.35;
  float e = min(walls(p, t), walls(p * 1.35 + 4.1, t * 1.2 + 1.7));
  // thin filaments, the way light actually focuses through a wave
  float net = 1.0 - smoothstep(0.0, 0.016 + lens * 0.012, e);
  net += (1.0 - smoothstep(0.0, 0.1, e)) * 0.22; // soft halo around each filament
  // brightest near the surface, fading as the tier sinks toward the thermocline
  float sun = mix(0.35, 1.0, smoothstep(0.0, 0.85, vUv.y));

  // a few bubbles rising in loose columns
  float bubbles = 0.0;
  for (int k = 0; k < 14; k++) {
    float fk = float(k);
    vec2 h = hash2(vec2(fk, 7.3));
    float speed = 38.0 + 40.0 * h.y;
    float y = mod(uTime * speed + h.x * uRes.y * 3.0, uRes.y + 80.0) - 40.0;
    float x = h.x * uRes.x + sin(uTime * 1.7 + fk) * 9.0;
    float r = 2.0 + 4.0 * fract(h.x * 13.1);
    float d = length(px - vec2(x, y));
    bubbles += smoothstep(1.2, 0.0, abs(d - r)) * 0.9 + smoothstep(r * 0.6, 0.0, length(px - vec2(x - r * 0.35, y + r * 0.35))) * 0.5;
  }
  float a = (net * sun + bubbles * 0.8) * uAlpha;
  gl_FragColor = vec4(uInk, a);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Caustic light on the Shoreline tier. Throws without WebGL. */
export function mountCaustics(canvas: HTMLCanvasElement, theme: Theme): Caustics {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const uniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uInk: { value: new THREE.Color(INK[theme].color) },
    uAlpha: { value: INK[theme].alpha },
    uPointer: { value: new THREE.Vector2(-1e4, -1e4) },
    uNear: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  const loop = runLoop(canvas, {
    maxDpr: 1.25, // soft light needs no retina pixels; keeps the fragment cost flat
    still: 3,
    resize: (w, h, dpr) => {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(w, h);
    },
    frame: ({ h, t, dt, pointer }) => {
      uniforms.uTime.value = t;
      // ease the lens in and out so it never pops
      uniforms.uNear.value += ((pointer.on ? 1 : 0) - uniforms.uNear.value) * Math.min(1, dt * 4);
      if (pointer.on) uniforms.uPointer.value.set(pointer.x, h - pointer.y);
      renderer.render(scene, camera);
    },
  });

  return {
    setTheme: (t) => {
      uniforms.uInk.value.set(INK[t].color);
      uniforms.uAlpha.value = INK[t].alpha;
      loop.redraw();
    },
    dispose: () => {
      loop.stop();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
