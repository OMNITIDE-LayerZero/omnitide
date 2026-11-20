import { describe, expect, it } from "vitest";
import { sparkGeometry, tideGradient, usSession, windowLabel } from "./landing";

describe("US session", () => {
  // 2026-11-20 is a Friday; New York is on EST (UTC−5)
  it("reads the New York clock", () => {
    expect(usSession(new Date("2026-11-20T15:00:00Z"))).toBe("open");
    expect(usSession(new Date("2026-11-20T14:29:00Z"))).toBe("pre");
    expect(usSession(new Date("2026-11-20T14:30:00Z"))).toBe("open");
    expect(usSession(new Date("2026-11-20T21:00:00Z"))).toBe("after");
    expect(usSession(new Date("2026-11-21T02:00:00Z"))).toBe("closed");
    expect(usSession(new Date("2026-11-21T15:00:00Z"))).toBe("closed");
  });
});

describe("sparkline geometry", () => {
  it("spans the box with the high on top and the low at the bottom", () => {
    const { xy, line, area } = sparkGeometry([1, 3, 2], 100, 20);
    expect(xy[0]).toEqual([0, 18]);
    expect(xy[1]).toEqual([50, 2]);
    expect(xy[2]![0]).toBe(100);
    expect(line.startsWith("M0.0,18.0")).toBe(true);
    expect(area.endsWith("L100,20L0,20Z")).toBe(true);
  });

  it("draws a flat series on the midline", () => {
    expect(sparkGeometry([5, 5, 5], 10, 20).xy.every(([, y]) => y === 10)).toBe(true);
  });
});

describe("rate-limit window", () => {
  it("prefers hours", () => {
    expect(windowLabel(86400)).toBe("24h");
    expect(windowLabel(600)).toBe("10m");
  });
});

describe("tideGradient", () => {
  it("eases from one colour to the other, flat at both ends", () => {
    const g = tideGradient("red", "blue", 4);
    expect(g).toBe("linear-gradient(to bottom, color-mix(in oklab, blue 0%, red), color-mix(in oklab, blue 15.63%, red), color-mix(in oklab, blue 50%, red), color-mix(in oklab, blue 84.38%, red), color-mix(in oklab, blue 100%, red))");
  });
});
