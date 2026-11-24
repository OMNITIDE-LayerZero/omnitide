// Interactive registry of every OMNITIDE contract in one env: name, address, explorer link and live verification status.
// Run from the repo root: pnpm testnet:verification | pnpm mainnet:verification | pnpm mainnet:v2:verification
// (--list prints a plain report, --no-anim keeps the tide still; OMNITIDE_VERSION=1|2|3 keeps only the contracts that version shipped)
import { spawn, spawnSync } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.ts";
import { DEPLOYMENTS } from "../deployments/index.ts";

type Status = "full" | "partial" | "missing" | "unknown";
interface Row {
  chain: ChainKey;
  name: string;
  kind: string;
  address: string;
  link: string;
  status?: Status;
  blockscout?: string;
  sourcify?: string;
  compiler?: string;
  source?: string;
}

// SCRIPT_CHAINS follows the same switch, so chains and deployments always match
const ENV = process.env.OMNITIDE_ENV?.startsWith("mainnet") ? "mainnet" : "testnet";
// same version split as deploy.ts: V1.0 Shoreline, V2 Current, V3 Deep Water
const V1 = ["OmnitideUSD", "OmnitidePort", "OmnitideOracle", "OmnitideClearinghouse"];
const V2 = ["OmnitideHarbor", "OmnitideHarborShareAdapter", "OmnitideHarborShare", "OmnitideTideReader"];
const VERSION = Number(process.env.OMNITIDE_VERSION) || 0;
const versionOf = (name: string) => (V1.includes(name) ? 1 : V2.includes(name) ? 2 : 3);
const LABEL = VERSION ? ` ${["", "V1.0 Shoreline", "V2 Current", "V3 Deep Water"][VERSION]}` : "";
const args = new Set(process.argv.slice(2));
const out = process.stdout;
const live = !!out.isTTY && !!process.stdin.isTTY && !args.has("--list");
const paint = !!out.isTTY && !process.env.NO_COLOR;
const still = args.has("--no-anim");

// palette: ultramarine tide plus flood/ebb; mid tones so light and dark terminals both read them
const rgb = (c: number[]) => (s: string) => (paint ? `\x1b[38;2;${c.join(";")}m${s}\x1b[39m` : s);
const sgr = (on: number, off: number) => (s: string) => (paint ? `\x1b[${on}m${s}\x1b[${off}m` : s);
const DEEP = [31, 61, 255];
const FOAM = [142, 162, 255];
const mix = (f: number) => rgb(DEEP.map((v, i) => Math.round(v + (FOAM[i]! - v) * Math.max(0, Math.min(1, f)))));
const C = { tide: rgb([74, 100, 255]), flood: rgb([47, 163, 107]), warn: rgb([201, 138, 18]), ebb: rgb([229, 72, 77]), bold: sgr(1, 22), dim: sgr(2, 22) };
const select = (s: string) => (paint ? `\x1b[48;2;31;61;255m\x1b[97m${s}\x1b[39m\x1b[49m` : out.isTTY ? `\x1b[7m${s}\x1b[27m` : s);
const href = (url: string, text: string) => (paint ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text);
const width = (s: string) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;;.*?\x1b\\/g, "").length;
const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));
const cut = (s: string, w: number) => (s.length > w ? `${s.slice(0, Math.max(1, w - 1))}…` : s);
const short = (k: ChainKey) => CHAINS[k].name.replace(" Testnet", "").replace("Ethereum ", "");

// ── registry ────────────────────────────────────────────────────────────────
const PARTS = [
  ["proxy", "", "proxy"],
  ["implementation", "", "implementation"],
  ["beacon", "OmnitideCopyVault", "beacon"],
  ["vaultImplementation", "OmnitideCopyVault", "implementation"],
] as const;
const KEYS = Object.keys(CHAINS) as ChainKey[];
// chains without a Blockscout explorer (HyperEVM: Purrsec answers 404) link to their Sourcify record instead
const explorerLink = (k: ChainKey, a: string) => (CHAINS[k].blockscout ? `${CHAINS[k].explorer}/address/${a}?tab=contract` : `https://repo.sourcify.dev/${CHAINS[k].chainId}/${a}`);

const rows: Row[] = KEYS.flatMap((chain) =>
  Object.entries(DEPLOYMENTS[ENV][chain] ?? {}).flatMap(([name, rec]) =>
    typeof rec !== "object" || (VERSION && versionOf(name) !== VERSION)
      ? []
      : PARTS.flatMap(([field, alias, kind]) => {
          const address = (rec as Record<string, unknown>)[field];
          return typeof address === "string" ? [{ chain, name: alias || name, kind, address, link: explorerLink(chain, address) }] : [];
        }),
  ),
);

