import { CHAINS } from "@omnitide/contracts/chains";
import { FEATURE_LIST, featureId } from "@/components/landing/features";
import { ENV, HUB, explorerAddress } from "@/lib/chains";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { receipts } from "@/lib/server/receipts";

export const dynamic = "force-dynamic";

/** Plain-text map of the product for agents and auditors: features, contracts, latest transactions. */
export async function GET() {
  const r = await receipts();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4391";
  const lines = [
    "# OMNITIDE",
    "",
    `> Cross-chain perpetuals on ${HUB.name}. Collateral (tdUSD, a LayerZero OFT) arrives from any spoke and lzCompose credits one cross-margin book; prices are keeper-signed EIP-712 reports. Environment: ${ENV}.`,
    "",
    "## Pages",
    `- [Terminal](${origin}/terminal/trade): trade, orders, positions`,
    `- [Proof](${origin}/proof): every feature with its contract and latest transaction`,
    `- [Sea Wall](${origin}/sea-wall): reserves, lane limits and DVN config read live`,
    `- [History](${origin}/terminal/history): every fill and transfer with its transaction`,
    "",
    "## JSON",
    `- ${origin}/api/receipts`,
    `- ${origin}/api/indexer/stats`,
    `- ${origin}/api/indexer/bridge`,
    `- ${origin}/api/seawall`,
    "",
    "## Features",
    ...FEATURE_LIST.map((f) => {
      const rec = r[featureId(f)];
      return `- ${f.tag} ${f.title}: ${origin}${f.href}${f.contract ? ` · contract ${f.contract}` : ""}${rec ? ` · latest tx ${rec.url}` : ""}`;
    }),
    "",
    "## Contracts (proxy → implementation)",
    ...CONTRACT_ROWS.map((c) => `- ${CHAINS[c.chain].name} ${c.name}: ${explorerAddress(c.chain, c.proxy)} → ${c.implementation}`),
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" } });
}
