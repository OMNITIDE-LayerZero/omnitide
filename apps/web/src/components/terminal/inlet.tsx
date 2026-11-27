"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi, parseUnits, type Address } from "viem";
import { Check, Copy, ExternalLink } from "lucide-react";
import { HUB, HUB_KEY, explorerAddress } from "@/lib/chains";
import { INLET, omnitideInletAbi } from "@/lib/contracts";
import { ORIGINS, ROUTE, stageOf, type Destination, type Origin } from "@/lib/intents";
import { shortHash } from "@/lib/format";
import { useTx, explain } from "@/lib/tx";
import { toast } from "@/components/toasts";
import { Connect } from "@/components/connect";

interface Quote {
  recipient: string;
  depositAddress?: string;
  amountInFormatted?: string;
  amountInUsd?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  timeEstimate?: number;
  deadline?: string;
  error?: string;
}
interface Intent extends Quote {
  origin: string;
  to: Destination;
  route: number;
  amount: string;
  at: number;
}
type TxRef = { hash: string; explorerUrl?: string };
interface Status {
  status?: string;
  swapDetails?: { originChainTxHashes?: TxRef[]; destinationChainTxHashes?: TxRef[]; amountOutFormatted?: string; refundedAmountFormatted?: string };
}

const KEY = "omnitide.inlet.intent";
const read = (): Intent | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const save = (i: Intent | null) => {
  try {
    if (i) localStorage.setItem(KEY, JSON.stringify(i));
    else localStorage.removeItem(KEY);
  } catch {}
};

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "NEAR Intents could not quote that");
  return json;
}

