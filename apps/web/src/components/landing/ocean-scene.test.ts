import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { nearestWater, pitchFor } from "./ocean-scene";

const frame = (fov: number, frac: number, height: number) => {
  const camera = new THREE.PerspectiveCamera(fov, 1.6, 0.1, 1e5);
  const pitch = pitchFor(fov, frac);
  camera.position.set(0, height, 0);
  camera.rotation.set(-pitch, 0, 0);
  camera.updateMatrixWorld();
  // screen y as a fraction from the top
  const at = (z: number) => (1 - new THREE.Vector3(0, 0, z).project(camera).y) / 2;
  return { pitch, at };
};

describe("hero ocean camera", () => {
  it("puts the horizon where the layout asks, above or below the middle", () => {
    for (const frac of [0.3, 0.47, 0.62]) expect(frame(40, frac, 2.1).at(-1e4)).toBeCloseTo(frac, 3);
  });

  it("starts the water exactly at the bottom edge of the frame", () => {
    const { pitch, at } = frame(40, 0.47, 2.1);
    expect(at(-nearestWater(40, pitch, 2.1))).toBeCloseTo(1, 6);
  });
});
