import { BADGES } from "@omnitide/contracts/deep";

// Engraved medals in the spirit of GitHub achievements: one scene per badge, a struck-metal rim, a ribbon and tier pips.
const P = "#f6f3ea";
const N = "#0b1530";
const U = "#1f3dff";
const U2 = "#8fa3ff";

type Finish = "Bronze" | "Silver" | "Gold";
const METAL: Record<Finish, { l: string; m: string; d: string; tier: number }> = {
  Bronze: { l: "#f2c38f", m: "#c27a43", d: "#6f3a1a", tier: 1 },
  Silver: { l: "#f5f7fb", m: "#b4bdca", d: "#566173", tier: 2 },
  Gold: { l: "#ffe8a3", m: "#d8a32f", d: "#7d5408", tier: 3 },
};

/** Medal finish per badge kind, in on-chain kind order. */
export const MEDAL_FINISH: Finish[] = ["Bronze", "Bronze", "Silver", "Gold", "Gold", "Silver", "Silver", "Gold"];

const f = (n: number) => +n.toFixed(2);
const polar = (r: number, deg: number, cx = 50, cy = 48) => [f(cx + r * Math.cos((deg * Math.PI) / 180)), f(cy + r * Math.sin((deg * Math.PI) / 180))] as const;
const waves = (y: number, op: number) => `<path d="M17 ${y} q3.5 -1.6 7 0${" t7 0".repeat(9)}" fill="none" stroke="${P}" stroke-opacity="${op}" stroke-width="0.6"/>`;

interface Metal {
  l: string;
  m: string;
  d: string;
  id: string;
}
interface Art {
  scene: string; // clipped to the disc
  over?: string; // breaks out over the rim
}

function laurel(mt: Metal) {
  const side = (mirror: boolean) => {
    const x = (v: number) => (mirror ? 100 - v : v);
    const pt = (t: number): [number, number] => [(1 - t) ** 2 * 48 + 2 * (1 - t) * t * 27 + t * t * 23, (1 - t) ** 2 * 77 + 2 * (1 - t) * t * 75 + t * t * 53];
    let out = `<path d="M${x(48)} 77 Q${x(27)} 75 ${x(23)} 53" fill="none" stroke="${mt.d}" stroke-width="0.9" stroke-linecap="round"/>`;
    for (let i = 0; i < 6; i++) {
      const t = 0.16 + i * 0.15;
      const [px, py] = pt(t);
      const [qx, qy] = pt(t + 0.01);
      const along = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
      for (const [dir, fill] of [[-1, mt.l], [1, mt.m]] as const) {
        const deg = along + dir * 40;
        const [cx, cy] = [px + 2 * Math.cos((deg * Math.PI) / 180), py + 2 * Math.sin((deg * Math.PI) / 180)];
        const X = x(cx);
        const ang = mirror ? 180 - deg : deg;
        out += `<ellipse cx="${f(X)}" cy="${f(cy)}" rx="2.6" ry="1.15" transform="rotate(${f(ang)} ${f(X)} ${f(cy)})" fill="${fill}" stroke="${mt.d}" stroke-width="0.3"/>`;
      }
    }
    const [tx, ty] = pt(1);
    return out + `<ellipse cx="${f(x(tx))}" cy="${f(ty - 1.6)}" rx="1.2" ry="2.4" fill="${mt.l}" stroke="${mt.d}" stroke-width="0.3"/>`;
  };
  return side(false) + side(true);
}