const usd = (v?: string) => (v ? `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "");
const landsAs: Record<string, string> = { margin: "Trading margin", repay: "Loan repayment", eth: "ETH collateral" };

/** Inlet: any coin on any chain, routed by NEAR Intents into this account's own deposit address on Robinhood Chain, then swept into margin, a loan or ETH collateral. */
export function Inlet({ initial = "margin" }: { initial?: "margin" | "repay" | "eth" }) {
  const { address } = useAccount();
  const [origin, setOrigin] = useState<Origin>(ORIGINS[0]!);
  const [dest, setDest] = useState<"margin" | "repay" | "eth">(initial);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setIntent(read()), []);

  const to: Destination = dest === "eth" ? "eth" : "usd";
  const route = dest === "repay" ? ROUTE.repay : ROUTE.margin;
  const wallet = !!origin.chainId;
  const refundTo = wallet ? address : refund.trim();
  const valid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;

  // the preview quote follows the inputs, half a second after typing stops
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(valid ? amount : ""), 500);
    return () => clearTimeout(t);
  }, [amount, valid]);
  const preview = useQuery({
    queryKey: ["intent-preview", origin.id, to, route, debounced, address],
    enabled: !!debounced,
    staleTime: 20_000,
    retry: false,
    queryFn: () => post<Quote>({ kind: "quote", dry: true, origin: origin.id, amount: debounced, account: address, route, to }),
  });

  async function open() {
    if (!address || !refundTo) return;
    setBusy(true);
    try {
      const q = await post<Quote>({ kind: "quote", dry: false, origin: origin.id, amount, account: address, route, to, refundTo });
      const next = { ...q, origin: origin.id, to, route, amount, at: Date.now() };
      save(next);
      setIntent(next);
    } catch (e) {
      toast.push({ kind: "error", title: "No route yet", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-medium text-ink">Inlet</h2>
        <span className="font-mono text-[11px] text-ink-3">NEAR Intents · any coin, any chain</span>
      </header>
      <div className="space-y-4 p-4">
        {address && intent ? (
          <Tracker intent={intent} account={address} onDone={() => (save(null), setIntent(null), setAmount(""))} />
        ) : (
          <>
            <fieldset>
              <legend className="text-[13px] text-ink-2">Pay with</legend>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {ORIGINS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={origin.id === o.id}
                    onClick={() => setOrigin(o)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${origin.id === o.id ? "border-accent bg-raised text-ink" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink"}`}
                  >
                    <span className="block text-[13px] font-medium">{o.symbol}</span>
                    <span className="block font-mono text-[10px] text-ink-3">{o.chain}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-[13px] text-ink-2">Lands as</legend>
              <div className="mt-1.5 flex gap-1 rounded-lg border border-line p-1 text-[13px]" role="radiogroup">
                {(["margin", "repay", "eth"] as const).map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={dest === d} onClick={() => setDest(d)} className={`flex-1 rounded-md py-1.5 transition-colors ${dest === d ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                    {d === "margin" ? "Margin" : d === "repay" ? "Repay loan" : "ETH collateral"}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-[13px] text-ink-2">{origin.symbol} on {origin.chain}</span>
              <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            {!wallet && (
              <label className="block">
                <span className="text-[13px] text-ink-2">Refund address on {origin.chain}</span>
                <input className="field mt-1 font-mono text-[13px]" placeholder={origin.refundHint} value={refund} onChange={(e) => setRefund(e.target.value)} />
              </label>
            )}
            {preview.data && (
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-[13px]">
                <div className="bg-card p-2.5">
                  <dt className="text-ink-3">You get</dt>
                  <dd className="num mt-0.5 text-ink">
                    {Number(preview.data.amountOutFormatted).toLocaleString("en-US", { maximumFractionDigits: to === "eth" ? 6 : 2 })} {to === "eth" ? "ETH" : "tdUSD"}
                  </dd>
                </div>
                <div className="bg-card p-2.5">
                  <dt className="text-ink-3">Route cost</dt>
                  <dd className="num mt-0.5 text-ink">{usd(String(Math.max(0.01, Number(preview.data.amountInUsd) - Number(preview.data.amountOutUsd))))}</dd>
                </div>
                <div className="bg-card p-2.5">
                  <dt className="text-ink-3">Lands in</dt>
                  <dd className="num mt-0.5 text-ink">~{preview.data.timeEstimate ?? 30} s</dd>
                </div>
                <div className="bg-card p-2.5">
                  <dt className="text-ink-3">Into</dt>
                  <dd className="mt-0.5 text-ink">{landsAs[dest]}</dd>
                </div>
              </dl>
            )}
            {preview.error && <p className="text-[13px] text-warn">{(preview.error as Error).message}</p>}
            <p className="text-[13px] leading-5 text-ink-2">
              Solvers on NEAR Intents swap it to {to === "eth" ? "ETH" : "USDG"} and deliver it to your own inlet address on Robinhood Chain. The keeper sweeps it in seconds later; if the route can&apos;t fill, it refunds on {origin.chain}.
            </p>
            {!address ? (
              <Connect size="md" />
            ) : (
              <button type="button" className="btn btn-primary w-full" disabled={busy || !valid || !refundTo || !preview.data} onClick={() => void open()}>
                {busy ? "Opening a route…" : "Get deposit address"}
              </button>
            )}
          </>
        )}
        <InletBox account={address} />
      </div>
    </section>
  );
}

function useSendNative() {
  const config = useConfig();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  return async (label: string, target: number, to: Address, value: bigint) => {
    const id = toast.push({ kind: "pending", title: label, body: "Confirm in your wallet" });
    try {
      if (chainId !== target) await switchChainAsync({ chainId: target });
      const hash = await sendTransactionAsync({ chainId: target, to, value });
      toast.update(id, { body: "Waiting for the block" });
      await waitForTransactionReceipt(config, { hash, chainId: target });
      toast.update(id, { kind: "success", body: "Sent, NEAR Intents takes it from here" });
      return hash;
    } catch (e) {
      toast.update(id, { kind: "error", body: explain(e) });
      throw e;
    }
  };
}

function Tracker({ intent, account, onDone }: { intent: Intent; account: Address; onDone: () => void }) {
  const origin = ORIGINS.find((o) => o.id === intent.origin)!;
  const { send } = useTx();
  const sendNative = useSendNative();
  const [sent, setSent] = useState(false);
  const status = useQuery({
    queryKey: ["intent-status", intent.depositAddress],
    enabled: !!intent.depositAddress,
    refetchInterval: (q) => (["landed", "refunded", "failed"].includes(stageOf((q.state.data as Status | undefined)?.status)) ? false : 5_000),
    queryFn: async (): Promise<Status> => (await fetch(`/api/intents?status=${intent.depositAddress}`)).json(),
  });
  const stage = stageOf(status.data?.status);
  const pending = usePending(account, intent.to === "eth" ? ROUTE.margin : intent.route, stage === "landed");
  const swept = stage === "landed" && pending.data !== undefined && pending.data[0] === 0n && pending.data[1] === 0n;
  const d = status.data?.swapDetails;

  async function pay() {
    const value = parseUnits(intent.amount, origin.decimals);
    const target = intent.depositAddress as Address;
    const label = `Send ${intent.amount} ${origin.symbol} on ${origin.chain}`;
    const hash = origin.token
      ? await send(label, { chainId: origin.chainId!, address: origin.token, abi: erc20Abi, functionName: "transfer", args: [target, value] })
      : await sendNative(label, origin.chainId!, target, value);
    setSent(true);
    if (hash) void fetch("/api/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "submit", txHash: hash, depositAddress: target }) });
  }

  const steps = [
    { label: `Deposit on ${origin.chain}`, done: stage !== "waiting", refs: d?.originChainTxHashes },
    { label: "Swapped by NEAR solvers", done: stage === "landed" || stage === "refunded" },
    { label: "Landed on Robinhood Chain", done: stage === "landed", refs: d?.destinationChainTxHashes },
    { label: `In your ${intent.to === "eth" ? "ETH collateral" : intent.route === ROUTE.repay ? "loan repayment" : "margin"}`, done: swept },
  ];
  const deadline = intent.deadline ? new Date(intent.deadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line p-3">
        <p className="text-[13px] text-ink-2">
          Send exactly <span className="num text-ink">{intent.amount} {origin.symbol}</span> on {origin.chain}{deadline && ` before ${deadline}`}
        </p>
        <CopyLine text={intent.depositAddress ?? ""} />
        {origin.chainId && stage === "waiting" && (
          <button type="button" className="btn btn-primary mt-3 w-full" disabled={sent} onClick={() => void pay().catch(() => {})}>
            {sent ? "Sent, watching for it" : `Send from wallet on ${origin.chain}`}
          </button>
        )}
      </div>
      <ol className="space-y-2.5" aria-label="Route progress">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-start gap-2.5 text-[13px]">
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] transition-colors ${s.done ? "border-accent bg-accent text-white" : steps[i - 1]?.done !== false ? "animate-pulse border-accent text-accent" : "border-line text-ink-3"}`}>
              {s.done ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            <span className="flex-1">
              <span className={s.done ? "text-ink" : "text-ink-2"}>{s.label}</span>
              {s.refs?.map((r) => (
                <a key={r.hash} href={r.explorerUrl ?? "#"} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 hover:text-accent">
                  {shortHash(r.hash)} <ExternalLink className="size-3" aria-hidden />
                </a>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {stage === "refunded" && <p className="text-[13px] text-ink-2">The route couldn&apos;t fill, so {d?.refundedAmountFormatted ?? "your deposit"} {origin.symbol} went back to your refund address on {origin.chain}.</p>}
      {stage === "failed" && <p className="text-[13px] text-warn">NEAR Intents flagged this route. Your inlet still holds anything that arrived and you can take it back below.</p>}
      {(swept || stage === "refunded" || stage === "failed") && (
        <button type="button" className="btn w-full" onClick={onDone}>
          Route another
        </button>
      )}
      {!swept && stage === "waiting" && (
        <button type="button" className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline" onClick={onDone}>
          Start over
        </button>
      )}
    </div>
  );
}

function usePending(account: Address | undefined, route: number, fast = false) {
  const client = usePublicClient({ chainId: HUB.chainId });
  return useQuery({
    queryKey: ["inlet-pending", account, route],
    enabled: !!client && !!account && !!INLET,
    refetchInterval: fast ? 4_000 : 15_000,
    queryFn: () => client!.readContract({ address: INLET, abi: omnitideInletAbi, functionName: "pending", args: [account!, route] }),
  });
}

/** The account's own inlet on Robinhood Chain: what waits there, and a sweep anyone can trigger. */
function InletBox({ account }: { account: Address | undefined }) {
  const client = usePublicClient({ chainId: HUB.chainId });
  const qc = useQueryClient();
  const { send, busy } = useTx();
  const box = useQuery({
    queryKey: ["inlet-box", account],
    enabled: !!client && !!account,
    staleTime: Infinity,
    queryFn: () => client!.readContract({ address: INLET, abi: omnitideInletAbi, functionName: "inletOf", args: [account!, ROUTE.margin] }),
  });
  const margin = usePending(account, ROUTE.margin);
  const repay = usePending(account, ROUTE.repay);
  if (!account || !box.data) return null;
  const waiting = [
    { route: ROUTE.margin, p: margin.data },
    { route: ROUTE.repay, p: repay.data },
  ].filter((w) => w.p && (w.p[0] > 0n || w.p[1] > 0n));

  return (
    <div className="border-t border-line pt-3 text-[12px] text-ink-3">
      <p>Your inlet on Robinhood Chain, open to any plain tdUSD, USDG or ETH send:</p>
      <CopyLine text={box.data} />
      {waiting.map((w) => (
        <button
          key={w.route}
          type="button"
          className="btn btn-sm mt-2 w-full"
          disabled={busy}
          onClick={() =>
            void send("Sweep the inlet", { chainId: HUB.chainId, address: INLET, abi: omnitideInletAbi, functionName: "sweep", args: [account, w.route] })
              .then(() => qc.invalidateQueries({ queryKey: ["inlet-pending"] }))
              .catch(() => {})
          }
        >
          Sweep {w.p![0] > 0n ? `${(Number(w.p![0]) / 1e6).toFixed(2)} dollars` : ""}
          {w.p![0] > 0n && w.p![1] > 0n ? " + " : ""}
          {w.p![1] > 0n ? `${(Number(w.p![1]) / 1e18).toFixed(6)} ETH` : ""} {w.route === ROUTE.repay ? "into the loan" : "in"}
        </button>
      ))}
      <a href={explorerAddress(HUB_KEY, box.data)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 hover:text-accent">
        View on the explorer <ExternalLink className="size-3" aria-hidden />
      </a>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={ok ? "Copied" : "Copy address"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1_500);
        } catch {}
      }}
      className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-left font-mono text-[12px] text-ink transition-colors hover:border-accent"
    >
      <span className="truncate">{text}</span>
      {ok ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : <Copy className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
    </button>
  );
}

