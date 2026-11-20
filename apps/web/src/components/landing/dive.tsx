"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { HUB_KEY, explorerAddress } from "@/lib/chains";
import { InflowDemo, LensDemo, SealDemo } from "./dive-demos";

const FEATURES = [
  { tag: "#01 · inflow", title: "Deposit from anywhere", body: "One signature from any spoke. LayerZero routes your tdUSD to the hub and lzCompose credits your account the moment it lands.", note: "OFT send → DVN verify → lzReceive → lzCompose → credit" },
  { tag: "#02 · ebb", title: "Leave where you like", body: "Withdraw on the hub or straight out to any spoke LayerZero reaches in one hop. Free margin is checked against live signed prices before a single unit moves.", note: "withdraw(amount, dstEid, receiver, reports)" },
  { tag: "#03 · cross margin", title: "One balance backs it all", body: "Long NVDA, short ETH, same collateral. Gains in one position hold up the other, and one account health covers the book.", note: "max 8 positions · equity = balance + Σ uPnL" },
  { tag: "#04 · orders", title: "Orders that wait for you", body: "Limit, stop-loss and take-profit live on-chain. The keeper checks every five seconds and fills once the signed price crosses your trigger.", note: "keeper tick 5 s · reduce-only for SL/TP" },
  { tag: "#05 · tide pool", title: "Liquidity on the other side", body: "The Tide Pool takes the other side of every fill at the oracle price. No book to thin out, no slippage past your limit.", note: "fee 10 bps · liquidation 1%, 20% to the caller" },
  { tag: "#06 · prices", title: "Prices with a signature", body: "Crypto from Coinbase, US and China stocks from Nasdaq, each report signed under EIP-712 and rejected on-chain after 120 seconds.", note: "PriceReport(bytes32 feed, uint256 price, uint64 timestamp)" },
  { tag: "#07 · tide chart", title: "Every chain, one read", body: "One LayerZero lzRead pulls tdUSD supply off every chain its read DVNs cover and lands it in a single verified answer, next to live open interest for every market.", note: "OmnitideTideReader · read channel 4294967295" },
  { tag: "#08 · tidal lens", title: "Crash it before the market does", body: "Throw a flash crash, a tech rotation, a black swan, a short squeeze and a Hang Seng gap at your live positions and at the whole book, and see exactly where the wall gives.", note: "instant shock · same math as maintenance margin" },
  { tag: "#09 · book rank", title: "Your book, graded", body: "Six RADAR dials, from leverage to gap risk, plus five stress scenarios roll into one score out of 100 and a grade from A to D.", note: "an A means surviving every scenario" },
  { tag: "#10 · simulator", title: "Shared or walled off", body: "Drop your legs into the margin simulator and compare one shared balance with isolated buckets under the same shock, leg by leg.", note: "isolated buckets sized by initial margin" },
  { tag: "#11 · riptide", title: "A ping before the wall", body: "Arm alerts with one free wallet signature. The keeper reads your account every minute and calls the moment the tide drops under your line.", note: "push to this browser · no transaction" },
  { tag: "#12 · lifeline", title: "Top up from any chain", body: "When margin runs thin, the terminal finds tdUSD sitting in your wallet on other chains and pulls it in with one send. lzCompose credits it on arrival.", note: "need = 2 × maintenance − equity" },
  { tag: "#13 · harbor", title: "Park idle tdUSD, earn the flow", body: "Harbor is an ERC-4626 OVault behind the Tide Pool. Deposit from Robinhood Chain or Arbitrum, earn fees, penalties and trader give-backs, hold htdUSD on either chain.", note: "tdUSD → lzCompose → mint → htdUSD OFT home" },
  { tag: "#14 · reports", title: "Receipts for every tick", body: "An equity curve snapshotted every ten minutes and CSV exports of fills, transfers and equity, every row tied to a transaction hash.", note: "trades · transfers · equity snapshots" },
  { tag: "#15 · china shelf", title: "Shanghai hours, Robinhood rails", body: "Alibaba, PDD, JD, Baidu, NIO and the FXI large-cap ETF trade off the same tdUSD as your bitcoin. Hedge a China long with an NVDA short, then gap it in Tidal Lens before Hong Kong opens.", note: "6 markets · US-listed ADRs · up to 5× · Nasdaq-signed" },
  { tag: "#16 · deep mode", title: "Your book goes dark", body: "Privacy for perps on a public chain. Opt in and your positions, entries and PnL vanish from the explorer: every Deep book trades as one pooled account, and the chain keeps only a keccak commitment and a ciphertext that opens with your key alone.", note: "private book · x25519 key wrap · AES-256-GCM · keccak commitment" },
  { tag: "#17 · disclosure key", title: "Private to all, provable to one", body: "Selective disclosure on your terms. Hand an auditor, fund admin or tax pro one read-only key: they replay every sealed state of your book in their browser and match each one to its on-chain commitment. Everyone else still sees a hash.", note: "selective disclosure · read-only · can't trade · can't withdraw" },
  { tag: "#18 · private inflow", title: "Private collateral, cross-chain", body: "Fund a private book straight from Arbitrum. LayerZero lands your tdUSD in the Deep pool and lzCompose credits your Deep id, never your public margin account, so the balance you trade with stays off the open book from the first block.", note: "confidential collateral · OFT send → lzCompose → DeepDeposit(id)" },
  { tag: "#19 · sealed orders", title: "Private stops nobody can hunt", body: "Your exits stay your business. Seal a stop-loss or take-profit and only its hash goes on-chain: trigger, size and side stay encrypted until the keeper fills it at the signed price, so stop hunters have nothing to aim at.", note: "private orders · commit · encrypted to keeper + you · reveal on fill" },
  { tag: "#20 · currents", title: "A leaderboard of receipts", body: "Rank by realized PnL or volume straight from on-chain fills, mint a verified PnL card, warm up in a paper account and post the card to X. Deep Mode books stay private and off the board.", note: "summed from Traded events · zero self-reporting" },
  { tag: "#21 · arena", title: "Medals that travel", body: "Eight engraved Arena Badges for first fills, Inflows, Grade A books and more. Claim on Robinhood Chain, sail them to Arbitrum as an ONFT.", note: "ERC-721 · keeper-signed claim · LayerZero ONFT" },
  { tag: "#22 · council", title: "Vote from where you stand", body: "Stake TIDE on Robinhood Chain or Arbitrum. Proposals mirror to every chain and spoke votes ride LayerZero back into one tally on the hub.", note: "stake lock until the vote closes · no double votes" },
  { tag: "#23 · lighthouse", title: "Show the grade, keep the book", body: "Privacy-first reputation. Publish a keeper-signed Book Score with not a single position attached. Any protocol on any chain can call scoreOf(you) and read your grade, never your trades.", note: "score only, no positions · EIP-712 Beam · OApp broadcast · 7-day expiry" },
  { tag: "#24 · copy vaults", title: "Back the trader, not the screenshot", body: "Leaders trade a vault, followers hold shares priced at live NAV, and deposits can come straight from Arbitrum in one transaction.", note: "BeaconProxy vault · lzCompose queue · keeper settle" },
];

