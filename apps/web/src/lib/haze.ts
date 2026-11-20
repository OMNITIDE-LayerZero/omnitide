/** A full-bleed surface under the header haze: its extent in viewport px and its colours, evenly spaced top to bottom (one for a flat surface). */
export interface Surface {
  top: number;
  bottom: number;
  colors: string[];
}

const SEAM = 40; // px the tint takes to cross a seam, about as far as the wave edges hang

/** Perceptual lightness 0..1 of a computed CSS colour: rgb(), color(srgb), oklab/oklch, lab/lch. */
export function lightness(c: string) {
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  if (/^(ok)?l(ab|ch)\(/.test(c)) return n[0]! > 1 ? n[0]! / 100 : n[0]!;
  const [r = 1, g = 1, b = 1] = c.startsWith("rgb") ? n.map((v) => v / 255) : n;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return Math.cbrt(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
}

/** The haze tint as a gradient that tracks the surfaces beneath it, and whether the nav line at y sits on a dark one. */
export function haze(surfaces: Surface[], y: number) {
  const seam = (a?: string, b?: string) => (a === undefined || b === undefined || a === b ? 0 : SEAM / 2);
  const stops = surfaces.flatMap((s, i): [string, number][] => {
    if (s.colors.length > 1) return s.colors.map((c, k) => [c, s.top + ((s.bottom - s.top) * k) / (s.colors.length - 1)]);
    const c = s.colors[0]!;
    return [
      [c, s.top + seam(surfaces[i - 1]?.colors.at(-1), c)],
      [c, s.bottom - seam(c, surfaces[i + 1]?.colors[0])],
    ];
  });
  if (!stops.length) return { tint: "", dark: false };
  // lightness under the nav line, linear between the stops around it
  let l = lightness(stops[0]![0]);
  for (let k = 1; k < stops.length && stops[k - 1]![1] < y; k++) {
    const [[c0, p0], [c1, p1]] = [stops[k - 1]!, stops[k]!];
    l = p1 > y && p1 > p0 ? lightness(c0) + ((lightness(c1) - lightness(c0)) * (y - p0)) / (p1 - p0) : lightness(c1);
  }
  const px = (v: number) => `${Math.round(Math.min(1000, Math.max(-1000, v)))}px`;
  return { tint: `linear-gradient(to bottom, ${stops.map(([c, p]) => `${c} ${px(p)}`).join(", ")})`, dark: l < 0.6 };
}
