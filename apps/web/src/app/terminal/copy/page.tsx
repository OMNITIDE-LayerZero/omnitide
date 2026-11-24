"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { encodeAbiParameters, pad, type Address } from "viem";
import { ExternalLink, Users } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { HUB, HUB_KEY, SHORT, explorerTx } from "@/lib/chains";
import { CLEARINGHOUSE, COPY_FACTORY, MARKETS, V3_CHAINS, omnitideClearinghouseAbi, omnitideCopyVaultAbi, omnitideCopyVaultFactoryAbi, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { fetchReports, feedsFor } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { ago, money, moneyCompact, price as fmtPrice, shortHash, signedMoney, realized, units6, upnl, wad, who } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { amountUnits, sendParam } from "@/components/terminal/collateral";
import { Connect } from "@/components/connect";

interface VaultRow {
  address: Address;
  leader: Address;
  name: string;
  seed: string;
  deposited: string;
  redeemed: string;
  deposits: number;
  leaderTrades: number;
  createdAt: number;
}
interface VaultDetail {
  vault: VaultRow;
  flows: { id: string; account: string; kind: string; assets: string; shares: string | null; eid: number | null; timestamp: number; tx: string }[];
  trades: { id: string; marketId: number; sizeDelta: string; price: string; realizedPnl: string; timestamp: number; tx: string }[];
  pending: { account: string; assets: string }[];
}

const DEFAULT_FEE = 10; // % of gains above the high-water mark
const MAX_FEE = 20;
const toWad = (v: number) => BigInt(Math.round(v * 1e8)) * 10n ** 10n;
const baseToWad = (v: number) => BigInt(Math.round(v * 1e12)) * 10n ** 6n;

/** NAV straight from the clearinghouse book the vault trades: collateral plus live uPnL. */
function useVaultState(vault: Address | undefined) {
  const { address } = useAccount();
  const config = useConfig();
  return useQuery({
    queryKey: ["vault-state", vault, address],
    enabled: !!vault,
    refetchInterval: 6_000,
    queryFn: async () => {
      const hub = getPublicClient(config, { chainId: HUB.chainId })!;
      const ch = <T,>(functionName: string, args: unknown[]) => hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const [bal, open, supply, mine, feeBps, hwm] = await Promise.all([
        ch<bigint>("balances", [vault]),
        ch<readonly number[]>("openMarkets", [vault]),
        hub.readContract({ address: vault!, abi: omnitideCopyVaultAbi, functionName: "totalSupply" }),
        address ? hub.readContract({ address: vault!, abi: omnitideCopyVaultAbi, functionName: "balanceOf", args: [address] }) : Promise.resolve(0n),
        hub.readContract({ address: vault!, abi: omnitideCopyVaultAbi, functionName: "feeBps" }),
        hub.readContract({ address: vault!, abi: omnitideCopyVaultAbi, functionName: "highWaterMark" }),
      ]);
      const positions = await Promise.all(
        open.map(async (id) => {
          const [size, entry] = await ch<readonly [bigint, bigint]>("positions", [vault, id]);
          return { marketId: Number(id), size: Number(size) / 1e18, entry: Number(entry) / 1e18 };
        }),
      );
      return { collateral: Number(bal) / 1e6, positions: positions.filter((p) => p.size !== 0), supply, mine, feeBps: Number(feeBps), hwm: Number(hwm) / 1e18 };
    },
  });
}

function CreateVault() {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();
  const { data: minSeed } = useQuery({
    queryKey: ["copy-min-seed"],
    staleTime: Infinity,
    queryFn: async () => units6(await getPublicClient(config, { chainId: HUB.chainId })!.readContract({ address: COPY_FACTORY, abi: omnitideCopyVaultFactoryAbi, functionName: "minSeed" })),
  });
  const [name, setName] = useState("");
  const [seed, setSeed] = useState("");
  const [fee, setFee] = useState(String(DEFAULT_FEE));
  const amount = amountUnits(seed || String(minSeed ?? ""));
  const feePct = Number(fee);
  const feeOk = fee !== "" && feePct >= 0 && feePct <= MAX_FEE;
  if (!address) return null;

  async function go() {
    await send(`Approve ${units6(amount)} tdUSD seed`, { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [COPY_FACTORY, amount] });
    const symbol = `c${name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase() || "TIDE"}`;
    await send(`Launch ${name}`, { chainId: HUB.chainId, address: COPY_FACTORY, abi: omnitideCopyVaultFactoryAbi, functionName: "createVault", args: [name.trim(), symbol, Math.round(feePct * 100), amount, []] });
    setName("");
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Lead a vault</p>
      <p className="mt-1 text-[12px] leading-[18px] text-ink-3">
        Seed it with {minSeed ? `at least ${minSeed.toLocaleString("en-US")}` : "your own"} tdUSD. Followers buy shares at live NAV; only you can trade the book, and you earn your fee only on new highs.
      </p>
      <input className="field mt-3" placeholder="Vault name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="relative mt-2">
        <input className="field pr-16" inputMode="decimal" placeholder={minSeed ? String(minSeed) : "Seed"} value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Seed in tdUSD" />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">tdUSD</span>
      </div>
      <div className="relative mt-2">
        <input className="field pr-40" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Leader fee in percent" />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">% fee on new highs</span>
      </div>
      {!feeOk && <p className="mt-1 text-[12px] text-warn">Pick a fee from 0 to {MAX_FEE}%. It can only go down after launch.</p>}
      <button type="button" className="btn btn-primary mt-3 w-full" disabled={busy || name.trim().length < 3 || !minSeed || units6(amount) < minSeed || !feeOk} onClick={() => void go().catch(() => {})}>
        Launch vault
      </button>
    </section>
  );
}

function Follow({ v, nav, supply, mine }: { v: VaultRow; nav: number; supply: bigint; mine: bigint }) {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();
  const [mode, setMode] = useState<"deposit" | "redeem">("deposit");
  const [chain, setChain] = useState<ChainKey>(HUB_KEY);
  const [value, setValue] = useState("");
  const amount = amountUnits(value);
  const sharePrice = supply > 0n ? nav / units6(supply) : 1;
  const chainId = CHAINS[chain].chainId;

  async function go() {
    const hub = getPublicClient(config, { chainId: HUB.chainId })!;
    const open = (await hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "openMarkets", args: [v.address] })) as readonly number[];
    if (mode === "deposit" && chain === HUB_KEY) {
      const reports = await fetchReports(feedsFor(open.map((id) => ({ marketId: Number(id) }))));
      await send(`Approve ${value} tdUSD`, { chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [v.address, amount] });
      await send(`Follow ${v.name}`, { chainId, address: v.address, abi: omnitideCopyVaultAbi, functionName: "deposit", args: [amount, address!, reports] });
    } else if (mode === "deposit") {
      // omnichain deposit: lzCompose queues it in the vault, the keeper prices it at the next NAV
      const p = { dstEid: HUB.eid, to: pad(v.address, { size: 32 }), amountLD: amount, minAmountLD: amount, extraOptions: "0x" as const, composeMsg: encodeAbiParameters([{ type: "address" }], [address!]), oftCmd: "0x" as const };
      const src = getPublicClient(config, { chainId })!;
      const q = await src.readContract({ address: usdAddress(chain), abi: omnitideUSDAbi, functionName: "quoteSend", args: [p, false] });
      await send(`Follow ${v.name} from ${SHORT[chain]}`, { chainId, address: usdAddress(chain), abi: omnitideUSDAbi, functionName: "send", args: [p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, address!], value: q.nativeFee });
    } else {
      const reports = await fetchReports(feedsFor(open.map((id) => ({ marketId: Number(id) }))));
      const assets = BigInt(Math.floor(Number(amount) * sharePrice));
      const fee = chain === HUB_KEY ? 0n : (await hub.readContract({ address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "quoteSend", args: [sendParam(chain, address!, assets, null), false] })).nativeFee;
      await send(`Redeem to ${SHORT[chain]}`, { chainId: HUB.chainId, address: v.address, abi: omnitideCopyVaultAbi, functionName: "redeem", args: [amount, CHAINS[chain].eid, address!, reports], value: (fee * 12n) / 10n });
    }
    setValue("");
  }

  if (!address) return <Connect size="md" />;
  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="tablist" aria-label="Follow">
        {(["deposit", "redeem"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`btn btn-sm capitalize ${mode === m ? "bg-raised text-ink" : "btn-ghost"}`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Chain">
        {V3_CHAINS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={chain === k} onClick={() => setChain(k)} className={`btn btn-sm ${chain === k ? "bg-raised text-ink" : "btn-ghost"}`}>
            {mode === "deposit" ? "from " : "to "}
            {SHORT[k]}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>{mode === "deposit" ? "tdUSD in" : "Shares to redeem"}</span>
          {mode === "redeem" && mine > 0n && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(units6(mine)))}>
              {units6(mine).toLocaleString("en-US", { maximumFractionDigits: 4 })} shares
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      {amount > 0n && <p className="num text-[13px] text-ink-2">≈ {mode === "deposit" ? `${(Number(value) / sharePrice).toLocaleString("en-US", { maximumFractionDigits: 4 })} shares` : money(Number(value) * sharePrice)} at {sharePrice.toFixed(6)} per share</p>}
      {mode === "deposit" && chain !== HUB_KEY && <p className="text-[12px] leading-[18px] text-ink-3">Rides LayerZero to the vault on {SHORT[HUB_KEY]}, waits in the queue, and the keeper mints your shares at the next live NAV.</p>}
      <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || (mode === "redeem" && amount > mine)} onClick={() => void go().catch(() => {})}>
        {mode === "deposit" ? `Follow ${v.name}` : `Redeem to ${SHORT[chain]}`}
      </button>
    </div>
  );
}