// ── sounding: Sourcify + Blockscout, whichever proves more wins ─────────────
async function get(url: string): Promise<{ code: number; body: any }> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    return { code: r.status, body: r.ok ? await r.json() : null };
  } catch {
    return { code: 0, body: null };
  }
}

async function sound(r: Row) {
  const c = CHAINS[r.chain];
  const [s, b] = await Promise.all([
    get(`https://sourcify.dev/server/v2/contract/${c.chainId}/${r.address}?fields=compilation`),
    c.blockscout ? get(`${c.explorer}/api/v2/smart-contracts/${r.address}`) : Promise.resolve(null),
  ]);
  const sm: string | undefined = s.body?.match;
  r.sourcify = sm === "exact_match" ? "exact match" : sm === "match" ? "partial match" : s.code === 404 ? "not verified" : "unreachable";
  r.blockscout = !b ? undefined : b.body?.is_fully_verified ? "fully verified" : b.body?.is_verified ? "verified, partial" : b.code === 200 || b.code === 404 ? "not verified" : "unreachable";
  r.compiler = s.body?.compilation?.compilerVersion ?? b?.body?.compiler_version;
  r.source = s.body?.compilation?.name ?? b?.body?.name;
  // the explorer the link opens decides: Blockscout keeps offering "Verify & publish" until a contract is fully verified there
  const bs = b && (b.code === 200 || b.code === 404) ? (b.body ?? {}) : null;
  r.status = bs
    ? bs.is_fully_verified ? "full" : bs.is_verified ? "partial" : "missing"
    : sm === "exact_match" ? "full" : sm === "match" ? "partial" : s.code === 404 ? "missing" : "unknown";
}

let sounding: Promise<void> | null = null;
function soundAll() {
  if (sounding) return sounding;
  for (const r of rows) r.status = undefined;
  let i = 0;
  const worker = async () => {
    while (i < rows.length) await sound(rows[i++]!);
  };
  sounding = Promise.all(Array.from({ length: 6 }, worker)).then(() => void (sounding = null));
  return sounding;
}

const count = (s: Status) => rows.filter((r) => r.status === s).length;

// ── plain report (pipes, CI, --list) ────────────────────────────────────────
const WORD: Record<Status, string> = { full: "✓ verified", partial: "◐ partial ", missing: "✗ missing ", unknown: "? unknown " };
const TINT: Record<Status, (s: string) => string> = { full: C.flood, partial: C.warn, missing: C.ebb, unknown: C.warn };
const fixable = (r: Row) => r.status === "partial" || r.status === "missing";

async function report() {
  await soundAll();
  out.write(`\n${C.bold(C.tide("OMNITIDE"))} ${C.dim(`· ${ENV}${LABEL} contract registry`)}\n`);
  for (const k of KEYS) {
    const list = rows.filter((r) => r.chain === k);
    if (!list.length) continue;
    out.write(`\n${C.bold(CHAINS[k].name)} ${C.dim(`· chain ${CHAINS[k].chainId} · LayerZero eid ${CHAINS[k].eid}`)}\n`);
    for (const r of list) out.write(`  ${TINT[r.status!](WORD[r.status!])}  ${pad(r.name, 27)} ${pad(C.dim(r.kind), 15)} ${r.address}  ${href(r.link, r.link)}\n`);
  }
  const bad = rows.length - count("full");
  out.write(`\n${(bad ? C.warn : C.flood)(`${count("full")}/${rows.length} verified & published`)}${bad ? C.dim(` · ${count("partial")} partial · ${count("missing")} missing · ${count("unknown")} unreachable`) : ""}\n\n`);
  process.exitCode = bad ? 1 : 0;
}

// ── live terminal ───────────────────────────────────────────────────────────
const GLYPHS: Record<string, string[]> = {
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
};
const MARK = [0, 1, 2, 3, 4].map((r) => [..."OMNITIDE"].map((ch) => GLYPHS[ch]![r]).join("  "));
const BARS = "▁▂▃▄▅▆";
const SPIN = "◜◠◝◞◡◟";

let t = 0;
let tab = 0;
let sel = 0;
let top = 0;
let toast: { text: string; until: number } | null = null;

const tabs = () => [null, ...KEYS.filter((k) => rows.some((r) => r.chain === k))];
const shown = () => {
  const k = tabs()[tab];
  return k ? rows.filter((r) => r.chain === k) : rows;
};

/** The wordmark surfaces row by row, then a slow shimmer runs through it. */
function wordmark(): string[] {
  const rise = still ? MARK.length : Math.min(MARK.length, t / 3);
  return MARK.map((line, r) => (MARK.length - r > rise ? "" : [...line].map((ch, x) => (ch === " " ? " " : mix((Math.sin(x * 0.2 - t * 0.3 + r * 0.5) + 1) / 2)(ch))).join("")));
}

