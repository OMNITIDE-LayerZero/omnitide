import * as THREE from "three";
import type { ChainKey } from "@omnitide/contracts/chains";

const TAU = Math.PI * 2;
const RING = 6.4; // spoke ports sit on this circle around the hub
const RIM = 3; // where ships leave the sea lane and ride the vortex
const SPEED = 1.7; // sea units per second
const HULL = 1.45; // ship scale
const HUB_Y = -0.75; // the lighthouse stands in the vortex eye
const LANTERN_Y = HUB_Y + 2.73;
const INK = new THREE.Color("#ffffff");
const ACCENT = new THREE.Color("#8ea2ff");
const GLOW = new THREE.Color("#dfe5ff");
const FILL = new THREE.Color("#0a1260");

export type Harbor = { focus: (k: ChainKey | null) => void; send: (k: ChainKey) => void; setSwell: (s: number) => void; dispose: () => void };
type Opts = {
  hub: ChainKey;
  spokes: ChainKey[];
  lanes: [ChainKey, ChainKey][];
  route: (k: ChainKey) => ChainKey[];
  labels: Partial<Record<ChainKey, HTMLElement | null>>;
  onHover: (k: ChainKey | null) => void;
  onLand: (k: ChainKey) => void;
  onReady: () => void;
};
type Lane = { a: ChainKey; b: ChainKey; arc: THREE.QuadraticBezierCurve3; mat: THREE.LineBasicMaterial; base: number };
type Leg = { sea: THREE.QuadraticBezierCurve3; len: number; lane: Lane; flip: boolean; to: ChainKey };
type Ship = { k: ChainKey; legs: Leg[]; leg: number; t: number; wait: number; spiral: number; a0: number; seed: number; obj: THREE.Group; comet: THREE.Mesh; trail: THREE.Line };
type Pulse = { mesh: THREE.Mesh; life: number; size: number };

/** Sea height without the vortex twist; the sea shader uses the same terms. */
function surf(x: number, z: number, t: number, amp: number) {
  return amp * (0.12 * Math.sin(x * 0.7 + t * 1.1) + 0.08 * Math.sin(z * 1.1 - t * 0.8 + x * 0.3)) - 0.9 * Math.exp(-(x * x + z * z) * 0.35);
}

const SEA_VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uSize;
varying float vAlpha; varying float vTint;
void main() {
  vec3 p = position;
  float r = length(p.xz);
  float w = 1.0 - smoothstep(0.0, 4.5, r);
  float a = uTime * 0.9 * w * w;
  p.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xz;
  p.y = uAmp * (0.12 * sin(p.x * 0.7 + uTime * 1.1) + 0.08 * sin(p.z * 1.1 - uTime * 0.8 + p.x * 0.3)) - 0.9 * exp(-r * r * 0.35);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.7 + 0.5 * w) * 10.0 / -mv.z;
  vAlpha = (1.0 - smoothstep(8.5, 14.0, length(p.xz * vec2(0.72, 1.0)))) * (0.4 + 0.6 * w);
  vTint = w;
}`;
const VORTEX_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform float uSize;
varying float vAlpha; varying float vTint;
void main() {
  float t = fract(uTime * 0.11 + aSeed);
  float r = mix(3.4, 0.75, t);
  float a = aSeed * 6283.0 + t * 10.0;
  vec3 p = vec3(cos(a) * r, -0.9 * exp(-r * r * 0.35) + 0.05, sin(a) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 + t) * 10.0 / -mv.z;
  vAlpha = sin(t * 3.14159) * 0.85;
  vTint = 1.0;
}`;
const DOT_FRAG = /* glsl */ `
uniform vec3 uInk; uniform vec3 uAccent;
varying float vAlpha; varying float vTint;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vec4(mix(uInk, uAccent, vTint), vAlpha * 0.75);
}`;

