"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { encodeAbiParameters, erc20Abi, formatEther, pad, parseUnits, type Address } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { CHAIN_COUNT, CHAIN_KEYS, HUB, HUB_KEY, IS_MAINNET, LANES, SHORT, chainKeyOf, inflowRoute } from "@/lib/chains";
import { CLEARINGHOUSE, CH_ABI, omnitidePortAbi, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { fetchReports, feedsFor, useHubAccount, useLocalToken } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { money } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { Connect } from "../connect";

type Tab = "inflow" | "ebb" | "faucet" | "port";

export function sendParam(dst: ChainKey, to: Address, amount: bigint, compose: Address | null) {
  return {
    dstEid: CHAINS[dst].eid,
    to: pad(to, { size: 32 }),
    amountLD: amount,
    minAmountLD: amount,
    extraOptions: "0x" as const,
    composeMsg: compose ? encodeAbiParameters([{ type: "address" }], [compose]) : ("0x" as const),
    oftCmd: "0x" as const,
  };
}

/** LayerZero fee for an OFT send from `from`, read live from the token contract. */
export function useQuote(from: ChainKey | undefined, dst: ChainKey | undefined, to: Address | undefined, amount: bigint, compose: Address | null) {
  const client = usePublicClient({ chainId: from ? CHAINS[from].chainId : undefined });
  return useQuery({
    queryKey: ["quote", from, dst, to, amount.toString(), compose],
    enabled: !!client && !!from && !!dst && !!to && amount > 0n && from !== dst,
    staleTime: 15_000,
    queryFn: async () => {
      const q = await client!.readContract({ address: usdAddress(from!), abi: omnitideUSDAbi, functionName: "quoteSend", args: [sendParam(dst!, to!, amount, compose), false] });
      return q.nativeFee;
    },
  });
}

export const amountUnits = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? parseUnits(n.toFixed(6), 6) : 0n;
};