/** A swell line, same idea as the landing ocean: two sines, ink darkens with height. */
function swell(w: number): string {
  let s = "";
  for (let x = 0; x < w; x++) {
    const v = (Math.sin(x * 0.16 - t * 0.3) + 0.6 * Math.sin(x * 0.05 + t * 0.12) + 1.6) / 3.2;
    s += mix(1 - v)(BARS[Math.max(0, Math.min(5, Math.floor(v * 6)))]!);
  }
  return s;
}

function gauge(w: number): string {
  const total = rows.length;
  const ok = count("full");
  const done = rows.filter((r) => r.status).length;
  const cells = Math.max(10, Math.min(32, w - 70));
  const fill = Math.round((ok / total) * cells);
  const bar = C.flood("█".repeat(fill)) + C.dim("░".repeat(cells - fill));
  if (done < total) return `${bar}  ${C.tide(SPIN[t % 6]!)} sounding ${done}/${total} contracts across ${tabs().length - 1} chains…`;
  const bad = total - ok;
  const split = bad && w >= 100 ? `  ${C.dim(`${count("partial")} partial · ${count("missing")} missing · ${count("unknown")} unreachable`)}` : "";
  return `${bar}  ${C.bold((bad ? C.warn : C.flood)(`${ok}/${total} verified & published`))}${split}`;
}

function glyph(r: Row): string {
  if (!r.status) return C.tide(SPIN[(t + r.address.charCodeAt(5)) % 6]!);
  return TINT[r.status](WORD[r.status][0]!);
}

function view(): string {
  const W = Math.max(60, out.columns ?? 100);
  const H = Math.max(22, out.rows ?? 40);
  const L: string[] = [""];
  if (H >= 36) L.push(...wordmark().map((l) => `  ${l}`), "");
  else L.push(`  ${C.bold(C.tide("OMNITIDE"))}`);
  L.push(`  ${swell(W - 4)}`);
  L.push(`  ${C.dim(cut(`${ENV === "mainnet" ? "Mainnet" : "Testnet"}${LABEL} contract registry · Robinhood Chain hub · LayerZero spokes · every address checked live against its explorer`, W - 4))}`);
  L.push(`  ${gauge(W)}`, "");

  // chain tabs
  const labels = tabs().map((k) => [k ? short(k) : "All chains", k ? rows.filter((r) => r.chain === k).length : rows.length] as const);
  const roomy = labels.reduce((n, [l, c]) => n + l.length + String(c).length + 5, 0) <= W - 4;
  L.push(`  ${labels.map(([l, c], i) => (i === tab ? C.bold(C.tide(`▍${roomy ? l : l.split(" ")[0]} ${c}`)) : C.dim(` ${roomy ? l : l.split(" ")[0]} ${c}`))).join("   ")}`);

  // table
  const list = shown();
  // kind always shows (proxy vs implementation share a name); the full address falls back to the detail pane on narrow screens
  const nameW = 27;
  const fullAddr = W >= 92;
  const addrW = fullAddr ? 43 : 19;
  const withChain = tab === 0 && W >= 92 + 18;
  const head = `    ${pad("CONTRACT", nameW)} ${pad("KIND", 15)}${pad("ADDRESS", addrW)}${withChain ? "CHAIN" : ""}`;
  L.push(`  ${C.dim("─".repeat(W - 4))}`, C.dim(head));
  const room = Math.max(4, H - L.length - 8);
  sel = Math.max(0, Math.min(sel, list.length - 1));
  if (sel < top) top = sel;
  if (sel >= top + room) top = sel - room + 1;
  for (let i = top; i < Math.min(list.length, top + room); i++) {
    const r = list[i]!;
    const addr = fullAddr ? r.address : `${r.address.slice(0, 8)}…${r.address.slice(-6)}`;
    const name = pad(cut(r.name, nameW), nameW);
    const kind = pad(r.kind, 15);
    const chain = withChain ? short(r.chain) : "";
    L.push(i === sel ? `  ${glyph(r)} ${select(pad(`${name} ${kind}${pad(addr, addrW)}${chain}`, W - 6))}` : `  ${glyph(r)} ${name} ${C.dim(kind)}${pad(href(r.link, addr), addrW)}${C.dim(chain)}`);
  }
  if (list.length > room) L.push(C.dim(`    ${top + 1}–${Math.min(list.length, top + room)} of ${list.length}`));

  // detail of the selected contract
  const r = list[sel];
  L.push(`  ${C.dim("─".repeat(W - 4))}`);
  if (r) {
    const proof = r.status ? [r.blockscout && `Blockscout ${r.blockscout}`, `Sourcify ${r.sourcify}`, r.compiler && `solc ${r.compiler.replace(/^v/, "").split("+")[0]}`].filter(Boolean).join(" · ") : "sounding…";
    L.push(`  ${C.bold(r.name)} ${C.dim(cut(`· ${r.kind}${r.source && r.source !== r.name ? ` (${r.source})` : ""} · ${CHAINS[r.chain].name}`, W - 5 - r.name.length))}`);
    L.push(`  ${C.dim("Address ")}  ${r.address}`);
    L.push(`  ${C.dim("Explorer")}  ${href(r.link, C.tide(cut(r.link, W - 14)))}`);
    L.push(`  ${C.dim("Proof   ")}  ${r.status ? TINT[r.status](cut(proof, W - 14)) : C.dim(proof)}`);
  }
  const v = rows.some(fixable);
  const keys = W >= 124 ? ["↑↓ move", "←→ chain", "⏎ open explorer", "c copy address", "l copy link", "r re-sound", ...(v ? ["v verify the rest"] : []), "q quit"] : ["↑↓←→", "⏎ open", "c address", "l link", "r re-sound", ...(v ? ["v verify"] : []), "q quit"];
  L.push("", `  ${toast && toast.until > Date.now() ? C.flood(`● ${toast.text}`) : C.dim(keys.join(W >= 124 ? "  ·  " : "  "))}`);
  return `\x1b[H${L.map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`;
}

