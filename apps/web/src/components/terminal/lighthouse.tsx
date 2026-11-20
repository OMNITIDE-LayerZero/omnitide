"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig, useSignMessage } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { Address, Hex } from "viem";
import { CHAINS } from "@omnitide/contracts/chains";
import { lighthouseMessage } from "@omnitide/contracts/deep";
import { HUB, HUB_KEY, SHORT } from "@/lib/chains";
import { V3_CHAINS, omnitideLighthouseAbi, v3Address } from "@/lib/contracts";
import { explain, useTx } from "@/lib/tx";
import { toast } from "@/components/toasts";

interface Beam {
  chainId: number;
  score: number;
  grade: number;
  issuedAt: number;
  expiry: number;
}

const GRADES = ["A", "B", "C", "D"];

/** Lighthouse Proof: the keeper signs your Book Score, you broadcast it so any protocol on any chain can read scoreOf(you). */
export function LighthousePanel() {
  const { address } = useAccount();
  const config = useConfig();
  const { signMessageAsync } = useSignMessage();
  const { send } = useTx();
  const [busy, setBusy] = useState(false);
  const { data: beams } = useQuery({
    queryKey: ["beams", address],
    enabled: !!address,
    refetchInterval: 10_000,
    queryFn: async () => (await (await fetch(`/api/indexer/lighthouse?account=${address}`)).json()) as Beam[],
  });
  const spokes = V3_CHAINS.filter((k) => k !== HUB_KEY);

  async function shine() {
    if (!address) return;
    setBusy(true);
    try {
      const issuedAt = new Date().toISOString();
      const signature = await signMessageAsync({ message: lighthouseMessage(address, HUB.chainId, issuedAt) });
      const res = await fetch("/api/keeper/lighthouse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: address, chainId: HUB.chainId, issuedAt, signature }) });
      const r = (await res.json()) as { beam?: { account: Address; score: number; grade: number; issuedAt: number; expiry: number }; signature?: Hex; error?: string };
      if (!res.ok || !r.beam) throw new Error(r.error ?? "The keeper couldn't score this book");
      const beam = { ...r.beam, issuedAt: BigInt(r.beam.issuedAt), expiry: BigInt(r.beam.expiry) };
      const eids = spokes.map((k) => CHAINS[k].eid);
      const lighthouse = v3Address(HUB_KEY, "OmnitideLighthouse");
      const fee = await getPublicClient(config, { chainId: HUB.chainId })!.readContract({ address: lighthouse, abi: omnitideLighthouseAbi, functionName: "quoteShine", args: [beam, eids] });
      setBusy(false);
      // send() toasts its own progress and failures
      await send(`Light the beam: grade ${GRADES[r.beam.grade]}`, { chainId: HUB.chainId, address: lighthouse, abi: omnitideLighthouseAbi, functionName: "shine", args: [beam, r.signature!, eids], value: (fee * 11n) / 10n }).catch(() => {});
    } catch (e) {
      toast.push({ kind: "error", title: "Lighthouse stayed dark", body: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const live = (beams ?? []).filter((b) => b.expiry > Date.now() / 1000);
  return (
    <div className="mt-5 rounded-xl border border-line bg-raised/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">Lighthouse Proof</p>
        <span className="tag text-ink-3">privacy-first · EIP-712 attestation · LayerZero OApp</span>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">
        Publish your grade, keep your positions private. The keeper signs your Book Score, OmnitideLighthouse stores it on {SHORT[HUB_KEY]} and beams it to {spokes.map((k) => SHORT[k]).join(", ")}, where any lender or protocol can call scoreOf(you).
      </p>
      {live.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {V3_CHAINS.map((k) => {
            const b = live.find((x) => x.chainId === CHAINS[k].chainId);
            return (
              <li key={k} className={`rounded-lg border px-3 py-1.5 text-[12px] ${b ? "border-accent text-ink" : "border-line text-ink-3"}`}>
                {SHORT[k]} {b ? <span className="num font-medium">· {GRADES[b.grade]} {b.score}</span> : "· in flight"}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn btn-primary btn-sm mt-3" disabled={busy || !address} onClick={() => void shine()}>
        {live.length ? "Refresh the beam" : "Light the beam"}
      </button>
    </div>
  );
}
