import { describe, expect, it } from "vitest";
import { sampleParticles } from "./wave-field";

describe("wave stipple sampling", () => {
  it("keeps solid ink, drops blank paper, sorts by tone", () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) data[(y * w + x) * 4 + 3] = x < 2 ? 255 : 140;
    const pts = sampleParticles(data, w, h, 2, () => 0);
    expect(pts.every((p) => p.ox < 0.5)).toBe(true);
    expect(pts.filter((p) => p.band === 4)).toHaveLength(4);
    expect(pts.map((p) => p.band)).toEqual([...pts.map((p) => p.band)].sort());
  });
});