function LeaderDesk({ v }: { v: VaultRow }) {
  const prices = usePriceMap();
  const config = useConfig();
  const { send, busy } = useTx();
  const [marketId, setMarketId] = useState(0);
  const [usd, setUsd] = useState("");
  const m = MARKETS[marketId]!;
  const mark = prices[m.feed];

  async function go(side: 1 | -1) {
    const hub = getPublicClient(config, { chainId: HUB.chainId })!;
    const open = (await hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "openMarkets", args: [v.address] })) as readonly number[];
    const reports = await fetchReports(feedsFor(open.map((id) => ({ marketId: Number(id) })), m.feed));
    await send(`${v.name}: ${side > 0 ? "long" : "short"} ${m.symbol}`, { chainId: HUB.chainId, address: v.address, abi: omnitideCopyVaultAbi, functionName: "trade", args: [m.id, BigInt(side) * baseToWad(Number(usd) / mark!), toWad(mark! * (1 + side * 0.01)), reports] });
    setUsd("");
  }

  return (
    <section className="rounded-2xl border border-accent bg-card p-4">
      <p className="font-medium">Leader desk</p>
      <p className="mt-1 text-[12px] text-ink-3">You lead {v.name}. Every follower rides these fills pro rata.</p>
      <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
        <select className="field" value={marketId} onChange={(e) => setMarketId(Number(e.target.value))} aria-label="Market">
          {MARKETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.symbol}-PERP
            </option>
          ))}
        </select>
        <input className="field" inputMode="decimal" placeholder="USD" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Size in USD" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([1, -1] as const).map((s) => (
          <button key={s} type="button" disabled={busy || !mark || !(Number(usd) > 0)} onClick={() => void go(s).catch(() => {})} className={`btn btn-sm text-white ${s > 0 ? "bg-flood hover:bg-flood/90" : "bg-ebb hover:bg-ebb/90"}`}>
            {s > 0 ? "Long" : "Short"} {m.symbol}
          </button>
        ))}
      </div>
    </section>
  );
}