type Feature = (typeof FEATURES)[number];

const TIERS = [
  {
    id: "shoreline",
    v: "V1",
    name: "Shoreline",
    from: 0,
    to: 40,
    title: "Every chain is a way in.",
    blurb: "Collateral from any spoke lands as margin on Robinhood Chain in one LayerZero delivery. Cross-margin perps on crypto and US stocks, priced by signed reports, with a pool on the other side of every fill.",
    features: FEATURES.slice(0, 6),
    contracts: ["OmnitideClearinghouse", "OmnitideOracle", "OmnitideUSD"],
    primitives: ["LayerZero OFT", "lzCompose", "EIP-712 price reports", "UUPS proxies"],
    Demo: InflowDemo,
    dark: false,
    bg: "bg-bg",
  },
  {
    id: "current",
    v: "V2",
    name: "Current",
    from: 40,
    to: 200,
    title: "See the whole current.",
    blurb: "One lzRead across every chain, a stress test you can throw at your own book, and a ping before the tide reaches your wall. Risk you can see before it moves.",
    features: FEATURES.slice(6, 15),
    contracts: ["OmnitideTideReader", "OmnitideHarbor", "OmnitideHarborShareAdapter"],
    primitives: ["lzRead", "OVault (ERC-4626)", "OFT shares", "keeper alerts"],
    Demo: LensDemo,
    dark: true,
    bg: "bg-navy-2 engrave",
  },
  {
    id: "deep",
    v: "V3",
    name: "Deep Water",
    from: 200,
    to: 480,
    title: "Trade below the surface.",
    blurb: "The privacy layer. Sealed positions, private stops and private inflows, with selective disclosure when you choose it, plus grades, medals and vaults anyone can verify without seeing a single position.",
    features: FEATURES.slice(15),
    contracts: ["OmnitideDeepPool", "OmnitideLighthouse", "OmnitideBadge", "OmnitideCouncil", "OmnitideCopyVaultFactory", "OmnitideToken"],
    primitives: ["OApp", "ONFT", "x25519 + AES-256-GCM", "keccak commitments", "selective disclosure", "beacon proxies"],
    Demo: SealDemo,
    dark: true,
    bg: "bg-abyss",
  },
] as const;

