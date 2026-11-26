import * as THREE from "three";
import { runLoop } from "../canvas-loop";

const FOV = 40;
const FAR = 90;
const RIPPLES = 8;

export type Ocean = { setSwell: (s: number) => void; dispose: () => void };

/** Camera pitch in radians (positive looks down) that puts the horizon `frac` of the way down the frame. */
export function pitchFor(fovDeg: number, frac: number) {
  return Math.atan((1 - 2 * frac) * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}

/** Nearest water the bottom edge of the frame sees, for a camera `height` up and pitched `pitch` down. */
export function nearestWater(fovDeg: number, pitch: number, height: number) {
  return height / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2 + pitch);
}

// rows are spaced evenly in 1/distance, so the engraved hatch sits at an even pitch on screen from the frame edge to the horizon
const VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uNear; uniform float uFar; uniform float uSpread; uniform float uSize;
uniform vec4 uRip[${RIPPLES}];
attribute float aAccent;
varying float vAlpha; varying float vAccent; varying float vCrest;

// one Gerstner wave: deep-water speed, crests pulled toward each other so they peak like real swell
vec3 gerstner(vec2 p, vec2 dir, float len, float amp, float steep) {
  float k = 6.28318 / len;
  vec2 d = normalize(dir);
  float f = k * (dot(d, p) - sqrt(9.8 / k) * 0.55 * uTime);
  float q = steep / (k * amp * 4.0 + 0.0001);
  return vec3(d.x * q * amp * cos(f), amp * sin(f), d.y * q * amp * cos(f));
}

void main() {
  float dist = 1.0 / (1.0 / uNear + position.y * (1.0 / uFar - 1.0 / uNear));
  vec2 p = vec2(position.x * (dist * uSpread + 1.5), -dist);
  vec3 o = gerstner(p, vec2(-0.25, 1.0), 9.0, 0.32 * uAmp, 0.6)
         + gerstner(p, vec2(0.55, 0.85), 5.2, 0.16 * uAmp, 0.55)
         + gerstner(p, vec2(-0.8, 0.6), 3.1, 0.075 * uAmp, 0.45)
         + gerstner(p, vec2(0.15, 1.0), 1.7, 0.04 * uAmp * uAmp, 0.4);
  float y = o.y;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 4.0) continue;
    float d = distance(p, r.xy) - age * 2.6;
    y += r.w * 0.32 * cos(d * 3.2) * exp(-d * d * 1.1) * exp(-age * 0.95);
  }
  vec4 mv = modelViewMatrix * vec4(p.x + o.x, y, p.y + o.z, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = dist / uFar;
  vCrest = clamp(y / (0.45 * uAmp + 0.05), -1.0, 1.0);
  vAlpha = (1.0 - smoothstep(0.3, 1.0, depth)) * (0.55 + 0.45 * (1.0 - depth)) * (0.6 + 0.55 * smoothstep(-0.7, 0.9, vCrest));
  vAccent = aAccent;
  gl_PointSize = uSize * (1.0 - depth * 0.8);
}`;

const LINE_FRAG = /* glsl */ `
uniform vec3 uInk; uniform vec3 uAccent; uniform float uAlpha;
varying float vAlpha; varying float vAccent; varying float vCrest;
void main() {
  gl_FragColor = vec4(mix(uInk, uAccent, vAccent), vAlpha * uAlpha * (1.0 + vAccent * 0.35));
}`;

const FOAM_FRAG = /* glsl */ `
uniform vec3 uFoam; uniform float uAlpha;
varying float vAlpha; varying float vAccent; varying float vCrest;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vec4(uFoam, smoothstep(0.62, 0.98, vCrest) * vAlpha * uAlpha * 1.6);
}`;

/** Engraved open sea on navy: Gerstner swell whose height follows the market, a wake under the cursor and a ring where you tap. Throws without WebGL. */
export function mountOcean(canvas: HTMLCanvasElement, o: { swell: number; horizon: number }): Ocean {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.1, FAR * 1.2);
  const small = window.matchMedia("(max-width: 767px)").matches;
  const rows = small ? 96 : 88;
  const segs = small ? 150 : 260;
  const height = small ? 3.8 : 2.1; // camera height over the water; phones look from higher so the near swell stays legible

  const pos = new Float32Array(rows * segs * 3);
  const accent = new Float32Array(rows * segs);
  const index: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let s = 0; s < segs; s++) {
      const v = r * segs + s;
      pos.set([(s / (segs - 1)) * 2 - 1, r / (rows - 1), 0], v * 3);
      accent[v] = r % 7 === 3 ? 1 : 0;
      if (s < segs - 1) index.push(v, v + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAccent", new THREE.BufferAttribute(accent, 1));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // vertices move in the shader; never cull

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.45 + o.swell * 0.9 },
    uNear: { value: 5 },
    uFar: { value: FAR },
    uSpread: { value: 1 },
    uSize: { value: 2 },
    uAlpha: { value: 0.42 },
    uRip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uInk: { value: new THREE.Color("#aebbff") },
    uAccent: { value: new THREE.Color("#8ea2ff") },
    uFoam: { value: new THREE.Color("#ffffff") },
  };
  const material = (fragmentShader: string) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, transparent: true, depthWrite: false, depthTest: false });
  const lineMat = material(LINE_FRAG);
  const foamMat = material(FOAM_FRAG);
  scene.add(new THREE.LineSegments(geo, lineMat), new THREE.Points(geo, foamMat));

  const pitch = pitchFor(FOV, o.horizon);
  camera.position.set(0, height, 0);
  camera.rotation.set(-pitch, 0, 0);
  uniforms.uNear.value = nearestWater(FOV, pitch, height) * 0.92;

  // the cursor leaves a light wake on the water, a press drops a full ring
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const sea = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let slot = 0;
  let wake = { t: -1, x: 0, y: 0 };
  let pressed = -1e9;
  const drop = (x: number, y: number, w: number, h: number, t: number, strength: number) => {
    ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(sea, hit) || -hit.z > FAR * 0.5) return;
    uniforms.uRip.value[slot]!.set(hit.x, hit.z, t, strength);
    slot = (slot + 1) % RIPPLES;
    wake = { t, x, y };
  };

  let ampTarget = uniforms.uAmp.value;
  const loop = runLoop(canvas, {
    maxDpr: 1.75,
    still: 14,
    resize: (w, h, dpr) => {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      uniforms.uSpread.value = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect * 1.12;
      uniforms.uSize.value = 1.6 * dpr;
      uniforms.uAlpha.value = 0.42 * (dpr > 1.4 ? 1.3 : 1); // hairlines thin out on dense screens
    },
    frame: ({ w, h, t, dt, pointer }) => {
      uniforms.uTime.value = t;
      uniforms.uAmp.value += (ampTarget - uniforms.uAmp.value) * Math.min(1, dt * 0.9);
      if (pointer.down !== pressed) {
        pressed = pointer.down;
        drop(pointer.x, pointer.y, w, h, t, 1);
      } else if (pointer.on && t - wake.t > 0.16 && Math.hypot(pointer.x - wake.x, pointer.y - wake.y) > 18) drop(pointer.x, pointer.y, w, h, t, 0.3);
      renderer.render(scene, camera);
    },
  });

  return {
    setSwell: (s) => {
      ampTarget = 0.45 + Math.max(0, Math.min(1, s)) * 0.9;
      loop.redraw();
    },
    dispose: () => {
      loop.stop();
      geo.dispose();
      lineMat.dispose();
      foamMat.dispose();
      renderer.dispose();
    },
  };
}