function VaultView({ v }: { v: VaultRow }) {
  const { address } = useAccount();
  const prices = usePriceMap();
  const { data: s } = useVaultState(v.address);
  const { data: detail } = useQuery({ queryKey: ["vault", v.address], refetchInterval: 8_000, queryFn: async () => (await (await fetch(`/api/indexer/vaults/${v.address}`)).json()) as VaultDetail });
  const h = s ? accountHealth(s.collateral, s.positions, prices) : null;
  const nav = h?.equity ?? 0;
  const sharePrice = s && s.supply > 0n ? nav / units6(s.supply) : 1;
  const leader = address?.toLowerCase() === v.leader.toLowerCase();

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">
            Copy vault · led by {who(v.leader)} · opened {ago(v.createdAt)}
          </p>
          <h2 className="display mt-2 text-[40px] text-ink">{v.name}</h2>
          <dl className="mt-5 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
            {[
              ["NAV", h ? money(nav) : "…"],
              ["Share price", `${sharePrice.toFixed(6)}`],
              ["Since seed", h ? `${sharePrice >= 1 ? "+" : "−"}${Math.abs((sharePrice - 1) * 100).toFixed(2)}%` : "…"],
              ["Leader fee", s ? (s.feeBps > 0 ? `${s.feeBps / 100}% above ${s.hwm.toFixed(4)}` : "Fee-free") : "…"],
              ...(s && s.mine > 0n ? [["Your stake", money(units6(s.mine) * sharePrice)]] : []),
            ].map(([k, val]) => (
              <div key={k} className="min-w-[130px] flex-1 bg-card p-4">
                <dt className="text-[13px] text-ink-3">{k}</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{val}</dd>
              </div>
            ))}
          </dl>
          {s && s.positions.length > 0 && (
            <ul className="mt-4 space-y-1 text-[13px]">
              {s.positions.map((p) => {
                const mk = MARKETS[p.marketId]!;
                const px = prices[mk.feed];
                return (
                  <li key={p.marketId} className="num flex justify-between">
                    <span>
                      {mk.symbol}-PERP <span className={p.size > 0 ? "text-flood" : "text-ebb"}>{p.size > 0 ? "long" : "short"}</span> {money(Math.abs(p.size) * (px ?? p.entry))}
                    </span>
                    <span className={px && p.size * (px - p.entry) >= 0 ? "text-flood" : "text-ebb"}>{px ? upnl(p.size * (px - p.entry)) : ""}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card">
          <h3 className="px-5 pt-5 text-[18px] font-medium">Leader fills</h3>
          {detail && detail.trades.length > 0 ? (
            <ol className="mt-3">
              {detail.trades.slice(0, 15).map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line px-5 py-3 text-[13px]">
                  <span className="font-medium">
                    {MARKETS[t.marketId]?.symbol} <span className={BigInt(t.sizeDelta) > 0n ? "text-flood" : "text-ebb"}>{BigInt(t.sizeDelta) > 0n ? "buy" : "sell"}</span>
                  </span>
                  <span className="num text-ink-2">
                    {fmtPrice(wad(t.price))} · {realized(units6(t.realizedPnl))}
                  </span>
                  <a href={explorerTx(HUB_KEY, t.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-3 hover:text-ink">
                    {ago(t.timestamp)} <ExternalLink size={12} strokeWidth={1.5} />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-6 text-[14px] text-ink-2">The leader hasn't moved yet. The first fill shows here the block it lands.</p>
          )}
        </div>
      </section>
      <aside className="flex flex-col gap-3">
        <section className="rounded-2xl border border-line bg-card p-4">
          <p className="mb-3 font-medium">Follow {v.name}</p>
          <Follow v={v} nav={nav} supply={s?.supply ?? 0n} mine={s?.mine ?? 0n} />
          {detail && detail.pending.length > 0 && <p className="mt-3 text-[12px] text-ink-3">{detail.pending.length} omnichain deposit{detail.pending.length > 1 ? "s" : ""} queued for the next NAV</p>}
        </section>
        {leader && <LeaderDesk v={v} />}
      </aside>
    </div>
  );
}

export default function Copy() {
  const { data: vaults, isLoading } = useQuery({ queryKey: ["vaults"], refetchInterval: 15_000, queryFn: async () => (await (await fetch("/api/indexer/vaults")).json()) as VaultRow[] });
  const [pick, setPick] = useState<Address | null>(null);
  const selected = vaults?.find((v) => v.address === pick) ?? vaults?.[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">BeaconProxy vaults · omnichain deposits via lzCompose · NAV from the live book</p>
          <h1 className="display mt-2 text-[44px] text-ink">Copy</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            Back a trader instead of a screenshot. Each vault is its own account on the clearinghouse: the leader trades it, followers hold ERC-20 shares priced at live NAV, and deposits can arrive from {V3_CHAINS.filter((k) => k !== HUB_KEY).map((k) => SHORT[k]).join(" or ")} in one transaction.
          </p>
          {vaults && vaults.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {vaults.map((v) => (
                <button key={v.address} type="button" onClick={() => setPick(v.address)} className={`btn btn-sm ${selected?.address === v.address ? "bg-navy text-white" : "btn-secondary"}`}>
                  <Users size={14} strokeWidth={1.75} /> {v.name}
                  <span className="num text-[12px] opacity-70">{moneyCompact(units6(v.deposited) - units6(v.redeemed))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <CreateVault />
      </div>
      {isLoading ? <div className="h-64 animate-pulse rounded-2xl bg-raised" /> : selected ? <VaultView key={selected.address} v={selected} /> : <div className="rounded-2xl border border-line bg-card p-5 text-[14px] leading-[22px] text-ink-2">No vault has opened yet. Seed the first one and your fills become something people can follow.</div>}
    </div>
  );
}