const render = () => out.write(view());
const flash = (text: string) => (toast = { text, until: Date.now() + 1800 });

function open(url: string) {
  const [cmd, argv] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd as string, argv as string[], { stdio: "ignore", detached: true })
    .on("error", () => flash("No browser handler found: copy the link with l"))
    .unref();
  flash("Opening the explorer");
}

function copy(text: string, what: string) {
  const ok = process.platform === "darwin" && spawnSync("pbcopy", { input: text }).status === 0;
  // elsewhere fall back to OSC 52, which most modern terminals turn into a clipboard write
  if (!ok) out.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
  flash(`${what} copied`);
}

const enter = () => out.write("\x1b[?1049h\x1b[?25l");
const leave = () => out.write("\x1b[?25h\x1b[?1049l");

function verifyRest() {
  const todo = rows.filter(fixable);
  leave();
  process.stdin.setRawMode(false);
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  for (const r of todo) {
    out.write(`\n${C.tide("▍")}Verifying ${C.bold(r.name)} ${r.kind} on ${CHAINS[r.chain].name}\n`);
    // verification never signs: a placeholder key only satisfies the network config
    // implementations compile from contracts/<Name>.sol; proxies and beacons let hardhat find the OpenZeppelin source
    const target = r.kind === "implementation" ? ["--contract", `contracts/${r.name}.sol:${r.name}`] : [];
    spawnSync("npx", ["hardhat", "verify", "--network", r.chain, "--force", ...target, r.address], { cwd, stdio: "inherit", env: { ...process.env, DEPLOYER_PRIVATE_KEY: `0x${"11".repeat(32)}` } });
  }
  process.stdin.setRawMode(true);
  enter();
  void soundAll();
}

function quit() {
  leave();
  process.exit(process.exitCode ?? 0);
}

function interactive() {
  enter();
  process.on("exit", () => out.write("\x1b[?25h"));
  process.on("SIGTERM", quit);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_s: string, key: { name?: string; ctrl?: boolean }) => {
    const list = shown();
    const r = list[sel];
    switch (key.ctrl && key.name === "c" ? "q" : key.name) {
      case "q":
      case "escape":
        return quit();
      case "up":
      case "k":
        sel = (sel - 1 + list.length) % list.length;
        break;
      case "down":
      case "j":
        sel = (sel + 1) % list.length;
        break;
      case "left":
        tab = (tab - 1 + tabs().length) % tabs().length;
        sel = top = 0;
        break;
      case "right":
      case "tab":
        tab = (tab + 1) % tabs().length;
        sel = top = 0;
        break;
      case "return":
      case "o":
        if (r) open(r.link);
        break;
      case "c":
        if (r) copy(r.address, `${r.name} address`);
        break;
      case "l":
        if (r) copy(r.link, "Explorer link");
        break;
      case "r":
        void soundAll();
        flash("Sounding every contract again");
        break;
      case "v":
        if (rows.some(fixable)) verifyRest();
        break;
    }
    render();
  });
  out.on("resize", render);
  void soundAll();
  setInterval(() => {
    if (!still) t++;
    render();
  }, 80);
  render();
}

if (live) interactive();
else await report();
