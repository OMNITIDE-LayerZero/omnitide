import { MarketsBoard } from "@/components/landing/markets-board";

export default function Markets() {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="tag text-ink-3">Signed by the keeper · verified on-chain by OmnitideOracle</p>
          <h1 className="display mt-2 text-[44px] text-ink">Markets</h1>
        </div>
        <p className="max-w-md text-[13px] leading-5 text-ink-2">Crypto prices come from Coinbase, US and China stock prices from Nasdaq. Each report is signed under EIP-712 and rejected on-chain once it is older than 120 seconds.</p>
      </div>
      <div className="mt-6">
        <MarketsBoard />
      </div>
    </div>
  );
}
