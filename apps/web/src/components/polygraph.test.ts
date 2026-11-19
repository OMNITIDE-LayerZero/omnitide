import { describe, expect, it } from "vitest";
import { signal } from "./polygraph";

describe("polygraph signal", () => {
  it("loops without a seam on every channel", () => {
    for (let c = 0; c < 6; c++) {
      expect(signal(c, 0)).toBeCloseTo(signal(c, 1 - 1e-9), 5);
      expect(Math.abs(signal(c, 0.5))).toBeLessThan(2);
    }
  });
});
