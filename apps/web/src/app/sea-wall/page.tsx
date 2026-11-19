import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SeaWallLive } from "@/components/seawall/live";

export const metadata: Metadata = { title: "Sea Wall", description: "Live proof of reserves, LayerZero lane limits, DVN configuration and guardian controls for OMNITIDE." };

const GUARDS = [
  { tag: "guardian pause", title: "Stops new risk, never exits", body: "The guardian can halt cross-chain sends of tdUSD and any new risk on the book. Closing positions and withdrawing on Robinhood Chain keep working while paused." },
  { tag: "deposit cap", title: "Growth with a ceiling", body: "The clearinghouse refuses deposits past its cap. Inflows that arrive over the cap still credit, so nothing gets stranded mid-flight." },
  { tag: "rate limit", title: "Every lane has a speed limit", body: "Each chain-to-chain lane can move a fixed amount of tdUSD per hour. A burst beyond it reverts at the source, before LayerZero carries anything." },
  { tag: "dvn", title: "Messages verified before delivery", body: "LayerZero's DVN must attest each message after the source chain reaches its block confirmations. Nothing is minted on arrival without it." },
  { tag: "oracle", title: "Prices expire in two minutes", body: "Every trade, withdrawal and liquidation carries keeper-signed EIP-712 reports. The oracle rejects unknown signers, future timestamps and anything older than 120 s." },
  { tag: "upgrades", title: "Same address, every upgrade", body: "All contracts sit behind UUPS proxies with locked implementations, so fixes ship without moving balances or changing an address." },
];

export default function SeaWall() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1440px] px-4 pt-28 pb-24 sm:px-8 sm:pt-36">
        <div className="grid gap-6 md:grid-cols-[1fr_380px] md:items-end">
          <div>
            <p className="tag text-ink-3">Safeguards · read live from four contracts on three chains</p>
            <h1 className="display mt-4 text-[clamp(52px,8vw,112px)] text-ink">The Sea Wall</h1>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">Everything on this page is read from the chain as you look at it: what the hub holds, what it owes, and how each LayerZero lane is guarded.</p>
        </div>
        <div className="mt-12">
          <SeaWallLive />
        </div>
        <div className="mt-24 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {GUARDS.map((g) => (
            <article key={g.tag}>
              <span className="tag inline-block rounded-[4px] bg-navy px-2 py-0.5 text-white">{g.tag}</span>
              <h2 className="display mt-4 text-[32px] text-ink">{g.title}</h2>
              <p className="mt-3 max-w-sm text-[14px] leading-[22px] text-ink-2">{g.body}</p>
            </article>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
