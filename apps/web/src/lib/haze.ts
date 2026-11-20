/** A full-bleed surface under the header haze: its extent in viewport px and its colour at each end (equal unless it is a gradient band). */
export interface Surface {
  top: number;
  bottom: number;
  from: string;
  to: string;
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
  const px = (v: number) => `${Math.round(Math.min(1000, Math.max(-1000, v)))}px`;
  const seam = (a?: string, b?: string) => (a === undefined || b === undefined || a === b ? 0 : SEAM / 2);
  const stops = surfaces.flatMap((s, i) => [`${s.from} ${px(s.top + seam(surfaces[i - 1]?.to, s.from))}`, `${s.to} ${px(s.bottom - seam(s.to, surfaces[i + 1]?.from))}`]);
  const at = surfaces.find((s) => s.bottom > y) ?? surfaces.at(-1);
  if (!at) return { tint: "", dark: false };
  const f = at.from === at.to ? 0 : Math.min(1, Math.max(0, (y - at.top) / (at.bottom - at.top)));
  return { tint: `linear-gradient(to bottom, ${stops.join(", ")})`, dark: lightness(at.from) * (1 - f) + lightness(at.to) * f < 0.6 };
}