const ART: ((mt: Metal) => Art)[] = [
  // First Fill: a sail leaves the harbor at dawn
  (mt) => ({
    scene: `<circle cx="50" cy="60" r="13" fill="${mt.l}" opacity="0.92"/>
${Array.from({ length: 9 }, (_, i) => { const [a, b] = polar(15, -165 + i * 18.75, 50, 60); const [c, d] = polar(21, -165 + i * 18.75, 50, 60); return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${mt.l}" stroke-opacity="0.6" stroke-width="0.8" stroke-linecap="round"/>`; }).join("")}
<rect x="17" y="60" width="66" height="22" fill="${N}"/>
<path d="M43 62.6 H57 M45.5 65.2 H54.5 M47.8 67.8 H52.2" stroke="${mt.l}" stroke-opacity="0.75" stroke-width="0.8" stroke-linecap="round"/>
${waves(64, 0.45)}${waves(68.5, 0.32)}${waves(73, 0.22)}
<path d="M49.4 31 Q43 44 38.5 56.6 H49.4 Z" fill="${P}" fill-opacity="0.86"/>
<path d="M51.6 28 Q60 40 62.2 56.6 H51.6 Z" fill="${P}"/>
<path d="M51.6 38 H59.4 M51.6 47 H61.2" stroke="${N}" stroke-opacity="0.22" stroke-width="0.45"/>
<path d="M50.5 25.6 V58.6" stroke="${P}" stroke-width="1"/>
<path d="M50.5 25.6 L57.4 27.3 L50.5 29 Z" fill="${mt.m}"/>
<path d="M36.8 58.4 H63.2 L59.6 63.2 H40.4 Z" fill="${P}" stroke="${N}" stroke-width="0.5"/>`,
  }),
  // Inflow Navigator: a compass rose with three chains flowing to the centre
  (mt) => {
    const point = (deg: number, len: number, side: number, light: string, dark: string) => {
      const [tx, ty] = polar(len, deg);
      const [ax, ay] = polar(side, deg + 45);
      const [bx, by] = polar(side, deg - 45);
      return `<path d="M50 48 L${tx} ${ty} L${ax} ${ay} Z" fill="${light}"/><path d="M50 48 L${tx} ${ty} L${bx} ${by} Z" fill="${dark}"/>`;
    };
    const beads = [-150, -30, 90]
      .map((deg) => {
        const [x, y] = polar(25, deg);
        const [a, b] = polar(22, deg);
        const [c, d] = polar(13, deg);
        return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${mt.l}" stroke-width="0.6" stroke-dasharray="1 1.1"/><circle cx="${x}" cy="${y}" r="2.3" fill="${mt.m}" stroke="${N}" stroke-width="0.4"/><circle cx="${x}" cy="${y}" r="0.8" fill="${N}"/>`;
      })
      .join("");
    return {
      scene: `<circle cx="50" cy="48" r="25" fill="none" stroke="${P}" stroke-opacity="0.35" stroke-width="0.5" stroke-dasharray="1 1.6"/>
<circle cx="50" cy="48" r="17" fill="none" stroke="${U2}" stroke-opacity="0.35" stroke-width="0.4"/>
${[45, 135, 225, 315].map((d) => point(d, 13, 3.2, mt.l, mt.d)).join("")}
${[0, 90, 180].map((d) => point(d, 22, 5, P, U2)).join("")}${point(-90, 22, 5, P, mt.m)}
${beads}
<text x="50" y="23.6" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="4.4" font-weight="700" fill="${mt.l}">N</text>
<circle cx="50" cy="48" r="2.7" fill="${mt.m}" stroke="${N}" stroke-width="0.5"/><circle cx="50" cy="48" r="1" fill="${N}"/>`,
    };
  },
  // Harbor Master: an anchor with its rope
  (mt) => ({
    scene: `${waves(68, 0.22)}${waves(72.5, 0.16)}${waves(77, 0.1)}
<circle cx="50" cy="25.6" r="3.6" fill="none" stroke="${P}" stroke-width="1.8"/>
<path d="M50 29.4 V67" stroke="${P}" stroke-width="3.2" stroke-linecap="round"/>
<path d="M51.1 30.5 V65.5" stroke="${U2}" stroke-opacity="0.55" stroke-width="0.5"/>
<path d="M39.2 35.6 H60.8" stroke="${P}" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="38.4" cy="35.6" r="1.7" fill="${P}"/><circle cx="61.6" cy="35.6" r="1.7" fill="${P}"/>
<path d="M29.6 53 Q31 68.6 50 68.6 Q69 68.6 70.4 53" fill="none" stroke="${P}" stroke-width="3" stroke-linecap="round"/>
<path d="M26.4 56.6 L29.2 48.4 L34.6 55 Z M73.6 56.6 L70.8 48.4 L65.4 55 Z M47 67.6 L50 72.6 L53 67.6 Z" fill="${P}"/>
<path d="M53.2 27.6 C63 31 62 41 51 43.6 C40 46 38.5 55 47 58 C53 60.2 58.5 61 59.5 66" fill="none" stroke="${mt.m}" stroke-width="1.7" stroke-linecap="round"/>
<path d="M53.2 27.6 C63 31 62 41 51 43.6 C40 46 38.5 55 47 58 C53 60.2 58.5 61 59.5 66" fill="none" stroke="${mt.d}" stroke-width="1.7" stroke-dasharray="0.8 0.9" stroke-opacity="0.65"/>`,
  }),
  // Grade A Book: signal flag Alfa over a laurel wreath
  (mt) => ({
    scene: `<path d="M33 21.6 V71" stroke="${mt.l}" stroke-width="1.4"/><circle cx="33" cy="21" r="1.8" fill="${mt.l}"/>
<path d="M33.7 25 C39 23.4 44 26.6 50 25 L50 47 C44 48.6 39 45.4 33.7 47 Z" fill="${P}"/>
<path d="M45 25.2 V47.3 M47.5 25.3 V47.2" stroke="${N}" stroke-opacity="0.12" stroke-width="0.6"/>
<path d="M50 25 C56 23.4 62 26.6 70 25 L62 36 L70 47 C62 48.6 56 45.4 50 47 Z" fill="${U}" stroke="${P}" stroke-width="0.6"/>
<text x="52" y="58" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="9" font-weight="700" fill="${mt.l}">A</text>
<text x="52" y="64" text-anchor="middle" font-family="ui-monospace, monospace" font-size="2.6" letter-spacing="0.5" fill="${mt.l}" fill-opacity="0.8">FLAG ALFA</text>
${laurel(mt)}`,
  }),
  // Storm Rider: a ship on the crest of a breaking wave, lightning overhead
  (mt) => ({
    scene: `${Array.from({ length: 12 }, (_, i) => `<line x1="${28 + i * 5}" y1="16" x2="${22 + i * 5}" y2="40" stroke="${P}" stroke-opacity="0.16" stroke-width="0.35"/>`).join("")}
<path d="M66 19 L58.5 32 L63.5 32 L55 45.5 L70 29.5 L64.6 29.5 L71 19 Z" fill="none" stroke="${mt.l}" stroke-opacity="0.35" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M66 19 L58.5 32 L63.5 32 L55 45.5 L70 29.5 L64.6 29.5 L71 19 Z" fill="${mt.l}" stroke="${N}" stroke-width="0.4"/>
<path d="M17 82 L17 67 C26 62 31 50 44 45 C55 41 65 45 66 53 C66.5 58.5 60 60.5 57.6 56.6 C55.6 53.3 59 50.6 61.6 52.4 C64 56 69 62.5 83 64.5 L83 82 Z" fill="${U}" stroke="${P}" stroke-width="0.7"/>
<path d="M21 72 C29 66 34 56 45 51 C52 48 58 49 60 52 M23 77 C33 71 40 62 50 58 M60 66.5 C66 69 72 70 83 70 M48 76 C58 70 66 72 83 75" fill="none" stroke="${P}" stroke-opacity="0.35" stroke-width="0.45"/>
<path d="M44 45 q2 -3 4 -1 M49 43.2 q2 -3 4 -1 M54 42.8 q2 -2.6 4 -0.5 M59 43.8 q2 -2 3.6 0.3" fill="none" stroke="${P}" stroke-width="0.9" stroke-linecap="round"/>
<g transform="rotate(-24 34 52)"><path d="M34 52 V39" stroke="${P}" stroke-width="0.9"/><path d="M34.8 40 Q40 45 40.5 51 H34.8 Z" fill="${P}"/><path d="M34 39 L37.5 40 L34 41 Z" fill="${mt.l}"/><path d="M27 52 H41 L38.5 55.5 H29.5 Z" fill="${P}" stroke="${N}" stroke-width="0.4"/></g>`,
  }),
  // Deep Diver: a brass-bolted diving helmet in the light shafts
  (mt) => ({
    scene: `<path d="M40 16 L50 16 L36 80 L24 80 Z M56 16 L63 16 L60 80 L50 80 Z" fill="${P}" fill-opacity="0.06"/>
<circle cx="66" cy="33" r="1.6" fill="none" stroke="${P}" stroke-width="0.5"/><circle cx="69" cy="27" r="1.1" fill="none" stroke="${P}" stroke-width="0.5"/><circle cx="65.5" cy="22" r="0.8" fill="none" stroke="${P}" stroke-width="0.45"/><circle cx="70.5" cy="19.5" r="0.6" fill="none" stroke="${P}" stroke-width="0.4"/>
<path d="M28 76 Q30 63 50 61 Q70 63 72 76 Q50 80 28 76 Z" fill="${mt.d}" stroke="${N}" stroke-width="0.5"/>
${[33, 41, 50, 59, 67].map((x) => `<circle cx="${x}" cy="${x === 50 ? 64.6 : x === 41 || x === 59 ? 66 : 70}" r="0.9" fill="${mt.l}"/>`).join("")}
<circle cx="50" cy="45" r="16.5" fill="url(#${mt.id}-metal)" stroke="${N}" stroke-width="0.6"/>
<rect x="36.6" y="57.4" width="26.8" height="3.4" rx="1.2" fill="${mt.m}" stroke="${N}" stroke-width="0.4"/>
<rect x="47.6" y="26.8" width="4.8" height="3" rx="0.8" fill="${mt.m}" stroke="${N}" stroke-width="0.4"/>
<circle cx="36.2" cy="43.5" r="3.2" fill="${N}" stroke="${mt.d}" stroke-width="1.1"/><circle cx="63.8" cy="43.5" r="3.2" fill="${N}" stroke="${mt.d}" stroke-width="1.1"/>
<circle cx="50" cy="46" r="8" fill="${N}" stroke="${mt.d}" stroke-width="1.8"/>
<path d="M50 38.6 V53.4 M42.6 46 H57.4" stroke="${mt.d}" stroke-width="0.9"/>
<path d="M45.4 42.6 A5.5 5.5 0 0 1 50 40.3" fill="none" stroke="${U2}" stroke-width="0.9" stroke-linecap="round"/>
<path d="M38.6 36.4 A13 13 0 0 1 46.6 30.6" fill="none" stroke="${P}" stroke-opacity="0.65" stroke-width="1.1" stroke-linecap="round"/>`,
  }),
  // Council Voice: the ship's wheel, every hand on it
  (mt) => {
    const spokes = [0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => {
        const [a, b] = polar(4.5, deg);
        const [c, d] = polar(17, deg);
        const [e, g] = polar(25, deg);
        return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${mt.m}" stroke-width="1.6"/><line x1="${c}" y1="${d}" x2="${e}" y2="${g}" stroke="${mt.d}" stroke-width="3.8" stroke-linecap="round"/><line x1="${c}" y1="${d}" x2="${e}" y2="${g}" stroke="${mt.l}" stroke-width="2.5" stroke-linecap="round"/>`;
      })
      .join("");
    return {
      scene: `${Array.from({ length: 16 }, (_, i) => { const [a, b] = polar(8, i * 22.5 + 11.25); const [c, d] = polar(31, i * 22.5 + 11.25); return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${P}" stroke-opacity="0.07" stroke-width="1.4"/>`; }).join("")}
