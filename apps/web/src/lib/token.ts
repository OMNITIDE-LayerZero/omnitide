/** The OMNITIDE token as the hero shows it. Written to a file on the server at launch, read at request time. */
export interface Token {
  ca: string;
  symbol: string;
  chain: string;
  explorer: string;
  buy?: string;
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^[A-Za-z0-9]{1,16}$/;
const CHAIN = /^[A-Za-z0-9 .-]{1,32}$/;

const https = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  try {
    return new URL(v).protocol === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
};

/** Validates the launch file; anything malformed shows nothing rather than a wrong address. Project wallets are never shown. */
export function parseToken(raw: unknown, hidden: string[] = []): Token | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ca = typeof r.ca === "string" ? r.ca.trim() : "";
  if (!EVM.test(ca) && !BASE58.test(ca)) return null;
  if (hidden.some((h) => h.toLowerCase() === ca.toLowerCase())) return null;
  const symbol = typeof r.symbol === "string" ? r.symbol.replace(/^\$/, "").trim() : "";
  const chain = typeof r.chain === "string" ? r.chain.trim() : "";
  const explorer = https(r.explorer);
  if (!SYMBOL.test(symbol) || !CHAIN.test(chain) || !explorer) return null;
  return { ca, symbol: symbol.toUpperCase(), chain, explorer, buy: https(r.buy) };
}
