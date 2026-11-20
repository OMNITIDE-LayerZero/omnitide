import { BADGES } from "@omnitide/contracts/deep";

// one engraved glyph per badge kind, drawn on a 100×100 grid around the medal centre
const GLYPHS = [
  "M38 62 L50 34 L62 62 M43 52 H57", // First Fill: a peak
  "M30 50 Q40 38 50 50 T70 50 M30 60 Q40 48 50 60 T70 60 M62 42 L70 50 L62 58", // Inflow: incoming swell
  "M50 32 V66 M40 40 H60 M34 58 Q50 74 66 58", // Harbor: anchor
  "M50 30 L56 46 L72 46 L59 56 L64 72 L50 62 L36 72 L41 56 L28 46 L44 46 Z", // Grade A: star
  "M30 56 Q38 40 46 56 T62 56 T78 56 M44 36 L40 46 H48 L44 54", // Storm: lightning over sea
  "M50 30 V70 M42 62 L50 70 L58 62 M36 42 H64 M40 50 H60", // Deep Diver: sounding line
  "M36 66 V44 L50 34 L64 44 V66 Z M44 66 V54 H56 V66", // Council: hall
  "M46 70 L48 40 H52 L54 70 Z M50 40 V30 M38 34 L30 30 M62 34 L70 30 M40 40 L30 42 M60 40 L70 42", // Lighthouse
];

/** Arena Badge artwork as standalone SVG, shared by the terminal and the ERC-721 metadata route. */
export function badgeSvg(kind: number, tokenId?: number | string) {
  const b = BADGES[kind] ?? BADGES[0];
  const rings = Array.from({ length: 9 }, (_, i) => `<circle cx="50" cy="50" r="${44 - i * 1.4}" fill="none" stroke="#1f3dff" stroke-opacity="${0.15 + (i % 3) * 0.08}" stroke-width="0.35"/>`).join("");
  const hatch = Array.from({ length: 24 }, (_, i) => `<line x1="${8 + i * 3.6}" y1="84" x2="${14 + i * 3.6}" y2="92" stroke="#0b1530" stroke-opacity="0.18" stroke-width="0.4"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="400" height="480">
<rect width="100" height="120" fill="#f6f3ea"/>
${hatch}
<circle cx="50" cy="50" r="46" fill="#f6f3ea" stroke="#0b1530" stroke-width="0.8"/>
${rings}
<circle cx="50" cy="50" r="30" fill="#0b1530"/>
<path d="${GLYPHS[kind] ?? GLYPHS[0]}" fill="none" stroke="#f6f3ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<text x="50" y="104" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="8" font-weight="700" letter-spacing="0.6" fill="#0b1530">${b.name.toUpperCase()}</text>
<text x="50" y="113" text-anchor="middle" font-family="monospace" font-size="4" fill="#1f3dff">OMNITIDE ARENA${tokenId !== undefined ? ` · #${tokenId}` : ""}</text>
</svg>`;
}
