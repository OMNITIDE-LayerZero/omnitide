import { Plus } from "lucide-react";
import { ChartGrid } from "./backdrops";
import { MARKETS } from "@omnitide/contracts/markets";
import { FEE_BPS, GOV } from "@/lib/contracts";
import { IS_MAINNET, SPOKE_LIST } from "@/lib/chains";

const QA: { q: string; a: string }[] = [
  {
    q: "What is OMNITIDE?",
    a: `A perps exchange with one margin account on Robinhood Chain. You fund it from ${SPOKE_LIST} through LayerZero, then trade ${MARKETS.length} markets, from BTC and ETH to NVDA and Alibaba, off the same balance.`,
  },
  {
    q: "What do I trade with?",
    a: IS_MAINNET
      ? "tdUSD, a dollar that moves between chains as a LayerZero OFT. Stablecoin Ports mint it 1:1 against USDG on Robinhood Chain and USDC on the spokes, and redeem it from the same reserve."
      : "tdUSD, a dollar that moves between chains as a LayerZero OFT. On testnet the terminal's faucet hands it out so you can trade right away.",
  },
  {
    q: "How long does a deposit from another chain take?",
    a: "One transaction on your chain. LayerZero verifies the message with its DVNs, the executor delivers it, and lzCompose credits your margin the moment it lands. No second click on Robinhood Chain.",
  },
  {
    q: "Where do prices come from?",
    a: "Crypto from Coinbase, US and China stocks from Nasdaq. Each report is signed under EIP-712, and the clearinghouse rejects any report older than 120 seconds.",
  },
  {
    q: "How much leverage can I use?",
    a: "Up to 10× on BTC, ETH and SPY, and 3.3× to 6.7× on the rest. One cross-margined balance backs every position, and the tide gauge shows how far you sit above maintenance margin.",
  },
  {
    q: "Can I keep my positions private?",
    a: "Yes. Deep Mode moves your book into a pooled account: the chain stores only a keccak commitment and a ciphertext that opens with your key. Stops can be sealed too, and you can hand one read-only disclosure key to whoever needs to see it.",
  },
  {
    q: "Are the contracts verified?",
    a: "Every contract sits behind a UUPS proxy with its source published on the chain's explorer. The full list, with proxy and implementation addresses, is right above.",
  },
  {
    q: `What does $${GOV} do?`,
    a: `$${GOV} is the Council vote. Stake it on any chain it sails to, vote on proposals, and LayerZero carries spoke votes back into one tally on the hub.`,
  },
];

// the numbers the contracts and keeper run on, as the features list states them
const SPEC = [
  ["Trading fee", `${FEE_BPS} bps`],
  ["Price report max age", "120 s"],
  ["Keeper order check", "every 5 s"],
  ["Liquidation penalty", "1%, 20% to the caller"],
  ["Positions per account", "up to 8"],
  ["Equity snapshot", "every 10 min"],
] as const;

/** Straight answers in native details, so they work by keyboard and find-in-page. */
export function Faq() {
  return (
    <section id="faq" className="relative isolate scroll-mt-16 overflow-hidden border-t border-line bg-shelf py-12 sm:py-16">
      <ChartGrid seed="faq" rose="left" />
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 sm:px-8 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="tag text-[12px] text-ink-2">Questions · straight answers</p>
          <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-ink">
            Before you
            <br />
            dive in
          </h2>
          <dl className="mt-10 max-w-sm rounded-2xl border border-line bg-card p-5">
            <p className="tag text-ink-3">Spec sheet · read from the contracts</p>
            {SPEC.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-mono text-[12px] text-ink num">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {QA.map(({ q, a }, i) => (
            <details key={q} open={i === 0} className="group">
              <summary className="flex list-none items-center justify-between gap-4 py-4 text-[16px] leading-6 font-medium text-ink transition-colors hover:text-accent-ink [&::-webkit-details-marker]:hidden">
                {q}
                <Plus size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-3 transition-transform duration-300 ease-[var(--ease-tide)] group-open:rotate-45" />
              </summary>
              <p className="max-w-prose pb-5 text-[15px] leading-6 text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
