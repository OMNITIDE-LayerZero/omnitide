import { describe, expect, it } from "vitest";
import { haze, lightness } from "./haze";

const PAPER = "rgb(244, 245, 250)";
const NAVY = "rgb(16, 23, 89)";

describe("lightness", () => {
  it("reads every format Chrome computes", () => {
    expect(lightness(PAPER)).toBeGreaterThan(0.9);
    expect(lightness("rgb(31, 61, 255)")).toBeLessThan(0.6); // the Sea Wall blue takes light ink
    expect(lightness(NAVY)).toBeLessThan(0.4);
    expect(lightness("oklab(0.95 -0.004 -0.017)")).toBeCloseTo(0.95);
    expect(lightness("oklch(95% 0.01 260)")).toBeCloseTo(0.95);
    expect(lightness("color(srgb 0.02 0.03 0.16)")).toBeLessThan(0.4);
  });
});

describe("haze", () => {
  it("puts the seam where the content has it and softens it across the wave", () => {
    const h = haze([{ top: -400, bottom: 60, color: PAPER }, { top: 60, bottom: 900, color: NAVY }], 32);
    expect(h.tint).toBe(`linear-gradient(to bottom, ${PAPER} -400px, ${PAPER} 40px, ${NAVY} 80px, ${NAVY} 900px)`);
    expect(h.dark).toBe(false);
    expect(haze([{ top: -400, bottom: 20, color: PAPER }, { top: 20, bottom: 900, color: NAVY }], 32).dark).toBe(true);
  });

  it("clamps open-ended surfaces to valid lengths", () => {
    expect(haze([{ top: -Infinity, bottom: Infinity, color: PAPER }], 32).tint).toBe(`linear-gradient(to bottom, ${PAPER} -1000px, ${PAPER} 1000px)`);
  });
});