function Inflow() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const from = chainKeyOf(chainId);
  const { data: local } = useLocalToken(chainId);
  const { send, busy } = useTx();
  const [value, setValue] = useState("");
  const [useStable, setUseStable] = useState(true);
  const amount = amountUnits(value);
  // mainnet: pay in this chain's stablecoin and the Port mints tdUSD 1:1 on the way in
  const port = local?.port;
  const viaPort = !!port && useStable;
  const route = from ? inflowRoute(from) : [];
  const nextHop = route[0];
  const direct = nextHop === HUB_KEY;
  const { data: fee } = useQuote(from, nextHop, direct ? CLEARINGHOUSE : address, amount, direct ? (address ?? null) : null);

  if (!from)
    return (
      <div className="flex flex-wrap gap-2">
        {CHAIN_KEYS.map((k) => (
          <button key={k} type="button" className="btn btn-secondary btn-sm" onClick={() => void switchChainAsync({ chainId: CHAINS[k].chainId })}>
            {SHORT[k]}
          </button>
        ))}
      </div>
    );

  async function go() {
    if (!from || !address) return;
    const chainId = CHAINS[from].chainId;
    if (viaPort && (local?.stableAllowance ?? 0n) < amount)
      await send(`Approve ${port!.symbol}`, { chainId, address: port!.stable, abi: erc20Abi, functionName: "approve", args: [port!.port, amount] });
    if (viaPort && from === HUB_KEY) {
      await send(`Mint ${value} tdUSD from ${port!.symbol}`, { chainId, address: port!.port, abi: omnitidePortAbi, functionName: "deposit", args: [amount, address] });
      await send("Approve tdUSD", { chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [CLEARINGHOUSE, amount] });
      await send(`Deposit ${value} tdUSD`, { chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "deposit", args: [amount] });
    } else if (viaPort && direct) {
      if (fee === undefined) return;
      await send(`Inflow ${value} ${port!.symbol} from ${SHORT[from]}`, {
        chainId,
        address: port!.port,
        abi: omnitidePortAbi,
        functionName: "depositAndSend",
        args: [amount, sendParam(HUB_KEY, CLEARINGHOUSE, amount, address)],
        value: fee,
      });
    } else if (from === HUB_KEY) {
      await send("Approve tdUSD", { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [CLEARINGHOUSE, amount] });
      await send(`Deposit ${value} tdUSD`, { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "deposit", args: [amount] });
    } else {
      if (fee === undefined || !nextHop) return;
      const param = sendParam(nextHop, direct ? CLEARINGHOUSE : address, amount, direct ? address : null);
      await send(direct ? `Inflow ${value} tdUSD from ${SHORT[from]}` : `Ferry ${value} tdUSD to ${SHORT[nextHop]}`, {
        chainId: CHAINS[from].chainId,
        address: usdAddress(from),
        abi: omnitideUSDAbi,
        functionName: "send",
        args: [param, { nativeFee: fee, lzTokenFee: 0n }, address],
        value: fee,
      });
    }
    setValue("");
  }

  const max = (viaPort ? local?.stable : local?.balance) ?? 0;
  const maxRaw = (viaPort ? local?.stableRaw : local?.balanceRaw) ?? 0n;
  const unit = viaPort ? port!.symbol : "tdUSD";
  return (
    <div className="space-y-4">
      {port && (
        <div className="flex gap-1" role="radiogroup" aria-label="Pay with">
          {([[true, port.symbol], [false, "tdUSD"]] as const).map(([v, label]) => (
            <button key={label} type="button" role="radio" aria-checked={useStable === v} onClick={() => setUseStable(v)} className={`btn btn-sm ${useStable === v ? "bg-raised text-ink" : "btn-ghost"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-ink-3">Route</span>
        {[from, ...route].map((k, i) => (
          <span key={`${k}${i}`} className="flex items-center gap-2">
            {i > 0 && <span className="text-ink-3">→</span>}
            <span className={`rounded-md px-2 py-1 ${k === HUB_KEY ? "bg-accent text-on-accent" : "bg-raised"}`}>{SHORT[k]}</span>
          </span>
        ))}
      </div>
      <label className="block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>Amount</span>
          {max > 0 && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(max))}>
              {max.toLocaleString("en-US")} {unit} on {SHORT[from]}
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      {from !== HUB_KEY && fee !== undefined && (
        <p className="num text-[13px] text-ink-2">
          LayerZero fee {Number(formatEther(fee)).toPrecision(3)} {CHAINS[from].nativeSymbol}
        </p>
      )}
      {!direct && from !== HUB_KEY && (
        <p className="text-[13px] leading-5 text-ink-2">
          LayerZero has no {SHORT[from]} → Robinhood Chain lane yet, so this goes in two hops. First it ferries to {SHORT[nextHop!]}; once it lands (about two minutes), switch there and send it into the book.
        </p>
      )}
      {viaPort && <p className="text-[13px] leading-5 text-ink-2">Your {port!.symbol} becomes tdUSD margin 1:1 through the OMNITIDE Port on {SHORT[from]}. Redeem it back from the Port tab anytime.</p>}
      <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || amount > maxRaw || (from !== HUB_KEY && fee === undefined)} onClick={() => void go().catch(() => {})}>
        {from === HUB_KEY ? "Deposit to margin" : direct ? "Send into the book" : `Ferry to ${SHORT[nextHop!]}`}
      </button>
    </div>
  );
}

function Ebb() {
  const { address } = useAccount();
  const { data: acct } = useHubAccount();
  const prices = usePriceMap();
  const { send, busy } = useTx();
  const [dst, setDst] = useState<ChainKey>(HUB_KEY);
  const [value, setValue] = useState("");
  const amount = amountUnits(value);
  const { data: fee } = useQuote(dst === HUB_KEY ? undefined : HUB_KEY, dst, address, amount, null);
  const h = accountHealth(acct?.collateral ?? 0, acct?.positions ?? [], prices);
  const withdrawable = Math.max(0, Math.min(acct?.collateral ?? 0, acct?.positions.length ? h.free : (acct?.collateral ?? 0)));
  const destinations: ChainKey[] = [HUB_KEY, ...LANES[HUB_KEY]];

  async function go() {
    if (!address) return;
    const reports = await fetchReports(feedsFor(acct?.positions ?? []));
    await send(`Ebb ${value} tdUSD to ${SHORT[dst]}`, {
      chainId: HUB.chainId,
      address: CLEARINGHOUSE,
      abi: CH_ABI,
      functionName: "withdraw",
      args: [amount, CHAINS[dst].eid, address, reports],
      value: dst === HUB_KEY ? 0n : (fee ?? 0n),
    });
    setValue("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Destination">
        {destinations.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={dst === k} onClick={() => setDst(k)} className={`btn btn-sm ${dst === k ? "bg-raised text-ink" : "btn-ghost"}`}>
            {SHORT[k]}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>Amount</span>
          {withdrawable > 0 && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(withdrawable.toFixed(2))}>
              {money(withdrawable)} free
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      {dst !== HUB_KEY && fee !== undefined && <p className="num text-[13px] text-ink-2">LayerZero fee {Number(formatEther(fee)).toPrecision(3)} ETH on Robinhood Chain</p>}
      <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || Number(value) > withdrawable + 1e-6 || (dst !== HUB_KEY && fee === undefined)} onClick={() => void go().catch(() => {})}>
        {dst === HUB_KEY ? "Withdraw to wallet" : `Ebb to ${SHORT[dst]}`}
      </button>
      {IS_MAINNET && <p className="text-[13px] leading-5 text-ink-2">Lands as tdUSD in your wallet. Turn it back into {CHAINS[dst].stable?.symbol ?? "stablecoin"} 1:1 from the Port tab on {SHORT[dst]}.</p>}
    </div>
  );
}

function Faucet() {
  const { chainId } = useAccount();
  const key = chainKeyOf(chainId);
  const { data } = useLocalToken(chainId);
  const { send, busy } = useTx();
  const waiting = data && data.nextDrip * 1000 > Date.now();
  if (!key) return <p className="text-[14px] text-ink-2">Switch to one of the three OMNITIDE chains to collect test tdUSD.</p>;
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-[22px] text-ink-2">
        Every address can collect 1,000 test tdUSD per day on each of the {CHAIN_COUNT} chains. Collect on {SHORT[key]}, then Inflow it into the book.
      </p>
      <button type="button" className="btn btn-primary w-full" disabled={busy || !!waiting} onClick={() => void send(`Collect 1,000 tdUSD on ${SHORT[key]}`, { chainId: CHAINS[key].chainId, address: usdAddress(key), abi: omnitideUSDAbi, functionName: "drip" }).catch(() => {})}>
        {waiting ? `Refills ${new Date(data!.nextDrip * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Collect 1,000 tdUSD"}
      </button>
    </div>
  );
}

function Port() {
  const { address, chainId } = useAccount();
  const key = chainKeyOf(chainId);
  const { data } = useLocalToken(chainId);
  const { send, busy } = useTx();
  const [value, setValue] = useState("");
  const amount = amountUnits(value);
  const port = data?.port;
  if (!key || !port) return <p className="text-[14px] text-ink-2">Switch to one of the {CHAIN_COUNT} OMNITIDE chains to use its Port.</p>;
  const max = Math.min(data.balance, data.reserve);
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-[22px] text-ink-2">
        Every tdUSD is backed 1:1 by {port.symbol} held in the Port on {SHORT[key]}. Ebb to this chain, then redeem here.
      </p>
      <dl className="grid grid-cols-2 gap-3 text-[13px]">
        <div><dt className="text-ink-3">tdUSD in wallet</dt><dd className="num mt-1 text-ink">{money(data.balance)}</dd></div>
        <div><dt className="text-ink-3">{port.symbol} reserve here</dt><dd className="num mt-1 text-ink">{money(data.reserve)}</dd></div>
      </dl>
      <label className="block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>Redeem</span>
          {max > 0 && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(max))}>
              {max.toLocaleString("en-US")} tdUSD
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || amount > data.balanceRaw || amount > data.reserveRaw} onClick={() => void send(`Redeem ${value} tdUSD for ${port.symbol}`, { chainId: CHAINS[key].chainId, address: port.port, abi: omnitidePortAbi, functionName: "redeem", args: [amount, address!] }).then(() => setValue("")).catch(() => {})}>
        Redeem for {port.symbol}
      </button>
    </div>
  );
}

export function CollateralPanel() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("inflow");
  return (
    <div id="inflow" className="scroll-mt-20 rounded-2xl border border-line bg-card">
      <div className="flex gap-1 border-b border-line px-2" role="tablist" aria-label="Collateral">
        {(
          [
            ["inflow", "Inflow"],
            ["ebb", "Ebb"],
            IS_MAINNET ? (["port", "Port"] as const) : (["faucet", "Faucet"] as const),
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative h-11 px-3 text-[14px] transition-colors ${tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            {label}
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>
      <div className="p-4">{!isConnected ? <Connect size="md" /> : tab === "inflow" ? <Inflow /> : tab === "ebb" ? <Ebb /> : tab === "port" ? <Port /> : <Faucet />}</div>
    </div>
  );
}
