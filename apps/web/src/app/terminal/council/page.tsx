"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { formatUnits, parseUnits, type Address } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { HUB_KEY, SHORT } from "@/lib/chains";
import { V3_CHAINS, omnitideCouncilAbi, omnitideTokenAbi, v3Address } from "@/lib/contracts";
import { ago, shortHash } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { Connect } from "@/components/connect";

interface Proposal {
  id: string;
  proposer: string;
  title: string;
  body: string;
  start: number;
  end: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  voters: number;
  mirroredTo: number[];
}
interface Vote {
  proposalId: string;
  support: number;
  weight: string;
  chainId: number;
  tallied: boolean;
}
interface CouncilData {
  proposals: Proposal[];
  votes: Vote[];
  staked: Record<string, string>;
  stakers: number;
}

const tide = (v: bigint | string) => Number(formatUnits(BigInt(v), 18));
const fmtTide = (v: bigint | string) => tide(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const SUPPORT = ["Against", "For", "Abstain"] as const;
const THRESHOLD = 1_000;

function useWallet() {
  const { address } = useAccount();
  const config = useConfig();
  return useQuery({
    queryKey: ["council-wallet", address],
    enabled: !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const rows = await Promise.all(
        V3_CHAINS.map(async (k) => {
          const c = getPublicClient(config, { chainId: CHAINS[k].chainId })!;
          const a = address as Address;
          const [balance, staked, stakedAt, lockedUntil, lastDrip] = await Promise.all([
            c.readContract({ address: v3Address(k, "OmnitideToken"), abi: omnitideTokenAbi, functionName: "balanceOf", args: [a] }),
            c.readContract({ address: v3Address(k, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "staked", args: [a] }),
            c.readContract({ address: v3Address(k, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "stakedAt", args: [a] }),
            c.readContract({ address: v3Address(k, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "lockedUntil", args: [a] }),
            c.readContract({ address: v3Address(k, "OmnitideToken"), abi: omnitideTokenAbi, functionName: "lastDrip", args: [a] }).catch(() => 0n),
          ]);
          return [k, { balance, staked, stakedAt: Number(stakedAt), lockedUntil: Number(lockedUntil), nextDrip: Number(lastDrip) + 86_400 }] as const;
        }),
      );
      return Object.fromEntries(rows) as Record<ChainKey, { balance: bigint; staked: bigint; stakedAt: number; lockedUntil: number; nextDrip: number }>;
    },
  });
}

function StakePanel({ chain }: { chain: ChainKey }) {
  const { address } = useAccount();
  const { data: w } = useWallet();
  const { send, busy } = useTx();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const here = w?.[chain];
  const amount = Number(value) > 0 ? parseUnits(value, 18) : 0n;
  const max = mode === "stake" ? (here?.balance ?? 0n) : (here?.staked ?? 0n);
  const locked = !!here && here.lockedUntil > Date.now() / 1000;
  const chainId = CHAINS[chain].chainId;
  const canDrip = !!here && here.nextDrip <= Date.now() / 1000;

  async function go() {
    if (mode === "stake") {
      await send(`Approve ${value} TIDE`, { chainId, address: v3Address(chain, "OmnitideToken"), abi: omnitideTokenAbi, functionName: "approve", args: [v3Address(chain, "OmnitideCouncil"), amount] });
      await send(`Stake ${value} TIDE on ${SHORT[chain]}`, { chainId, address: v3Address(chain, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "stake", args: [amount] });
    } else {
      await send(`Unstake ${value} TIDE`, { chainId, address: v3Address(chain, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "unstake", args: [amount] });
    }
    setValue("");
  }

  if (!address) return null;
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">TIDE on {SHORT[chain]}</p>
        <button type="button" className="text-[12px] text-accent hover:underline disabled:text-ink-3 disabled:no-underline" disabled={busy || !canDrip} onClick={() => void send("Drip 1,000 TIDE", { chainId, address: v3Address(chain, "OmnitideToken"), abi: omnitideTokenAbi, functionName: "drip" }).catch(() => {})}>
          {canDrip ? "Drip 1,000 TIDE" : `Next drip in ${Math.ceil((here!.nextDrip - Date.now() / 1000) / 3600)}h`}
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
        <div className="bg-card p-3">
          <dt className="text-ink-3">Wallet</dt>
          <dd className="num mt-0.5 text-[18px]">{here ? fmtTide(here.balance) : "…"}</dd>
        </div>
        <div className="bg-card p-3">
          <dt className="text-ink-3">Staked</dt>
          <dd className="num mt-0.5 text-[18px]">{here ? fmtTide(here.staked) : "…"}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-1" role="tablist" aria-label="Stake">
        {(["stake", "unstake"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`btn btn-sm capitalize ${mode === m ? "bg-raised text-ink" : "btn-ghost"}`}>
            {m}
          </button>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>TIDE</span>
          {max > 0n && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(formatUnits(max, 18))}>
              max {fmtTide(max)}
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      {mode === "unstake" && locked && <p className="mt-2 text-[12px] text-warn">Locked until {new Date(here!.lockedUntil * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}: you voted on a proposal still open.</p>}
      <button type="button" className="btn btn-primary mt-3 w-full" disabled={busy || amount === 0n || amount > max || (mode === "unstake" && locked)} onClick={() => void go().catch(() => {})}>
        {mode === "stake" ? `Stake on ${SHORT[chain]}` : "Unstake"}
      </button>
      <p className="mt-2 text-[12px] leading-[18px] text-ink-3">Stake counts on proposals opened after it lands. Voting locks it until that vote closes, so the same TIDE can't vote twice across chains.</p>
    </section>
  );
}

function Propose() {
  const { address } = useAccount();
  const config = useConfig();
  const { data: w } = useWallet();
  const { send, busy } = useTx();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const spokes = V3_CHAINS.filter((k) => k !== HUB_KEY);
  const stake = w ? tide(w[HUB_KEY].staked) : 0;
  if (!address) return null;

  async function go() {
    const hub = getPublicClient(config, { chainId: CHAINS[HUB_KEY].chainId })!;
    const eids = spokes.map((k) => CHAINS[k].eid);
    const fee = await hub.readContract({ address: v3Address(HUB_KEY, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "quotePropose", args: [eids] });
    await send("Open a Council proposal", { chainId: CHAINS[HUB_KEY].chainId, address: v3Address(HUB_KEY, "OmnitideCouncil"), abi: omnitideCouncilAbi, functionName: "propose", args: [title.trim(), body.trim(), eids], value: (fee * 11n) / 10n });
    setTitle("");
    setBody("");
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Open a proposal</p>
      <p className="mt-1 text-[12px] leading-[18px] text-ink-3">
        Needs {THRESHOLD.toLocaleString("en-US")} TIDE staked on {SHORT[HUB_KEY]} · you have {stake.toLocaleString("en-US", { maximumFractionDigits: 0 })}. Mirrored to {spokes.map((k) => SHORT[k]).join(", ")} over LayerZero.
      </p>
      <input className="field mt-3" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="field mt-2 h-24 resize-none py-2.5 leading-5" placeholder="What should change, and why" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="button" className="btn btn-primary mt-3 w-full" disabled={busy || stake < THRESHOLD || title.trim().length < 4} onClick={() => void go().catch(() => {})}>
        Propose from {SHORT[HUB_KEY]}
      </button>
    </section>
  );
}

function ProposalCard({ p, mine, chain }: { p: Proposal; mine?: Vote; chain: ChainKey }) {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();
  const now = Date.now() / 1000;
  const open = p.end > now;
  const totals = [BigInt(p.againstVotes), BigInt(p.forVotes), BigInt(p.abstainVotes)];
  const sum = totals.reduce((a, b) => a + b, 0n);
  const reachable = chain === HUB_KEY || p.mirroredTo.includes(CHAINS[chain].chainId);

  async function vote(support: number) {
    const c = getPublicClient(config, { chainId: CHAINS[chain].chainId })!;
    const council = v3Address(chain, "OmnitideCouncil");
    const fee = await c.readContract({ address: council, abi: omnitideCouncilAbi, functionName: "quoteVote", args: [BigInt(p.id), support, address as Address] });
    await send(`Vote ${SUPPORT[support]} from ${SHORT[chain]}`, { chainId: CHAINS[chain].chainId, address: council, abi: omnitideCouncilAbi, functionName: "castVote", args: [BigInt(p.id), support], value: (fee * 11n) / 10n });
  }

  return (
    <article className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="tag text-ink-3">
          TIP-{p.id} · by {shortHash(p.proposer)} · {open ? `closes ${new Date(p.end * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : `closed ${ago(p.end)}`}
        </p>
        <span className={`tag rounded-[4px] px-1.5 py-0.5 ${open ? "bg-accent text-on-accent" : "bg-raised text-ink-2"}`}>{open ? "voting" : totals[1]! > totals[0]! ? "passed" : "did not pass"}</span>
      </div>
      <h3 className="mt-2 text-[18px] font-medium">{p.title}</h3>
      {p.body && <p className="mt-1 text-[14px] leading-[22px] whitespace-pre-line text-ink-2">{p.body}</p>}
      <div className="mt-4 space-y-2">
        {[1, 0, 2].map((s) => {
          const share = sum > 0n ? Number((totals[s]! * 10_000n) / sum) / 100 : 0;
          return (
            <div key={s}>
              <div className="flex justify-between text-[13px]">
                <span>{SUPPORT[s]}</span>
                <span className="num text-ink-2">
                  {fmtTide(totals[s]!)} TIDE · {share.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
                <div className={`h-full rounded-full transition-[width] duration-700 ${s === 1 ? "bg-flood" : s === 0 ? "bg-ebb" : "bg-ink-3"}`} style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-ink-3">
        {p.voters} {p.voters === 1 ? "vote" : "votes"} tallied on {SHORT[HUB_KEY]} · open on {[HUB_KEY, ...V3_CHAINS.filter((k) => p.mirroredTo.includes(CHAINS[k].chainId))].map((k) => SHORT[k]).join(" + ")}
      </p>
      {address &&
        (mine ? (
          <p className="mt-3 text-[13px] text-ink-2">
            You voted {SUPPORT[mine.support]} with {fmtTide(mine.weight)} TIDE from {SHORT[V3_CHAINS.find((k) => CHAINS[k].chainId === mine.chainId) ?? HUB_KEY]}
            {!mine.tallied && " · crossing to the hub"}
          </p>
        ) : open && reachable ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[1, 0, 2].map((s) => (
              <button key={s} type="button" disabled={busy} className={`btn btn-sm ${s === 1 ? "bg-flood text-white hover:bg-flood/90" : s === 0 ? "bg-ebb text-white hover:bg-ebb/90" : "btn-secondary"}`} onClick={() => void vote(s).catch(() => {})}>
                {SUPPORT[s]}
              </button>
            ))}
          </div>
        ) : open ? (
          <p className="mt-3 text-[13px] text-ink-3">Still crossing to {SHORT[chain]}. Vote from {SHORT[HUB_KEY]} or give it a minute.</p>
        ) : null)}
    </article>
  );
}

export default function Council() {
  const { address } = useAccount();
  const [chain, setChain] = useState<ChainKey>(HUB_KEY);
  const { data } = useQuery({
    queryKey: ["council", address],
    refetchInterval: 10_000,
    queryFn: async () => (await (await fetch(`/api/indexer/council${address ? `?voter=${address.toLowerCase()}` : ""}`)).json()) as CouncilData,
  });
  const total = data ? Object.values(data.staked).reduce((a, v) => a + BigInt(v), 0n) : 0n;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">LayerZero OApp · stake and vote from any chain · tallied on {SHORT[HUB_KEY]}</p>
          <h1 className="display mt-2 text-[44px] text-ink">Council</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            TIDE holders steer the tide wherever their TIDE sits. Proposals open on {SHORT[HUB_KEY]} and mirror to every chain; votes cast on Arbitrum ride LayerZero back to the hub and land in the same tally. No bridging, no wrapping.
          </p>
          {data && total > 0n && (
            <dl className="mt-6 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
              <div className="min-w-[140px] flex-1 bg-card p-4">
                <dt className="text-[13px] text-ink-3">TIDE staked</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{fmtTide(total)}</dd>
              </div>
              {V3_CHAINS.filter((k) => data.staked[CHAINS[k].chainId]).map((k) => (
                <div key={k} className="min-w-[140px] flex-1 bg-card p-4">
                  <dt className="text-[13px] text-ink-3">on {SHORT[k]}</dt>
                  <dd className="num mt-1 text-[22px] leading-8 font-medium">{fmtTide(data.staked[CHAINS[k].chainId]!)}</dd>
                </div>
              ))}
              <div className="min-w-[140px] flex-1 bg-card p-4">
                <dt className="text-[13px] text-ink-3">Stakers</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{data.stakers}</dd>
              </div>
            </dl>
          )}
        </div>

        {data && data.proposals.length > 0 ? (
          data.proposals.map((p) => <ProposalCard key={p.id} p={p} chain={chain} mine={data.votes.find((v) => v.proposalId === p.id)} />)
        ) : (
          <div className="rounded-2xl border border-line bg-card p-5 text-[14px] leading-[22px] text-ink-2">The floor is open. Stake 1,000 TIDE on {SHORT[HUB_KEY]} and table the first proposal; it reaches every chain within a minute.</div>
        )}
      </section>

      <aside className="flex flex-col gap-3">
        {!address ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <p className="font-medium">Take a seat</p>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">Drip test TIDE once a day on any Council chain, stake it, and your voice counts on every proposal after.</p>
            <div className="mt-4">
              <Connect size="md" />
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-card p-2" role="radiogroup" aria-label="Act from chain">
              {V3_CHAINS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={chain === k} onClick={() => setChain(k)} className={`btn btn-sm flex-1 ${chain === k ? "bg-raised text-ink" : "btn-ghost"}`}>
                  {SHORT[k]}
                </button>
              ))}
            </div>
            <StakePanel chain={chain} />
            <Propose />
          </>
        )}
      </aside>
    </div>
  );
}
