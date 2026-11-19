import { describe, expect, it } from "vitest";
import { sampleLogo } from "./wave-field";

describe("logo stipple sampling", () => {
  it("drops the navy backdrop, bands paint by brightness, normalises to the mark", () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // navy everywhere, white foam in columns 2-3, deep blue in columns 4-5
        const px = x < 2 || x > 5 ? [2, 10, 35] : x < 4 ? [245, 248, 255] : [20, 50, 230];
        data.set([...px, 255], (y * w + x) * 4);
      }
    const { pts, aspect } = sampleLogo(data, w, h, 2, () => 0);
    expect(pts).toHaveLength(8);
    expect(pts.filter((p) => p.band === 4)).toHaveLength(4);
    expect(pts.filter((p) => p.band === 1)).toHaveLength(4);
    expect(pts.map((p) => p.band)).toEqual([...pts.map((p) => p.band)].sort());
    expect(Math.min(...pts.map((p) => p.ox))).toBe(0);
    expect(Math.max(...pts.map((p) => p.ox))).toBe(1);
    expect(aspect).toBeCloseTo(2 / 6);
  });
});
