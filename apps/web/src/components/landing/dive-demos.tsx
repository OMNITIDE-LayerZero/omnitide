"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { parseUnits, type Address } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";
import { open, randomSalt, seal, sealedOrderCommitment, x25519Public } from "@omnitide/contracts/deep";
import { HUB_KEY, SHORT, inflowRoute } from "@/lib/chains";
import { usePriceMap, useSeaWall } from "@/lib/hooks";
import { SCENARIOS, bookRank, radar, shocked, stressAccount, type Scenario } from "@/lib/risk";
import { laneRows } from "@/lib/landing";
import { leverage, money, price, upnl } from "@/lib/format";
import { SPOKES } from "./route-map";
import { prefersReducedMotion, useSeen } from "./use-seen";

const chip = (on: boolean, dark: boolean) =>
  `h-8 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors ${
    dark
      ? on
        ? "border-[#8ea2ff] bg-[#8ea2ff]/15 text-white"
        : "border-white/15 text-white/70 hover:border-white/35 hover:text-white"
      : on
        ? "border-accent bg-accent text-on-accent"
        : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink"
  }`;

// ───────── Shoreline: an Inflow, step by step ─────────

const AMOUNTS = [250, 1000, 5000];
const BTC = MARKETS[0]!;
const NVDA = MARKETS.find((m) => m.symbol === "NVDA")!;