// depth marker at the top of each tier after the first
const NOTES = ["−40 m · thermocline · sunlight gives way to the current", "−200 m · twilight zone · opt into privacy and your book goes dark"];

const SCALE = 160; // px height of the depth scale on the dive computer

/** The contracts and LayerZero primitives a depth runs on, with hub explorer links. */
function UnderTheHood({ contracts, primitives, dark }: { contracts: readonly string[]; primitives: readonly string[]; dark: boolean }) {
  const rows = contracts.flatMap((name) => CONTRACT_ROWS.filter((r) => r.chain === HUB_KEY && r.name === name));
  return (
    <div className={`mt-8 rounded-2xl border p-5 ${dark ? "border-white/12 bg-white/[0.03]" : "border-line bg-card/70"}`}>
      <p className={`tag ${dark ? "text-white/55" : "text-ink-3"}`}>Under the hood · on Robinhood Chain</p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3 text-[13px]">
            <span className={dark ? "text-white/85" : "text-ink"}>{r.name}</span>
            <a href={explorerAddress(r.chain, r.proxy)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-mono text-[12px] hover:underline ${dark ? "text-[#c9d3ff]" : "text-accent-ink"}`}>
              {r.proxy.slice(0, 6)}…{r.proxy.slice(-4)}
              <ExternalLink size={11} strokeWidth={1.5} />
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {primitives.map((p) => (
          <span key={p} className={`tag rounded-md border px-2 py-0.5 ${dark ? "border-white/15 text-white/70" : "border-line-strong text-ink-2"}`}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One feature per row; a row opens to its body and the contract-level note. One open at a time. */
function Accordion({ items, dark }: { items: readonly Feature[]; dark: boolean }) {
  const [open, setOpen] = useState(0);
  const line = dark ? "border-white/12" : "border-line";
  return (
    <ol className={`border-t ${line}`}>
      {items.map((f, i) => {
        const [num, name] = f.tag.replace("#", "").split(" · ");
        const on = open === i;
        return (
          <li key={f.tag} className={`border-b ${line}`}>
            <button type="button" aria-expanded={on} onClick={() => setOpen(on ? -1 : i)} className="group flex w-full items-center gap-4 py-3.5 text-left">
              <span className={`tag w-6 shrink-0 ${dark ? "text-white/45" : "text-ink-3"}`}>{num}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[16px] leading-6 font-medium transition-colors ${dark ? (on ? "text-[#c9d3ff]" : "text-white group-hover:text-[#c9d3ff]") : on ? "text-accent-ink" : "text-ink group-hover:text-accent-ink"}`}>{f.title}</span>
                <span className={`tag block ${dark ? "text-white/45" : "text-ink-3"}`}>{name}</span>
              </span>
              <Plus size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 transition-transform duration-300 ease-[var(--ease-tide)] ${on ? "rotate-45" : "group-hover:rotate-90"} ${dark ? "text-white/60" : "text-ink-3"}`} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-tide)] ${on ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <div className="pb-4 pl-10">
                  <p className={`max-w-prose text-[14px] leading-[22px] ${dark ? "text-white/70" : "text-ink-2"}`}>{f.body}</p>
                  <p className={`tag mt-3 inline-block rounded-md border px-2 py-1 ${dark ? "border-[#8ea2ff]/30 text-[#c9d3ff]" : "border-accent/25 text-accent-ink"}`}>{f.note}</p>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Feature section as a dive: Shoreline, Current and Deep Water get darker as you scroll, with a dive computer reading the depth. */
export function Dive() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const tiers = [...el.querySelectorAll<HTMLElement>("[data-tier]")];
    const depths = [...el.querySelectorAll<HTMLElement>("[data-depth]")];
    const names = [...el.querySelectorAll<HTMLElement>("[data-tier-name]")];
    const pressure = el.querySelector<HTMLElement>("[data-pressure]");
    const light = el.querySelector<HTMLElement>("[data-light]");
    const marker = el.querySelector<HTMLElement>("[data-marker]");
    const links = [...el.querySelectorAll<HTMLElement>("[data-tier-link]")];
    let raf = 0;
    let active = false;
    let last = "";
    const read = () => {
      raf = 0;
      const mid = window.innerHeight * 0.5;
      let idx = 0;
      let t = 0;
      tiers.forEach((tier, i) => {
        const r = tier.getBoundingClientRect();
        if (r.top <= mid) {
          idx = i;
          t = Math.min(1, (mid - r.top) / r.height);
        }
      });
      const T = TIERS[idx]!;
      const d = Math.round(T.from + t * (T.to - T.from));
      if (marker) marker.style.transform = `translateY(${((idx + t) / TIERS.length) * SCALE}px)`;
      const key = `${d}|${idx}`;
      if (key === last) return;
      last = key;
      for (const n of depths) n.textContent = d < 1 ? "Surface" : `−${d} m`;
      for (const n of names) n.textContent = `${T.v} · ${T.name}`;
      if (pressure) pressure.textContent = `${(1 + d / 10.06).toFixed(1)} atm`;
      const lux = 100 * Math.exp(-d / 45);
      if (light) light.textContent = lux >= 1 ? `${Math.round(lux)}%` : "<1%";
      links.forEach((l, i) => (l.dataset.active = String(i === idx)));
    };
    const onScroll = () => {
      if (active) raf ||= requestAnimationFrame(read);
    };
    const io = new IntersectionObserver(([e]) => {
      active = !!e?.isIntersecting;
      if (active) onScroll();
    });
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    read();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section id="dive" className="relative bg-bg">
      <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-8 sm:pt-12">
        <div className="grid gap-6 md:grid-cols-[1fr_340px] md:items-end">
          <div>
            <p className="tag text-[12px] text-ink-2">Live now · {FEATURES.length} features across three depths</p>
            <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-ink">
              Powered by LayerZero.
              <br />
              Built for every chain.
            </h2>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">
            Every layer of OMNITIDE runs live on testnet. Dive through it: the shoreline gets collateral in, the current reads every chain at once, and deep water keeps your book private.
          </p>
        </div>
      </div>

      <div ref={root} className="relative mt-8">
        {TIERS.map((t, i) => (
          <div key={t.id} className="contents">
            <div id={`dive-${t.id}`} data-tier data-tone={t.dark ? "dark" : undefined} className={`relative scroll-mt-16 overflow-hidden ${t.bg} ${t.dark ? "text-white" : "text-ink"}`}>
              {t.id === "deep" && <div className="snow" aria-hidden />}
              {i > 0 && (
                <div className="relative mx-auto flex max-w-[1440px] items-center gap-4 px-4 pt-10 sm:px-8 lg:pl-[248px]">
                  <span className="tag rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-white/80">{NOTES[i - 1]}</span>
                  <span className="h-px flex-1 bg-white/15" />
                </div>
              )}
              <div className="relative mx-auto grid max-w-[1440px] gap-10 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:pl-[248px]">
                <div className="min-w-0">
                  <p className={`tag text-[12px] ${t.dark ? "text-white/65" : "text-ink-2"}`}>
                    {t.v} · {t.name} · {t.to === 480 ? "200 m and below" : `${t.from}–${t.to} m`} · {t.features.length} features
                  </p>
                  <h3 className="display mt-3 text-[clamp(36px,4.2vw,56px)]">{t.title}</h3>
                  <p className={`mt-4 max-w-lg text-[15px] leading-[23px] ${t.dark ? "text-white/70" : "text-ink-2"}`}>{t.blurb}</p>
                  <div className="mt-8">
                    <t.Demo />
                  </div>
                </div>
                <div className="min-w-0 lg:pt-2">
                  <Accordion items={t.features} dark={t.dark} />
                  <UnderTheHood contracts={t.contracts} primitives={t.primitives} dark={t.dark} />
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* dive computer: sticky beside the tiers on desktop, a depth chip under the nav on phones */}
        <div className="pointer-events-none absolute inset-0">
          {/* bottom of the column, stuck to the bottom of the screen: clear of the nav's haze */}
          <div className="flex h-full flex-col justify-end lg:hidden">
            <div className="sticky bottom-4 flex justify-end px-4 pb-4 sm:px-8">
              <span className="tag rounded-full border border-white/15 bg-abyss/90 px-3 py-1.5 text-white shadow-md backdrop-blur-sm">
                <span data-depth>Surface</span> · <span data-tier-name>V1 · Shoreline</span>
              </span>
            </div>
          </div>
          <div className="mx-auto hidden h-full max-w-[1440px] px-8 lg:block">
            <aside aria-label="Dive computer" className="pointer-events-auto sticky top-24 mt-14 w-[200px] rounded-2xl border border-white/10 bg-abyss/90 p-4 text-white shadow-md backdrop-blur-md">
              <p className="tag text-white/50">Dive computer</p>
              <p data-depth className="display mt-2 text-[40px] normal-case num">
                Surface
              </p>
              <p data-tier-name className="tag text-[#8ea2ff]">
                V1 · Shoreline
              </p>
              <div className="relative mt-4 flex gap-3" style={{ height: SCALE }}>
                <div className="relative w-1.5 overflow-hidden rounded-full bg-gradient-to-b from-[#c9d3ff] via-[#3b4bd6] to-[#05082a]">
                  <span data-marker className="absolute -left-1 top-0 h-0.5 w-3.5 bg-white shadow-[0_0_0_2px_rgb(4_7_42)] transition-transform duration-150" />
                </div>
                <div className="flex flex-1 flex-col justify-between">
                  {TIERS.map((t) => (
                    <a key={t.id} href={`#dive-${t.id}`} data-tier-link data-active={t.id === "shoreline"} className="group block rounded-md px-1.5 py-1 text-white/55 transition-colors hover:bg-white/5 hover:text-white data-[active=true]:text-white">
                      <span className="block text-[13px] leading-4">{t.name}</span>
                      <span className="tag block text-white/40 group-data-[active=true]:text-[#8ea2ff]">{t.to === 480 ? "200 m +" : `${t.from}–${t.to} m`}</span>
                    </a>
                  ))}
                </div>
              </div>
              <dl className="tag mt-4 grid grid-cols-2 gap-y-1 border-t border-white/10 pt-3 text-white/55">
                <dt>Pressure</dt>
                <dd data-pressure className="text-right text-white num">
                  1.0 atm
                </dd>
                <dt>Sunlight</dt>
                <dd data-light className="text-right text-white num">
                  100%
                </dd>
              </dl>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
