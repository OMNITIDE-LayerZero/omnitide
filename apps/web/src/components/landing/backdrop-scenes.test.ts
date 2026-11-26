import { describe, expect, it } from "vitest";
import { contour, depthAt, seamounts, waterLevel } from "./backdrop-scenes";

describe("bathymetry", () => {
  it("traces a closed ring around a single peak at the requested level", () => {
    const peaks = [{ id: "X", x: 0.5, y: 0.5, z: 1, label: "X" }];
    const w = 400;
    const h = 400;
    const cell = 10;
    const cols = w / cell + 1;
    const rows = h / cell + 1;
    const grid = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = depthAt(peaks, w, h, i * cell, j * cell);
    const segs = contour(grid, cols, rows, cell, 0.5);
    expect(segs.length).toBeGreaterThan(40);
    // every crossing lies on the 0.5 contour, within the grid's linear interpolation error
    for (let k = 0; k < segs.length; k += 2) expect(Math.abs(depthAt(peaks, w, h, segs[k]!, segs[k + 1]!) - 0.5)).toBeLessThan(0.03);
    // and the ring is centred on the peak
    const xs = segs.filter((_, k) => k % 2 === 0);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, -1);
  });

  it("raises rallies and sinks sell-offs, harder for bigger moves, on stable positions", () => {
    const a = seamounts([{ symbol: "UP", change: 4 }, { symbol: "DN", change: -1 }, { symbol: "NA" }]);
    const b = seamounts([{ symbol: "UP", change: 0.1 }, { symbol: "DN", change: -1 }, { symbol: "NA" }]);
    expect(a[0]!.z).toBeGreaterThan(b[0]!.z);
    expect(a[1]!.z).toBeLessThan(0);
    expect(a[1]!.label).toBe("DN −1.0");
    expect(a[2]!.label).toBe("NA");
    expect(a.map((p) => [p.x, p.y])).toEqual(b.map((p) => [p.x, p.y]));
  });
});

describe("sea wall water", () => {
  it("fills the lowest fifth of the band at full backing and caps overfunding", () => {
    expect(waterLevel(0)).toBeCloseTo(0.04);
    expect(waterLevel(100)).toBeCloseTo(0.2);
    expect(waterLevel(500)).toBe(waterLevel(115));
    expect(waterLevel(50)).toBeLessThan(waterLevel(100));
  });
});