/** Pick a spoke and an amount; the Inflow plays out over the real lanes, with DVN and confirmation counts read live from each endpoint. */
export function InflowDemo() {
  const box = useRef<HTMLDivElement>(null);
  const seen = useSeen(box);
  const [from, setFrom] = useState<ChainKey>(SPOKES[0]!);
  const [amount, setAmount] = useState(1000);
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(0);
  const { data: wall } = useSeaWall();
  const lanes = laneRows(wall);
  const hops = [from, ...inflowRoute(from)];
  const legs = hops.slice(1).map((to, i) => ({ from: hops[i]!, to, lane: lanes.find((l) => l.from === hops[i] && l.to === to) }));
  const steps = [
    ...legs.flatMap((l) => [
      { title: `OFT send on ${SHORT[l.from]}`, note: `burns tdUSD, packet to eid ${CHAINS[l.to].eid}` },
      { title: "DVNs verify the packet", note: l.lane ? `${l.lane.dvns} DVN${l.lane.dvns === 1 ? "" : "s"} · ${l.lane.confirmations} block confirmations` : "required DVNs sign the payload hash" },
      { title: `Executor delivers on ${SHORT[l.to]}`, note: l.to === HUB_KEY ? "lzReceive mints tdUSD on the hub" : "lands on the relay, rides the next lane" },
    ]),
    { title: "lzCompose credits your margin", note: "same delivery, no claim step" },
  ];
  const total = steps.length;
  const done = step >= total;

  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) {
      setStep(total);
      return;
    }
    let s = 0;
    setStep(0);
    const t = setInterval(() => {
      s++;
      setStep(s);
      if (s >= total) clearInterval(t);
    }, 650);
    return () => clearInterval(t);
  }, [seen, run, from, total]);

  return (
    <div ref={box} className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="tag text-[12px] text-ink-2">Live demo · Inflow over real lanes</p>
        <button type="button" onClick={() => setRun((r) => r + 1)} className="btn btn-ghost btn-sm" aria-label="Replay the Inflow">
          <RotateCcw size={14} strokeWidth={1.5} />
          Replay
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Source chain">
        {SPOKES.map((k) => (
          <button key={k} type="button" aria-pressed={from === k} onClick={() => setFrom(k)} className={chip(from === k, false)}>
            {SHORT[k]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Amount">
        {AMOUNTS.map((a) => (
          <button key={a} type="button" aria-pressed={amount === a} onClick={() => setAmount(a)} className={chip(amount === a, false)}>
            {money(a).replace(".00", "")}
          </button>
        ))}
      </div>

      {/* the route: one bar per LayerZero leg, filling as its three steps land */}
      <div className="mt-6 flex items-center gap-2">
        {hops.map((k, i) => (
          <div key={k} className="contents">
            {i > 0 && (
              <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-raised">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-tide)]" style={{ width: `${Math.max(0, Math.min(1, (step - (i - 1) * 3) / 3)) * 100}%` }} />
              </div>
            )}
            <span className={`tag rounded-md border px-2 py-1 transition-colors ${step >= (i === 0 ? 0 : i * 3) ? "border-accent text-accent-ink" : "border-line text-ink-3"}`}>{SHORT[k]}</span>
          </div>
        ))}
      </div>

      <ol className="mt-5 grid gap-x-5 gap-y-2.5 sm:grid-flow-col" style={{ gridTemplateRows: `repeat(${Math.ceil(total / 2)}, auto)` }}>
        {steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "now" : "next";
          return (
            <li key={`${from}${i}`} className={`flex gap-3 transition-opacity duration-300 ${state === "next" ? "opacity-40" : ""}`}>
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${state === "done" ? "border-accent bg-accent text-on-accent" : state === "now" ? "border-accent text-accent-ink" : "border-line-strong"}`}>
                {state === "done" ? <Check size={12} strokeWidth={2} /> : <span className={`size-1.5 rounded-full ${state === "now" ? "bg-accent" : "bg-transparent"}`} />}
              </span>
              <span>
                <span className="block text-[14px] leading-5 text-ink">{s.title}</span>
                <span className="tag block text-ink-3">{s.note}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className={`mt-5 rounded-xl border p-4 transition-colors duration-500 ${done ? "border-accent/40 bg-sky/60" : "border-line bg-raised/40"}`}>
        <p className="text-[14px] text-ink-2">
          {done ? "Landed as" : "In flight:"} <span className="font-medium text-ink num">{money(amount)}</span> margin on Robinhood Chain
        </p>
        <p className="tag mt-1 text-ink-3">
          up to {money(amount * (10_000 / BTC.initialMarginBps))} of BTC at {leverage(BTC.initialMarginBps)} or {money(amount * (10_000 / NVDA.initialMarginBps))} of NVDA at {leverage(NVDA.initialMarginBps)} · 1 signature · {legs.length} LayerZero message{legs.length > 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

// ───────── Current: Tidal Lens on a sample book ─────────

const COLLATERAL = 1000;
const BOOK = [
  { symbol: "BTC", usd: 2500 },
  { symbol: "ETH", usd: -1000 },
  { symbol: "NVDA", usd: 1500 },
].map((l) => ({ ...l, market: MARKETS.find((m) => m.symbol === l.symbol)! }));

const levelTone = (lv: number) => (lv > 0.5 ? "#8ea2ff" : lv > 0.2 ? "#e2a336" : "#e5484d");
const GRADE_TONE: Record<string, string> = { A: "#4cc38a", B: "#8ea2ff", C: "#e2a336", D: "#e5484d" };

/** Shock a sample cross-margin book with the terminal's own Tidal Lens scenarios and Book Rank, on live prices. */
export function LensDemo() {
  const prices = usePriceMap();
  const [sid, setSid] = useState(SCENARIOS[0]!.id);
  const [size, setSize] = useState(100);
  const ready = BOOK.every((l) => prices[l.market.feed]);
  const view = useMemo(() => {
    if (!ready) return null;
    const positions = BOOK.map((l) => ({ marketId: l.market.id, size: l.usd / prices[l.market.feed]!, entry: prices[l.market.feed]! }));
    const base = SCENARIOS.find((s) => s.id === sid)!;
    const scenario: Scenario = { ...base, shock: (m) => base.shock(m) * (size / 100) };
    const res = stressAccount(COLLATERAL, positions, prices, scenario);
    const after = shocked(prices, scenario);
    const rank = bookRank(radar(COLLATERAL, positions, after), SCENARIOS.map((s) => !stressAccount(COLLATERAL, positions, after, s).liquidated));
    return { res, rank, blurb: base.blurb };
  }, [ready, prices, sid, size]);

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-5 text-white backdrop-blur-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="tag text-[12px] text-white/70">Live demo · Tidal Lens + Book Rank</p>
          <p className="tag mt-1 text-white/45">sample book · {money(COLLATERAL)} collateral · live prices</p>
        </div>
        {view && (
          <div className="text-right" aria-live="polite">
            <p className="display text-[48px] leading-none" style={{ color: GRADE_TONE[view.rank.grade] }}>
              {view.rank.grade}
            </p>
            <p className="tag text-white/55 num">Book Rank after the shock · {view.rank.score}/100</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Scenario">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" aria-pressed={sid === s.id} onClick={() => setSid(s.id)} className={chip(sid === s.id, true)}>
            {s.name}
          </button>
        ))}
      </div>
      <p className="mt-3 min-h-10 text-[13px] leading-5 text-white/65">{view?.blurb}</p>
      <label className="mt-3 flex items-center gap-3 text-[13px] text-white/70">
        <span className="shrink-0">Shock size</span>
        <input type="range" min={25} max={150} step={5} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[#8ea2ff]" />
        <span className="tag w-12 shrink-0 text-right text-white num">{size}%</span>
      </label>

      {view ? (
        <div className="mt-5 grid grid-cols-[56px_1fr] gap-5">
          {/* tide staff: water is margin above the wall, the dashed line is where it stood before the shock */}
          <div className="relative h-44 overflow-hidden rounded-lg border border-white/20 bg-white/[0.04]" role="meter" aria-label="Margin after the shock" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.res.after.level * 100)}>
            {[0.25, 0.5, 0.75].map((t) => (
              <span key={t} className="absolute left-0 h-px w-3 bg-white/30" style={{ bottom: `${t * 100}%` }} />
            ))}
            <span className="absolute inset-x-0 bottom-0 transition-[height,background-color] duration-700 ease-[var(--ease-tide)]" style={{ height: `${view.res.after.level * 100}%`, backgroundColor: levelTone(view.res.after.level) }} />
            <span className="absolute inset-x-0 border-t border-dashed border-white/80 transition-[bottom] duration-700" style={{ bottom: `${view.res.before.level * 100}%` }} />
            <span className="tag absolute inset-x-0 bottom-1 text-center text-[10px] text-white/80">wall</span>
          </div>
          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 text-[13px]">
            <div>
              <dt className="text-white/55">Equity before</dt>
              <dd className="mt-0.5 text-[17px] num">{money(view.res.before.equity)}</dd>
            </div>
            <div>
              <dt className="text-white/55">After the shock</dt>
              <dd className="mt-0.5 text-[17px] num">{view.res.after.equity > 0.005 ? money(view.res.after.equity) : "Wiped out"}</dd>
            </div>
            <div>
              <dt className="text-white/55">Book PnL</dt>
              <dd className={`mt-0.5 text-[17px] num ${view.res.pnl >= 0 ? "text-[#4cc38a]" : "text-[#ff8a8f]"}`}>{upnl(view.res.pnl)}</dd>
            </div>
            <div>
              <dt className="text-white/55">Margin above wall</dt>
              <dd className="mt-0.5 text-[17px] num">{view.res.after.level >= 0.01 ? `${Math.round(view.res.after.level * 100)}%` : "At the wall"}</dd>
            </div>
            <div className="col-span-2 rounded-lg border px-3 py-2" style={{ borderColor: view.res.liquidated ? "#e5484d" : "rgb(255 255 255 / 0.15)" }}>
              {view.res.liquidated ? "Hits the sea wall: the clearinghouse could liquidate this book" : "Holds above the wall: every leg keeps its margin"}
            </div>
          </dl>
        </div>
      ) : (
        <div className="mt-5 h-44 rounded-lg bg-white/[0.06]" aria-label="Loading live prices" />
      )}
      <p className="tag mt-4 text-white/45">
        {BOOK.map((l) => `${l.usd > 0 ? "long" : "short"} ${l.symbol} ${money(Math.abs(l.usd)).replace(".00", "")}`).join(" · ")} · same math as maintenance margin
      </p>
    </div>
  );
}

// ───────── Deep Water: a sealed stop, really sealed ─────────

// a demo trader: the commitment binds an account, it never leaves this page
const DEMO_ACCOUNT: Address = "0x00000000000000000000000000000000000d33f0";
const DEMO_SIZE = "0.05";

/** Characters settle left to right whenever the value changes, like a seal being stamped. */
function Scramble({ text, className = "" }: { text: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    if (prefersReducedMotion()) {
      n.textContent = text;
      return;
    }
    const HEX = "0123456789abcdef";
    const start = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const k = Math.min(1, (t - start) / 450);
      const fixed = Math.floor(k * text.length);
      n.textContent = text.slice(0, fixed) + Array.from(text.slice(fixed), (c) => (c === "x" ? c : HEX[(Math.random() * 16) | 0])).join("");
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <span ref={el} className={className} aria-label={text} />;
}

/** Seal a BTC stop-loss or take-profit with the production code: the same commitment the clearinghouse checks and the same sealed box the keeper opens. Demo keys are made in this tab. */
export function SealDemo() {
  const prices = usePriceMap();
  const live = prices["BTC-USD"];
  const [base, setBase] = useState<number>();
  const [kind, setKind] = useState<1 | 2>(1);
  const [off, setOff] = useState(-8);
  const [keys] = useState(() => {
    const keeper = randomSalt();
    const you = randomSalt();
    return { keeperPub: x25519Public(keeper), you, youPub: x25519Public(you), salt: randomSalt() };
  });
  useEffect(() => {
    if (live && !base) setBase(live);
  }, [live, base]);

  const trigger = base ? base * (1 + off / 100) : undefined;
  const sealed = useMemo(() => {
    if (!trigger) return null;
    const plain = { marketId: 0, kind, sizeDelta: parseUnits(`-${DEMO_SIZE}`, 18).toString(), triggerPrice: parseUnits(trigger.toFixed(2), 18).toString(), salt: keys.salt };
    const box = seal([keys.keeperPub, keys.youPub], JSON.stringify({ market: "BTC", kind, size: `-${DEMO_SIZE}`, trigger: trigger.toFixed(2) }));
    return { commitment: sealedOrderCommitment(DEMO_ACCOUNT, plain), box, opens: open(keys.you, box) !== null };
  }, [trigger, kind, keys]);

  const pick = (k: 1 | 2) => {
    setKind(k);
    setOff(k === 1 ? -8 : 8);
  };

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-5 text-white backdrop-blur-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tag text-[12px] text-white/70">Live demo · Sealed Orders</p>
        <div className="flex gap-2" role="group" aria-label="Order kind">
          <button type="button" aria-pressed={kind === 1} onClick={() => pick(1)} className={chip(kind === 1, true)}>
            Stop-loss
          </button>
          <button type="button" aria-pressed={kind === 2} onClick={() => pick(2)} className={chip(kind === 2, true)}>
            Take-profit
          </button>
        </div>
      </div>
      <label className="mt-5 flex items-center gap-3 text-[13px] text-white/70">
        <span className="shrink-0">Trigger</span>
        <input
          type="range"
          min={kind === 1 ? -25 : 1}
          max={kind === 1 ? -1 : 25}
          step={1}
          value={off}
          onChange={(e) => setOff(Number(e.target.value))}
          className="w-full accent-[#8ea2ff]"
        />
        <span className="tag w-10 shrink-0 text-right text-white num">{off > 0 ? `+${off}` : off}%</span>
      </label>

      {sealed && trigger ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/15 p-4">
            <p className="tag text-white/50">Your terminal sees</p>
            <p className="mt-2 text-[15px]">{kind === 1 ? "Stop-loss" : "Take-profit"} · BTC-PERP</p>
            <p className="mt-1 text-[13px] text-white/70 num">
              sell {DEMO_SIZE} BTC at {price(trigger)}
            </p>
            <p className="tag mt-3 flex items-center gap-1.5 text-[#4cc38a]">
              <Check size={12} strokeWidth={2} />
              {sealed.opens ? "opens with your view key" : "sealing"}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-[#8ea2ff]/40 bg-[#8ea2ff]/[0.06] p-4">
            <p className="tag text-white/50">Robinhood Chain stores</p>
            <p className="tag mt-2 text-white/60">commitment</p>
            <Scramble text={sealed.commitment} className="block font-mono text-[12px] leading-[18px] break-all text-white" />
            <p className="tag mt-2 text-white/60">sealed box · {(sealed.box.length - 2) / 2} bytes</p>
            <Scramble text={`${sealed.box.slice(0, 74)}…`} className="block font-mono text-[11px] leading-4 break-all text-white/55" />
          </div>
        </div>
      ) : (
        <div className="mt-5 h-40 rounded-xl bg-white/[0.06]" aria-label="Loading live prices" />
      )}
      <p className="tag mt-4 text-white/45">keccak256(account, market, kind, size, trigger, salt) · x25519 + AES-256-GCM to the keeper and you · revealed only on fill</p>
    </div>
  );
}