const ISLAND = [[1.35, -0.25], [1.3, 0], [1.1, 0.18], [0.82, 0.38], [0.5, 0.56], [0.22, 0.7], [0, 0.74]] as const;
const TOWER = [[0, 0], [0.7, 0], [0.66, 0.2], [0.42, 2.4], [0.56, 2.45], [0.56, 2.52], [0, 2.52]] as const;

/** Radius of a lathe profile at height h (profiles rise monotonically). */
function radiusAt(profile: readonly (readonly [number, number])[], h: number) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1]!;
    const [r1, y1] = profile[i]!;
    if (h <= y1 && y1 > y0) return r0 + ((h - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
}

const loop = (n: number, at: (a: number) => THREE.Vector3) => new THREE.BufferGeometry().setFromPoints(Array.from({ length: n }, (_, i) => at((i / n) * TAU)));

/** Mount the 3D harbor chart on a canvas. Throws when WebGL is unavailable. */
export function mountHarbor(canvas: HTMLCanvasElement, o: Opts): Harbor {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 100);
  const target = new THREE.Vector3(0, 0.3, 0);

  const fillMat = new THREE.MeshBasicMaterial({ color: FILL, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const lineMat = (opacity: number, color = INK) => new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const uniforms = { uTime: { value: 0 }, uAmp: { value: 1 }, uSize: { value: 3 }, uInk: { value: INK }, uAccent: { value: ACCENT } };

  // sea: an engraved stipple field that twists into the hub's vortex
  {
    const NX = 150;
    const NZ = 110;
    const pos = new Float32Array(NX * NZ * 3);
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NZ; j++) {
        const n = (i * NZ + j) * 3;
        pos[n] = (i / (NX - 1) - 0.5) * 30 + (Math.random() - 0.5) * 0.08;
        pos[n + 2] = (j / (NZ - 1) - 0.5) * 22 + (Math.random() - 0.5) * 0.08;
      }
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms, vertexShader: SEA_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false })));
  }
  // vortex: currents spiralling into the one book
  {
    const N = 700;
    const g = new THREE.BufferGeometry()
      .setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3))
      .setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: N }, Math.random), 1));
    const v = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms, vertexShader: VORTEX_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    v.frustumCulled = false; // positions come from the shader
    scene.add(v);
  }
  // chart rings
  for (const r of [RIM + 0.2, 9]) {
    const l = new THREE.LineLoop(loop(160, (a) => new THREE.Vector3(Math.cos(a) * r, 0.06, Math.sin(a) * r)), new THREE.LineDashedMaterial({ color: INK, transparent: true, opacity: 0.12, dashSize: 0.12, gapSize: 0.26 }));
    l.computeLineDistances();
    scene.add(l);
  }

  // ports: spokes as contoured islands, the hub as a lighthouse
  const at: Partial<Record<ChainKey, THREE.Vector3>> = { [o.hub]: new THREE.Vector3(0, 0, 0) };
  o.spokes.forEach((k, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) * TAU) / o.spokes.length;
    at[k] = new THREE.Vector3(Math.cos(a) * RING, 0, Math.sin(a) * RING);
  });
  const P = (k: ChainKey) => at[k]!;
  const beacon = (k: ChainKey) => (k === o.hub ? new THREE.Vector3(0, LANTERN_Y, 0) : P(k).clone().setY(1.1));
  const portLines: Partial<Record<ChainKey, THREE.LineBasicMaterial>> = {};
  const hits: THREE.Mesh[] = [];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  o.spokes.forEach((k, i) => {
    const g = new THREE.Group();
    g.position.copy(P(k));
    const seed = i * 2.17 + 0.6;
    const bump = (a: number) => 1 + 0.09 * Math.sin(3 * a + seed) + 0.05 * Math.sin(5 * a + seed * 2.3) + 0.03 * Math.sin(9 * a + seed * 4.1);
    const lathe = new THREE.LatheGeometry(ISLAND.map(([r, y]) => new THREE.Vector2(r, y)), 72);
    const lp = lathe.attributes.position!;
    for (let n = 0; n < lp.count; n++) {
      const b = bump(Math.atan2(lp.getZ(n), lp.getX(n)));
      lp.setXYZ(n, lp.getX(n) * b, lp.getY(n), lp.getZ(n) * b);
    }
    g.add(new THREE.Mesh(lathe, fillMat));
    const lines = lineMat(0.55);
    for (let h = 0.04; h < 0.7; h += 0.11) {
      const r = radiusAt(ISLAND, h) * 1.015;
      g.add(new THREE.LineLoop(loop(96, (a) => new THREE.Vector3(Math.cos(a) * r * bump(a), h, Math.sin(a) * r * bump(a))), lines));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.74, 0), new THREE.Vector3(0, 1.05, 0)]), lines));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: ACCENT }));
    lamp.position.y = 1.1;
    g.add(lamp);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), hitMat);
    hit.position.y = 0.4;
    hit.userData.k = k;
    g.add(hit);
    hits.push(hit);
    portLines[k] = lines;
    scene.add(g);
  });

  const lantern = new THREE.MeshBasicMaterial({ color: GLOW.clone() });
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Group();
  {
    const g = new THREE.Group();
    g.position.y = HUB_Y;
    g.add(new THREE.Mesh(new THREE.LatheGeometry(TOWER.map(([r, y]) => new THREE.Vector2(r, y)), 48), fillMat));
    const lines = lineMat(0.7);
    for (const h of [0.2, 0.6, 1, 1.4, 1.8, 2.2, 2.45, 2.52]) {
      const r = (h >= 2.45 ? 0.56 : radiusAt(TOWER, h)) * 1.015;
      g.add(new THREE.LineLoop(loop(48, (a) => new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r)), lines));
    }
    for (let m = 0; m < 10; m++) {
      const a = (m / 10) * TAU;
      const pts = [0.2, 0.8, 1.4, 2, 2.4].map((h) => new THREE.Vector3(Math.cos(a) * radiusAt(TOWER, h) * 1.015, h, Math.sin(a) * radiusAt(TOWER, h) * 1.015));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lines));
    }
    const room = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 20, 1, true), lantern);
    room.position.y = 2.73;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.38, 20), fillMat);
    cap.position.y = 3.13;
    const capEdge = new THREE.LineSegments(new THREE.EdgesGeometry(cap.geometry, 30), lines);
    capEdge.position.y = 3.13;
    g.add(room, cap, capEdge);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.6, 12), hitMat);
    hit.position.y = 1.6;
    hit.userData.k = o.hub;
    g.add(hit);
    hits.push(hit);
    portLines[o.hub] = lines;
    scene.add(g);

    // two beams sweeping the water from the lantern
    beam.position.y = LANTERN_Y;
    const cone = new THREE.ConeGeometry(1.3, 7, 32, 8, true).translate(0, -3.5, 0);
    const cy = cone.attributes.position!;
    // fade from the lantern out to sea so the beam never ends on a hard edge
    cone.setAttribute("color", new THREE.BufferAttribute(Float32Array.from({ length: cy.count * 4 }, (_, i) => (i % 4 < 3 ? [ACCENT.r, ACCENT.g, ACCENT.b][i % 4]! : (1 + cy.getY(Math.floor(i / 4)) / 7) ** 1.6)), 4));
    cone.rotateZ(Math.PI / 2 - 0.12);
    beam.add(new THREE.Mesh(cone, beamMat), new THREE.Mesh(cone, beamMat).rotateY(Math.PI));
    scene.add(beam);
  }

  // LayerZero lanes: arcs above the water, hub lanes solid, the rest dashed
  const lanes: Lane[] = o.lanes.map(([a, b]) => {
    const pa = beacon(a);
    const pb = beacon(b);
    const mid = pa.clone().lerp(pb, 0.5);
    mid.y += pa.distanceTo(pb) * 0.24 + 0.4;
    const arc = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const hub = a === o.hub || b === o.hub;
    const base = hub ? 0.6 : 0.3;
    const mat = hub ? lineMat(base) : new THREE.LineDashedMaterial({ color: INK, transparent: true, opacity: base, dashSize: 0.16, gapSize: 0.22 });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc.getPoints(80)), mat);
    if (!hub) line.computeLineDistances();
    scene.add(line);
    return { a, b, arc, mat, base };
  });
  const laneOf = (a: ChainKey, b: ChainKey) => lanes.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))!;

  // ships: deposit hulls on the water, a light running the lane overhead
  const hullGeo = new THREE.ConeGeometry(0.13, 0.6, 4).rotateX(Math.PI / 2).scale(1, 0.55, 1);
  const hullEdge = new THREE.EdgesGeometry(hullGeo);
  const sailGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0.04, -0.16, 0, 0.04, 0.16, 0, 0.46, -0.06]), 3));
  const sailMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const shipLine = lineMat(0.9);
  const cometGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const cometMat = new THREE.MeshBasicMaterial({ color: GLOW });
  const trailMat = lineMat(0.9, ACCENT);
  const TRAIL = 18;

  const seaLeg = (a: ChainKey, b: ChainKey): Leg => {
    const pa = P(a);
    const pb = P(b);
    const dir = pb.clone().sub(pa).normalize();
    const start = pa.clone().addScaledVector(dir, 1.55);
    const end = b === o.hub ? pa.clone().normalize().multiplyScalar(RIM) : pb.clone().addScaledVector(dir, -1.55);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(start.distanceTo(end) * 0.14 * (Math.random() < 0.5 ? -1 : 1));
    const sea = new THREE.QuadraticBezierCurve3(start, start.clone().lerp(end, 0.5).add(side), end);
    const lane = laneOf(a, b);
    return { sea, len: sea.getLength(), lane, flip: lane.a !== a, to: b };
  };

  const ships: Ship[] = [];
  const pulses: Pulse[] = [];
  const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
  const pulse = (p: THREE.Vector3, size: number) => {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(p);
    scene.add(mesh);
    pulses.push({ mesh, life: 0, size });
  };

  const launch = (k: ChainKey) => {
    if (ships.length > 14) return;
    const path = [k, ...o.route(k)];
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(hullGeo, fillMat), new THREE.LineSegments(hullEdge, shipLine), new THREE.Mesh(sailGeo, sailMat));
    obj.scale.setScalar(0);
    const comet = new THREE.Mesh(cometGeo, cometMat);
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: TRAIL }, () => new THREE.Vector3())), trailMat);
    trail.frustumCulled = false;
    scene.add(obj, comet, trail);
    ships.push({ k, legs: path.slice(1).map((b, i) => seaLeg(path[i]!, b)), leg: 0, t: 0, wait: 0, spiral: -1, a0: 0, seed: Math.random() * TAU, obj, comet, trail });
  };

  let time = 0;
  let amp = 1;
  let ampTarget = 1;
  let flash = 0;
  const tmp = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  const step = (s: Ship, dt: number) => {
    if (s.wait > 0) {
      s.wait -= dt;
      return true;
    }
    if (s.spiral >= 0) {
      s.spiral = Math.min(1, s.spiral + dt / 2.6);
      const r = RIM + (0.95 - RIM) * s.spiral;
      const a = s.a0 + s.spiral * TAU * 1.15;
      s.obj.position.set(Math.cos(a) * r, surf(Math.cos(a) * r, Math.sin(a) * r, time, amp) + 0.02, Math.sin(a) * r);
      s.obj.lookAt(Math.cos(a + 0.15) * r, s.obj.position.y, Math.sin(a + 0.15) * r);
      s.obj.scale.setScalar(HULL * (1 - s.spiral ** 3));
      if (s.spiral < 1) return true;
      pulse(new THREE.Vector3(0, HUB_Y + 0.15, 0), 4.6);
      flash = 1;
      o.onLand(s.k);
      return false;
    }
    const leg = s.legs[s.leg]!;
    s.t = Math.min(1, s.t + (dt * SPEED) / leg.len);
    leg.sea.getPoint(s.t, tmp);
    leg.sea.getPoint(Math.min(1, s.t + 0.02), ahead);
    tmp.y = surf(tmp.x, tmp.z, time, amp) + 0.02;
    s.obj.position.copy(tmp);
    s.obj.lookAt(ahead.x, tmp.y, ahead.z);
    s.obj.rotateZ(Math.sin(time * 2.6 + s.seed) * 0.09);
    if (s.leg === 0) s.obj.scale.setScalar(HULL * Math.min(1, s.t * 10));
    const u = leg.flip ? 1 - s.t : s.t;
    leg.lane.arc.getPoint(u, s.comet.position);
    const tp = s.trail.geometry.attributes.position!;
    for (let i = 0; i < TRAIL; i++) {
      const v = Math.max(0, Math.min(1, u + (leg.flip ? 1 : -1) * 0.12 * (i / (TRAIL - 1))));
      leg.lane.arc.getPoint(v, ahead);
      tp.setXYZ(i, ahead.x, ahead.y, ahead.z);
    }
    tp.needsUpdate = true;
    if (s.t < 1) return true;
    if (leg.to === o.hub) {
      s.spiral = 0;
      s.a0 = Math.atan2(tmp.z, tmp.x);
      s.comet.visible = s.trail.visible = false;
      return true;
    }
    // relay port: dock, then take the next lane
    pulse(P(leg.to).clone().setY(0.05), 2.2);
    s.leg++;
    s.t = 0;
    s.wait = 0.6;
    return true;
  };

  // focus: light the lanes a chain's deposits travel, dim the rest
  const focus = (k: ChainKey | null) => {
    const path = k ? [k, ...o.route(k)] : [];
    const onPath = (l: Lane) => (k === o.hub ? l.a === k || l.b === k : path.some((c, i) => i > 0 && ((path[i - 1] === l.a && c === l.b) || (path[i - 1] === l.b && c === l.a))));
    for (const l of lanes) {
      const lit = !!k && onPath(l);
      l.mat.color.copy(lit ? ACCENT : INK);
      l.mat.opacity = lit ? 1 : k ? l.base * 0.4 : l.base;
    }
    for (const [c, m] of Object.entries(portLines) as [ChainKey, THREE.LineBasicMaterial][]) {
      const lit = !k || path.includes(c) || k === o.hub;
      m.color.copy(c === k ? ACCENT : INK);
      m.opacity = c === o.hub ? (lit ? 0.7 : 0.35) : lit ? (c === k ? 1 : 0.55) : 0.25;
    }
  };
  const send = (k: ChainKey) => {
    if (k === o.hub) o.spokes.forEach(launch);
    else launch(k);
  };

  // camera: a slow drift, drag to turn, tap a port to send a ship
  let az = 0.35;
  let el = 0.98;
  let dist = 18;
  let w = 1;
  let h = 1;
  const place = () => {
    camera.position.set(target.x + dist * Math.sin(el) * Math.sin(az), target.y + dist * Math.cos(el), target.z + dist * Math.sin(el) * Math.cos(az));
    camera.lookAt(target);
  };
  const resize = () => {
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dist = Math.max(15, 8.4 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    uniforms.uSize.value = 3 * pr;
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hover: ChainKey | null = null;
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const pick = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const k = (ray.intersectObjects(hits, false)[0]?.object.userData.k as ChainKey | undefined) ?? null;
    if (k !== hover) {
      hover = k;
      o.onHover(k);
    }
    canvas.style.cursor = drag?.moved ? "grabbing" : k ? "pointer" : "grab";
  };
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    pick(e);
  };
  const onMove = (e: PointerEvent) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        canvas.setPointerCapture(e.pointerId);
      }
      if (drag.moved) {
        az -= dx * 0.006;
        el = Math.max(0.7, Math.min(1.18, el - dy * 0.004));
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    }
    pick(e);
  };
  const onUp = (e: PointerEvent) => {
    if (drag && !drag.moved) {
      pick(e);
      if (hover) send(hover);
    }
    drag = null;
    if (e.pointerType !== "mouse" && hover) {
      hover = null;
      o.onHover(null);
    }
  };
  const onLeave = () => {
    drag = null;
    if (hover) {
      hover = null;
      o.onHover(null);
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onLeave);
  canvas.addEventListener("pointerleave", onLeave);

  // the hub's label hangs under the tower so it never lands on a spoke's label behind it
  const labelAt = (k: ChainKey) => (k === o.hub ? new THREE.Vector3(0, HUB_Y, 0) : P(k).clone().setY(1.45));
  const anchors = [...o.spokes, o.hub].map((k) => [k, labelAt(k)] as const);
  const nextAt = Object.fromEntries(o.spokes.map((k, i) => [k, 0.3 + i * 1.4])) as Record<ChainKey, number>;

  let last = 0;
  let ready = false;
  const frame = (now: number) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    time += dt;
    uniforms.uTime.value = time;
    amp += (ampTarget - amp) * Math.min(1, dt * 0.8);
    uniforms.uAmp.value = amp;
    if (!drag && !hover) az += dt * 0.045;
    place();

    for (const k of o.spokes)
      if (time >= nextAt[k]) {
        launch(k);
        nextAt[k] = time + 5.2 + Math.random() * 2.6;
      }
    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i]!;
      if (step(s, dt)) continue;
      scene.remove(s.obj, s.comet, s.trail);
      s.trail.geometry.dispose();
      ships.splice(i, 1);
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]!;
      p.life += dt / 1.5;
      p.mesh.scale.setScalar(1 + p.life * p.size);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p.life) ** 2;
      if (p.life < 1) continue;
      scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      pulses.splice(i, 1);
    }
    flash = Math.max(0, flash - dt * 1.1);
    beam.rotation.y += dt * (0.55 + flash * 2.5);
    beamMat.opacity = 0.1 + flash * 0.3;
    lantern.color.copy(GLOW).lerp(INK, flash);

    renderer.render(scene, camera);
    // spokes sit above their port; the hub hangs under its tower and steps down past any spoke label it would cover
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    const sizes = anchors.map(([k]) => [o.labels[k]?.offsetWidth ?? 0, o.labels[k]?.offsetHeight ?? 0] as const); // all reads before any write
    for (const [i, [k, p]] of anchors.entries()) {
      const el = o.labels[k];
      if (!el) continue;
      tmp.copy(p).project(camera);
      const x = ((tmp.x + 1) / 2) * w;
      let y = ((1 - tmp.y) / 2) * h;
      const [lw, lh] = sizes[i]!;
      if (k === o.hub) {
        y += 18;
        for (const bx of boxes) if (x - lw / 2 < bx.r && x + lw / 2 > bx.l && y < bx.b && y + lh > bx.t) y = bx.b + 4;
        el.style.transform = `translate3d(${x - lw / 2}px, ${y}px, 0)`;
      } else {
        boxes.push({ l: x - lw / 2, r: x + lw / 2, t: y - lh, b: y });
        el.style.transform = `translate3d(${x - lw / 2}px, ${y - lh}px, 0)`;
      }
    }
    if (!ready) {
      ready = true;
      o.onReady();
    }
  };

  let raf = 0;
  let running = false;
  let visible = true;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    frame(now);
  };
  const play = () => {
    if (running || !visible || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) play();
    else pause();
  });
  io.observe(canvas);
  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener("visibilitychange", onVisibility);
  resize();
  play();

  return {
    focus,
    send,
    setSwell: (s) => (ampTarget = 0.6 + Math.max(0, Math.min(1, s)) * 0.9),
    dispose: () => {
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onLeave);
      canvas.removeEventListener("pointerleave", onLeave);
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of [m.material ?? []].flat()) mat.dispose();
      });
      renderer.dispose();
    },
  };
}
