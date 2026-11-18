"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useTheme } from "./theme";

const WAVES = 5;

const vertex = /* glsl */ `
uniform float uTime;
uniform float uSwell;
uniform vec4 uWaves[${WAVES}]; // dir.xy, steepness, wavelength
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;

vec3 gerstner(vec4 w, vec3 p, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.28318 / w.w;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(w.xy);
  float f = k * (dot(d, p.xz) - c * uTime);
  float a = (w.z * uSwell) / k;
  float s = sin(f), co = cos(f);
  tangent += vec3(-d.x * d.x * (w.z * uSwell) * s, d.x * (w.z * uSwell) * co, -d.x * d.y * (w.z * uSwell) * s);
  binormal += vec3(-d.x * d.y * (w.z * uSwell) * s, d.y * (w.z * uSwell) * co, -d.y * d.y * (w.z * uSwell) * s);
  return vec3(d.x * a * co, a * s, d.y * a * co);
}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 offset = vec3(0.0);
  for (int i = 0; i < ${WAVES}; i++) offset += gerstner(uWaves[i], p, tangent, binormal);
  p += offset;
  vNormal = normalize(cross(binormal, tangent));
  vCrest = offset.y;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uSwell;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

vec3 sky(vec3 dir) {
  float h = clamp(dir.y, 0.0, 1.0);
  return mix(uHorizon, uZenith, pow(h, 0.55));
}

void main() {
  // fine capillary ripples on top of the swell
  vec2 q = vWorld.xz * 0.9;
  float r1 = noise(q + uTime * 0.6) - 0.5;
  float r2 = noise(q * 2.3 - uTime * 0.8) - 0.5;
  vec3 n = normalize(vNormal + vec3(r1, 0.0, r2) * 0.22);

  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  vec3 refl = sky(reflect(-view, n));

  // light scattered through thin crests
  float sss = pow(max(dot(view, -uSun), 0.0), 4.0) * smoothstep(0.0, 1.2, vCrest);
  vec3 water = mix(uDeep, uShallow, clamp(vCrest * 0.45 + 0.35, 0.0, 1.0)) + uShallow * sss * 0.6;

  vec3 col = mix(water, refl, fresnel);

  vec3 h = normalize(uSun + view);
  float spec = pow(max(dot(n, h), 0.0), 380.0) * 2.4 + pow(max(dot(n, h), 0.0), 40.0) * 0.12;
  col += uSunColor * spec;

  float foam = smoothstep(0.75, 1.5, vCrest * (0.7 + uSwell * 0.5)) * noise(vWorld.xz * 3.0 + uTime);
  col = mix(col, vec3(0.94, 0.96, 1.0), foam * 0.55);

  // haze into the horizon so the sea meets the sky without a seam
  float dist = length(vWorld.xz - cameraPosition.xz);
  col = mix(col, uHorizon, smoothstep(40.0, 190.0, dist));

  // a whisper of engraving in the troughs, the brand's print texture
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y * 0.6) / 3.0));
  col *= 1.0 - hatch * 0.06 * (1.0 - smoothstep(0.15, 0.55, luma));

  gl_FragColor = vec4(col, 1.0);
}
`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform mat4 uInvProj;
uniform mat4 uInvView;
varying vec2 vUv;
void main() {
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 eye = uInvProj * clip;
  vec3 dir = normalize((uInvView * vec4(eye.xyz / eye.w, 0.0)).xyz);
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  float d = max(dot(dir, uSun), 0.0);
  col += uSunColor * (smoothstep(0.99965, 0.99985, d) * 1.2 + pow(d, 60.0) * 0.18 + pow(d, 8.0) * 0.05);
  gl_FragColor = vec4(col, 1.0);
}
`;

const PALETTES = {
  light: { zenith: "#c9d4ff", horizon: "#f1f3fb", deep: "#0a1d6e", shallow: "#2f5bd9", sun: "#fff6e8", sunY: 0.07 },
  dark: { zenith: "#03051a", horizon: "#141a40", deep: "#020619", shallow: "#0d2a7a", sun: "#c6d3ff", sunY: 0.09 },
} as const;

/** Live sea for the hero. `swell` 0..1 follows how much the market is moving. */
export function Ocean({ swell = 0.5, className = "" }: { swell?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setTheme: (t: "light" | "dark") => void; setSwell: (s: number) => void } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the CSS sky gradient behind stays as the hero
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    camera.position.set(0, 5.2, 18);
    camera.lookAt(0, 7.4, -40); // horizon sits low so the headline and subhead stay on open sky

    const sun = new THREE.Vector3();
    const shared = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSun: { value: sun },
      uSunColor: { value: new THREE.Color() },
    };

    const waves = [
      new THREE.Vector4(1.0, 0.25, 0.22, 34),
      new THREE.Vector4(0.8, 0.6, 0.2, 21),
      new THREE.Vector4(0.3, 1.0, 0.16, 13),
      new THREE.Vector4(-0.4, 0.9, 0.12, 7.5),
      new THREE.Vector4(0.9, -0.2, 0.08, 4.2),
    ];
    const sea = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...shared,
        uTime: { value: 0 },
        uSwell: { value: swell },
        uWaves: { value: waves },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
      },
    });
    const geo = new THREE.PlaneGeometry(420, 420, 300, 300);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -150);
    scene.add(new THREE.Mesh(geo, sea));

    const skyMat = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }",
      fragmentShader: skyFragment,
      uniforms: { ...shared, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() } },
      depthWrite: false,
    });
    const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -1;
    scene.add(skyMesh);

    let azimuth = 0.32;
    let targetAz = azimuth;
    let sunY = 0.16;
    const placeSun = () => sun.set(Math.sin(azimuth), sunY, -Math.cos(azimuth)).normalize();

    const applyTheme = (t: "light" | "dark") => {
      const p = PALETTES[t];
      shared.uZenith.value.set(p.zenith);
      shared.uHorizon.value.set(p.horizon);
      shared.uSunColor.value.set(p.sun);
      sea.uniforms.uDeep!.value.set(p.deep);
      sea.uniforms.uShallow!.value.set(p.shallow);
      sunY = p.sunY;
      placeSun();
    };
    applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      skyMat.uniforms.uInvProj!.value.copy(camera.projectionMatrixInverse);
      skyMat.uniforms.uInvView!.value.copy(camera.matrixWorld);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(el);

    // the moon/sun glint follows the pointer across the horizon
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      targetAz = 0.32 + ((e.clientX - r.left) / r.width - 0.5) * 0.5;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const clock = new THREE.Clock();
    let swellNow = swell;
    let swellTarget = swell;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      azimuth += (targetAz - azimuth) * Math.min(1, dt * 2.5);
      swellNow += (swellTarget - swellNow) * Math.min(1, dt * 0.8);
      placeSun();
      sea.uniforms.uTime!.value += dt;
      sea.uniforms.uSwell!.value = 0.55 + swellNow * 0.9;
      renderer.render(scene, camera);
    };
    if (reduced) {
      sea.uniforms.uTime!.value = 12;
      renderer.render(scene, camera);
    } else frame();

    api.current = {
      setTheme: (t) => {
        applyTheme(t);
        if (reduced) renderer.render(scene, camera);
      },
      setSwell: (s) => (swellTarget = Math.max(0, Math.min(1, s))),
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      ro.disconnect();
      io.disconnect();
      geo.dispose();
      sea.dispose();
      skyMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // the scene is built once; theme and swell flow in through api.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    api.current?.setSwell(swell);
  }, [swell]);

  return <div ref={host} aria-hidden className={`bg-gradient-to-b from-[#c9d4ff] to-[#f1f3fb] dark:from-[#03051a] dark:to-[#141a40] ${className}`} />;
}