${spokes}
<circle cx="50" cy="48" r="17" fill="none" stroke="${mt.d}" stroke-width="4.2"/>
<circle cx="50" cy="48" r="17" fill="none" stroke="${mt.m}" stroke-width="3"/>
<path d="M36.5 38 A17 17 0 0 1 56 32" fill="none" stroke="${mt.l}" stroke-width="0.7" stroke-linecap="round"/>
<circle cx="50" cy="48" r="14.6" fill="none" stroke="${mt.d}" stroke-width="0.5"/>
<circle cx="50" cy="48" r="5" fill="${mt.m}" stroke="${N}" stroke-width="0.6"/><circle cx="50" cy="48" r="2.4" fill="${N}"/>
<path d="M48.7 48 L49.7 49.1 L51.5 46.9" fill="none" stroke="${mt.l}" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    };
  },
  // Lighthouse Keeper: the light on the rocks, its beam breaking past the rim
  (mt) => ({
    scene: `${[[28, 24], [36, 20.5], [64, 21], [72, 27], [58, 18.5], [41, 27]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.35" fill="${P}" fill-opacity="0.7"/>`).join("")}
${waves(70, 0.25)}${waves(74.5, 0.16)}
<circle cx="50" cy="31.9" r="7" fill="${mt.l}" fill-opacity="0.22"/>
<path d="M44.2 71 L46.6 38.5 H53.4 L55.8 71 Z" fill="${P}" stroke="${N}" stroke-width="0.4"/>
<g clip-path="url(#${mt.id}-tower)"><rect x="40" y="44.6" width="20" height="5.6" fill="${U}"/><rect x="40" y="56" width="20" height="5.6" fill="${U}"/><rect x="40" y="67.4" width="20" height="4" fill="${U}"/></g>
<path d="M48.6 71 V67.4 a1.4 1.4 0 0 1 2.8 0 V71 Z" fill="${N}"/><rect x="49.3" y="51.4" width="1.4" height="2.4" fill="${N}"/>
<rect x="44.6" y="36.6" width="10.8" height="2" fill="${N}" stroke="${P}" stroke-width="0.4"/>
<path d="M44.8 34.6 H55.2 M45.2 36.6 V34.6 M47.6 36.6 V34.6 M52.4 36.6 V34.6 M54.8 36.6 V34.6" stroke="${P}" stroke-width="0.4"/>
<rect x="46.8" y="29.2" width="6.4" height="5.4" fill="${mt.l}" stroke="${N}" stroke-width="0.3"/>
<path d="M45.6 29.4 L50 24.4 L54.4 29.4 Z" fill="${N}" stroke="${P}" stroke-width="0.5"/>
<path d="M50 24.4 V22.4" stroke="${P}" stroke-width="0.5"/><circle cx="50" cy="22" r="0.7" fill="${P}"/>
<path d="M22 82 Q28 70.5 37 71.6 Q41.5 68.6 46.5 70.4 H53.5 Q58 68.2 63.5 71 Q71 70 78 82 Z" fill="#060c20" stroke="${P}" stroke-opacity="0.45" stroke-width="0.4"/>
<path d="M31 76 l3 -3 M36 77 l3 -3.4 M58 75.6 l3 -3 M64 77 l3 -3" stroke="${P}" stroke-opacity="0.25" stroke-width="0.4"/>`,
    over: `<path d="M50 31.8 L3 17.5 L3 45.5 Z" fill="url(#${mt.id}-beamL)"/><path d="M50 31.8 L97 19.5 L97 43.5 Z" fill="url(#${mt.id}-beamR)"/>`,
  }),
];

/** Arena Badge artwork as standalone SVG, shared by the terminal and the ERC-721 metadata route. */
export function badgeSvg(kind: number, tokenId?: number | string) {
  const k = BADGES[kind] ? kind : 0;
  const b = BADGES[k]!;
  const finish = MEDAL_FINISH[k]!;
  const { l, m, d, tier } = METAL[finish];
  const id = `ob${k}`;
  const mt: Metal = { l, m, d, id };
  const art = ART[k]!(mt);
  const knurl = Array.from({ length: 90 }, (_, i) => {
    const [a, c] = polar(38.8, i * 4);
    const [e, g] = polar(41, i * 4 + 2.2);
    return `<line x1="${a}" y1="${c}" x2="${e}" y2="${g}" stroke="${d}" stroke-width="0.45"/>`;
  }).join("");
  const engraving = Array.from({ length: 27 }, (_, i) => `<line x1="17" y1="${f(17.4 + i * 2.4)}" x2="83" y2="${f(17.4 + i * 2.4)}" stroke="${U2}" stroke-opacity="0.13" stroke-width="0.3"/>`).join("");
  const chart = Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${6 + i * 13}" x2="100" y2="${6 + i * 13}" stroke="${N}" stroke-opacity="0.05" stroke-width="0.3"/>`).join("");
  const pips = [0, 1, 2].map((i) => `<path d="M${45 + i * 5} 111.6 l1.8 1.8 l-1.8 1.8 l-1.8 -1.8 Z" fill="${i < tier ? m : "none"}" stroke="${d}" stroke-width="0.4"/>`).join("");
  const star = (x: number) => `<path d="M${x} 46 L${x + 0.7} 47.3 L${x + 2} 48 L${x + 0.7} 48.7 L${x} 50 L${x - 0.7} 48.7 L${x - 2} 48 L${x - 0.7} 47.3 Z" fill="${d}"/>`;
  const tail = (mirror: boolean) => {
    const x = (v: number) => (mirror ? 100 - v : v);
    return `<path d="M${x(18.5)} 88.6 L${x(6.5)} 88.6 L${x(10.2)} 93.7 L${x(6.5)} 98.8 L${x(18.5)} 98.8 Z" fill="#1430b8"/><path d="M${x(16)} 96.6 L${x(18.5)} 98.8 L${x(18.5)} 96 Z" fill="${N}"/>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="400" height="480">
<defs>
<linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l}"/><stop offset="0.32" stop-color="${m}"/><stop offset="0.52" stop-color="${l}"/><stop offset="0.78" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient>
<linearGradient id="${id}-wave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d5bff"/><stop offset="0.55" stop-color="${U}"/><stop offset="1" stop-color="#0e1f8f"/></linearGradient>
<linearGradient id="${id}-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16247a"/><stop offset="1" stop-color="#070e24"/></linearGradient>
<radialGradient id="${id}-halo"><stop offset="0" stop-color="${l}" stop-opacity="0.55"/><stop offset="1" stop-color="${l}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-beamL" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${l}" stop-opacity="0.85"/><stop offset="1" stop-color="${l}" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}-beamR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${l}" stop-opacity="0.85"/><stop offset="1" stop-color="${l}" stop-opacity="0"/></linearGradient>
<clipPath id="${id}-disc"><circle cx="50" cy="48" r="31"/></clipPath>
<clipPath id="${id}-tower"><path d="M44.2 71 L46.6 38.5 H53.4 L55.8 71 Z"/></clipPath>
<path id="${id}-arc" d="M15.4 48 A34.6 34.6 0 0 1 84.6 48"/>
</defs>
<rect width="100" height="120" fill="${P}"/>
${chart}
<circle cx="50" cy="48" r="50" fill="url(#${id}-halo)"/>
<circle cx="50" cy="48.8" r="41" fill="${N}" fill-opacity="0.12"/>
<circle cx="50" cy="48" r="41" fill="url(#${id}-metal)" stroke="${N}" stroke-width="0.7"/>
${knurl}
<circle cx="50" cy="48" r="38.6" fill="none" stroke="${d}" stroke-opacity="0.7" stroke-width="0.35"/>
<text font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="4.4" font-weight="700" letter-spacing="1.2" fill="${d}"><textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">OMNITIDE · ARENA</textPath></text>
${star(14.2)}${star(85.8)}
<circle cx="50" cy="48" r="33" fill="${N}" stroke="${d}" stroke-width="0.8"/>
<circle cx="50" cy="48" r="32.3" fill="none" stroke="${l}" stroke-opacity="0.8" stroke-width="0.5"/>
<circle cx="50" cy="48" r="31" fill="url(#${id}-sea)"/>
<g clip-path="url(#${id}-disc)">
${engraving}
${art.scene}
<ellipse cx="38" cy="29" rx="21" ry="8" transform="rotate(-32 38 29)" fill="#ffffff" fill-opacity="0.05"/>
</g>
${art.over ?? ""}
${tail(false)}${tail(true)}
<path d="M16 86 Q50 82 84 86 L84 97 Q50 93 16 97 Z" fill="${U}"/>
<path d="M16 86 Q50 82 84 86" fill="none" stroke="${P}" stroke-opacity="0.35" stroke-width="0.4"/>
<text x="50" y="92.6" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-size="6" font-weight="700" letter-spacing="0.5" fill="${P}">${b.name.toUpperCase()}</text>
<text x="50" y="107" text-anchor="middle" font-family="ui-monospace, monospace" font-size="3.6" letter-spacing="0.3" fill="${U}">${finish.toUpperCase()} · OMNITIDE ARENA${tokenId !== undefined ? ` · #${tokenId}` : ""}</text>
${pips}
</svg>`;
}
