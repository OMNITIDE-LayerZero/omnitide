const FEATURES = [
  { tag: "#01 · inflow", title: "Deposit from anywhere", body: "One signature from any spoke. LayerZero routes your tdUSD to the hub and lzCompose credits your account the moment it lands.", note: "OFT send → DVN verify → lzReceive → lzCompose → credit" },
  { tag: "#02 · ebb", title: "Leave where you like", body: "Withdraw on the hub or straight out to any spoke LayerZero reaches in one hop. Free margin is checked against live signed prices before a single unit moves.", note: "withdraw(amount, dstEid, receiver, reports)" },
  { tag: "#03 · cross margin", title: "One balance backs it all", body: "Long NVDA, short ETH, same collateral. Gains in one position hold up the other, and one account health covers the book.", note: "max 8 positions · equity = balance + Σ uPnL" },
  { tag: "#04 · orders", title: "Orders that wait for you", body: "Limit, stop-loss and take-profit live on-chain. The keeper checks every five seconds and fills once the signed price crosses your trigger.", note: "keeper tick 5 s · reduce-only for SL/TP" },
  { tag: "#05 · tide pool", title: "Liquidity on the other side", body: "The Tide Pool takes the other side of every fill at the oracle price. No book to thin out, no slippage past your limit.", note: "fee 10 bps · liquidation 1%, 20% to the caller" },
  { tag: "#06 · prices", title: "Prices with a signature", body: "Crypto from Coinbase, US stocks from Nasdaq, each report signed under EIP-712 and rejected on-chain after 120 seconds.", note: "PriceReport(bytes32 feed, uint256 price, uint64 timestamp)" },
];

export function Features() {
  return (
    <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((f) => (
        <article key={f.tag} className="group">
          <span className="tag inline-block rounded-[4px] bg-navy px-2 py-0.5 text-white">{f.tag}</span>
          <h3 className="display mt-4 text-[32px] text-ink">{f.title}</h3>
          <p className="mt-3 max-w-sm text-[14px] leading-[22px] text-ink-2">{f.body}</p>
          <p className="tag mt-4 border-t border-line pt-3 text-ink-3 transition-colors group-hover:text-accent-ink">{f.note}</p>
        </article>
      ))}
    </div>
  );
}
