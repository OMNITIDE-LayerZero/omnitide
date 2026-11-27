import "server-only";
import type { ChainKey } from "@omnitide/contracts/chains";
import { HUB_KEY, LZ_SCAN, SHORT, chainKeyOf, explorerTx } from "@/lib/chains";
import { TIDE_READER_CHAIN } from "@/lib/contracts";
import type { Receipt } from "@/lib/hooks";
import { upstream } from "./upstream";

type Row = { tx?: string; timestamp?: number };
const TTL = 30_000;
let cache: { at: number; body: Record<string, Receipt> } | undefined;

const receipt = (chain: ChainKey, tx: string | null | undefined, at: number | null | undefined, lz = false): Receipt | undefined =>
  tx && at ? { chain: SHORT[chain], tx, at, url: lz ? `${LZ_SCAN}${tx}` : explorerTx(chain, tx) } : undefined;

// an endpoint that is down or empty just leaves its features without a receipt
const safe = <T,>(path: string, empty: T) => upstream<T>("indexer", path).catch(() => empty);

/** Latest mainnet (or testnet) transaction behind each landing feature, keyed by feature id. Holds only hashes and times, never accounts. */
export async function receipts(): Promise<Record<string, Receipt>> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  const [trades, flows, tide, harbor, deep, council, beams, vaults, lending] = await Promise.all([
    safe<(Row & { viaOrder: boolean })[]>("/trades?limit=200", []),
    safe<(Row & { kind: string; guid: string | null })[]>("/flows?limit=200", []),
    safe<{ requestTx: string | null; readAt: number }[]>("/tide?limit=1", []),
    safe<(Row & { srcEid: number; dstEid: number })[]>("/harbor?limit=1", []),
    safe<{ latest: (Row & { kind: string })[] }>("/deep?limit=200", { latest: [] }),
    safe<{ proposals: { tx: string; start: number }[] }>("/council?limit=1", { proposals: [] }),
    safe<{ chainId: number; tx: string; issuedAt: number }[]>("/lighthouse?limit=1", []),
    safe<{ tx: string; createdAt: number }[]>("/vaults?limit=1", []),
    safe<(Row & { kind: string })[]>("/lending?limit=50", []),
  ]);
  const fill = trades[0];
  const inflow = flows.find((f) => f.kind === "inflow");
  const ebb = flows.find((f) => f.kind === "ebb");
  const seal = deep.latest.find((n) => n.kind === "seal") ?? deep.latest[0];
  const beam = beams[0];
  const beamChain = beam && chainKeyOf(beam.chainId);
  const body = Object.fromEntries(
    Object.entries({
      inflow: receipt(HUB_KEY, inflow?.tx, inflow?.timestamp, !!inflow?.guid),
      ebb: receipt(HUB_KEY, ebb?.tx, ebb?.timestamp, !!ebb?.guid),
      "cross margin": receipt(HUB_KEY, fill?.tx, fill?.timestamp),
      orders: (() => {
        const o = trades.find((t) => t.viaOrder);
        return receipt(HUB_KEY, o?.tx, o?.timestamp);
      })(),
      "tide pool": receipt(HUB_KEY, fill?.tx, fill?.timestamp),
      prices: receipt(HUB_KEY, fill?.tx, fill?.timestamp),
      "tide chart": TIDE_READER_CHAIN && receipt(TIDE_READER_CHAIN, tide[0]?.requestTx, tide[0]?.readAt, true),
      harbor: receipt(HUB_KEY, harbor[0]?.tx, harbor[0]?.timestamp),
      lending: (() => {
        const b = lending.find((l) => l.kind === "borrow") ?? lending[0];
        return receipt(HUB_KEY, b?.tx, b?.timestamp);
      })(),
      "deep mode": receipt(HUB_KEY, seal?.tx, seal?.timestamp),
      council: receipt(HUB_KEY, council.proposals[0]?.tx, council.proposals[0]?.start),
      lighthouse: beamChain ? receipt(beamChain, beam.tx, beam.issuedAt) : undefined,
      "copy vaults": receipt(HUB_KEY, vaults[0]?.tx, vaults[0]?.createdAt),
    }).filter((e): e is [string, Receipt] => !!e[1]),
  );
  cache = { at: Date.now(), body };
  return body;
}
