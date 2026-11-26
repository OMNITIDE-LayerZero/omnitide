"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Plus } from "lucide-react";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { HUB_KEY, IS_MAINNET, explorerAddress } from "@/lib/chains";
import { ago, shortHash } from "@/lib/format";
import { useReceipts, type Receipt } from "@/lib/hooks";
import { InflowDemo, LensDemo, SealDemo } from "./dive-demos";
import { FEATURE_LIST, featureId, type Feature } from "./features";


const TIERS = [
  {
    id: "shoreline",
    v: "V1",
    name: "Shoreline",
    from: 0,
    to: 40,
    title: "Every chain is a way in.",
    blurb: "Collateral from any spoke lands as margin on Robinhood Chain in one LayerZero delivery. Cross-margin perps on crypto and US stocks, priced by signed reports, with a pool on the other side of every fill.",
    features: FEATURE_LIST.slice(0, 6),
    contracts: ["OmnitideClearinghouse", "OmnitideOracle", "OmnitideUSD"],
    primitives: ["LayerZero OFT", "lzCompose", "EIP-712 price reports", "UUPS proxies"],
    Demo: InflowDemo,
    live: { href: "/terminal/portfolio", label: "Run a real Inflow" },
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
    features: FEATURE_LIST.slice(6, 15),
    contracts: ["OmnitideTideReader", "OmnitideHarbor", "OmnitideHarborShareAdapter"],
    primitives: ["lzRead", "OVault (ERC-4626)", "OFT shares", "keeper alerts"],
    Demo: LensDemo,
    live: { href: "/terminal/risk", label: "Shock your own book" },
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
    features: FEATURE_LIST.slice(15),
    contracts: ["OmnitideDeepPool", "OmnitideLighthouse", "OmnitideBadge", "OmnitideCouncil", "OmnitideCopyVaultFactory", "OmnitideToken", "OmnitideTokenAdapter"],
    primitives: ["OApp", "ONFT", "x25519 + AES-256-GCM", "keccak commitments", "selective disclosure", "beacon proxies"],
    Demo: SealDemo,
    live: { href: "/terminal/deep", label: "Seal a real stop" },
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

/** A feature's latest mainnet transaction, linked to its explorer or LayerZero Scan. */
function ReceiptLink({ r, dark }: { r: Receipt; dark: boolean }) {
  return (
    <a href={r.url} target="_blank" rel="noreferrer" className={`tag mt-2 flex w-fit items-center gap-1.5 hover:underline ${dark ? "text-white/65" : "text-ink-2"}`}>
      <span className="size-1.5 rounded-full bg-[#4cc38a]" aria-hidden />
      on-chain · {r.chain} · tx {shortHash(r.tx)} · {ago(r.at)}
      <ExternalLink size={11} strokeWidth={1.5} />
    </a>
  );
}

/** Under each sandbox: the page where the feature runs for real, and the newest receipt from this depth. */
function LiveStrip({ live, features, receipts, dark }: { live: { href: string; label: string }; features: readonly Feature[]; receipts?: Record<string, Receipt>; dark: boolean }) {
  const last = features.map((f) => receipts?.[featureId(f)]).filter((r): r is Receipt => !!r).sort((a, b) => b.at - a.at)[0];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
      <Link href={live.href} className={`btn btn-sm ${dark ? "border border-white/25 text-white hover:bg-white/10" : "btn-primary"}`}>
        {live.label}
        <ArrowUpRight size={14} strokeWidth={1.5} />
      </Link>
      {last && <ReceiptLink r={last} dark={dark} />}
      <Link href="/proof" className={`tag hover:underline ${dark ? "text-white/55" : "text-ink-3"}`}>
        all receipts
      </Link>
    </div>
  );
}

/** One feature per row; a row opens to its body and the contract-level note. One open at a time. */
function Accordion({ items, dark, receipts }: { items: readonly Feature[]; dark: boolean; receipts?: Record<string, Receipt> }) {
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
                  {receipts?.[featureId(f)] && <ReceiptLink r={receipts[featureId(f)]!} dark={dark} />}
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
  const { data: receipts } = useReceipts();

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
            <p className="tag text-[12px] text-ink-2">Live now · {FEATURE_LIST.length} features across three depths</p>
            <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-ink">
              Powered by LayerZero.
              <br />
              Built for every chain.
            </h2>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">
            {IS_MAINNET ? "All three depths are deployed on mainnet, and every on-chain receipt below opens its transaction." : "Every layer of OMNITIDE runs live on testnet."} Dive through it: the shoreline gets collateral in, the current reads every chain at once, and deep water keeps your book private.
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
                    <LiveStrip live={t.live} features={t.features} receipts={receipts} dark={t.dark} />
                  </div>
                </div>
                <div className="min-w-0 lg:pt-2">
                  <Accordion items={t.features} dark={t.dark} receipts={receipts} />
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
