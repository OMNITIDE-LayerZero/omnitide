const FEATURES = [
  { tag: "#01 · inflow", title: "Deposit from anywhere", body: "One signature from any spoke. LayerZero routes your tdUSD to the hub and lzCompose credits your account the moment it lands.", note: "OFT send → DVN verify → lzReceive → lzCompose → credit" },
  { tag: "#02 · ebb", title: "Leave where you like", body: "Withdraw on the hub or straight out to any spoke LayerZero reaches in one hop. Free margin is checked against live signed prices before a single unit moves.", note: "withdraw(amount, dstEid, receiver, reports)" },
  { tag: "#03 · cross margin", title: "One balance backs it all", body: "Long NVDA, short ETH, same collateral. Gains in one position hold up the other, and one account health covers the book.", note: "max 8 positions · equity = balance + Σ uPnL" },
  { tag: "#04 · orders", title: "Orders that wait for you", body: "Limit, stop-loss and take-profit live on-chain. The keeper checks every five seconds and fills once the signed price crosses your trigger.", note: "keeper tick 5 s · reduce-only for SL/TP" },
  { tag: "#05 · tide pool", title: "Liquidity on the other side", body: "The Tide Pool takes the other side of every fill at the oracle price. No book to thin out, no slippage past your limit.", note: "fee 10 bps · liquidation 1%, 20% to the caller" },
  { tag: "#06 · prices", title: "Prices with a signature", body: "Crypto from Coinbase, US stocks from Nasdaq, each report signed under EIP-712 and rejected on-chain after 120 seconds.", note: "PriceReport(bytes32 feed, uint256 price, uint64 timestamp)" },
  { tag: "#07 · tide chart", title: "Every chain, one read", body: "One LayerZero lzRead pulls tdUSD supply off every chain its read DVNs cover and lands it in a single verified answer, next to live open interest for every market.", note: "OmnitideTideReader · read channel 4294967295" },
  { tag: "#08 · tidal lens", title: "Crash it before the market does", body: "Throw a flash crash, a tech rotation, a black swan and a short squeeze at your live positions and at the whole book, and see exactly where the wall gives.", note: "instant shock · same math as maintenance margin" },
  { tag: "#09 · book rank", title: "Your book, graded", body: "Six RADAR dials, from leverage to gap risk, plus four stress scenarios roll into one score out of 100 and a grade from A to D.", note: "an A means surviving every scenario" },
  { tag: "#10 · simulator", title: "Shared or walled off", body: "Drop your legs into the margin simulator and compare one shared balance with isolated buckets under the same shock, leg by leg.", note: "isolated buckets sized by initial margin" },
  { tag: "#11 · riptide", title: "A ping before the wall", body: "Arm alerts with one free wallet signature. The keeper reads your account every minute and calls the moment the tide drops under your line.", note: "push to this browser · no transaction" },
  { tag: "#12 · lifeline", title: "Top up from any chain", body: "When margin runs thin, the terminal finds tdUSD sitting in your wallet on other chains and pulls it in with one send. lzCompose credits it on arrival.", note: "need = 2 × maintenance − equity" },
  { tag: "#13 · harbor", title: "Park idle tdUSD, earn the flow", body: "Harbor is an ERC-4626 OVault behind the Tide Pool. Deposit from Robinhood Chain or Arbitrum, earn fees, penalties and trader give-backs, hold htdUSD on either chain.", note: "tdUSD → lzCompose → mint → htdUSD OFT home" },
  { tag: "#14 · reports", title: "Receipts for every tick", body: "An equity curve snapshotted every ten minutes and CSV exports of fills, transfers and equity, every row tied to a transaction hash.", note: "trades · transfers · equity snapshots" },
  { tag: "#15 · deep mode", title: "Trade below the surface", body: "Private positions and private PnL. Every Deep book trades as one pooled account, and the chain keeps only a keccak commitment and a ciphertext sealed to your key.", note: "x25519 key wrap · AES-256-GCM · keccak commitment" },
  { tag: "#16 · disclosure key", title: "Prove it to one person", body: "Hand an auditor one read-only key. They replay every sealed state of your book in the browser and match each one to its on-chain commitment.", note: "read-only · can't trade · can't withdraw" },
  { tag: "#17 · private inflow", title: "Collateral that arrives quietly", body: "Send tdUSD from Arbitrum straight into the Deep pool. lzCompose credits your Deep id, never your public account, and the book stays sealed from there.", note: "OFT send → lzCompose → DeepDeposit(id)" },
  { tag: "#18 · sealed orders", title: "Stops nobody can hunt", body: "Seal a stop-loss or take-profit and only its hash goes on-chain. The trigger, size and side stay hidden until the keeper fills it at the signed price.", note: "commit · encrypted to keeper + you · reveal on fill" },
  { tag: "#19 · currents", title: "A leaderboard of receipts", body: "Rank by realized PnL or volume straight from on-chain fills, mint a verified PnL card, warm up in a paper account and post the card to X.", note: "summed from Traded events · zero self-reporting" },
  { tag: "#20 · arena", title: "Medals that travel", body: "Eight engraved Arena Badges for first fills, Inflows, Grade A books and more. Claim on Robinhood Chain, sail them to Arbitrum as an ONFT.", note: "ERC-721 · keeper-signed claim · LayerZero ONFT" },
  { tag: "#21 · council", title: "Vote from where you stand", body: "Stake TIDE on Robinhood Chain or Arbitrum. Proposals mirror to every chain and spoke votes ride LayerZero back into one tally on the hub.", note: "stake lock until the vote closes · no double votes" },
  { tag: "#22 · lighthouse", title: "Your grade, readable anywhere", body: "Publish a keeper-signed Book Score without a single position behind it. Any protocol on any chain can call scoreOf(you).", note: "EIP-712 Beam · OApp broadcast · 7-day expiry" },
  { tag: "#23 · copy vaults", title: "Back the trader, not the screenshot", body: "Leaders trade a vault, followers hold shares priced at live NAV, and deposits can come straight from Arbitrum in one transaction.", note: "BeaconProxy vault · lzCompose queue · keeper settle" },
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
