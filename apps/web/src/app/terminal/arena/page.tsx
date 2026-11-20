"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { Address, Hex } from "viem";
import { ArrowRightLeft, Check } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { BADGES } from "@omnitide/contracts/deep";
import { HUB, HUB_KEY, SHORT } from "@/lib/chains";
import { BADGE_HOME, V3_CHAINS, omnitideBadgeAbi, v3Address } from "@/lib/contracts";
import { badgeSvg } from "@/lib/badge-art";
import { useTx } from "@/lib/tx";
import { Connect } from "@/components/connect";

interface Offer {
  kind: number;
  eligible: boolean;
  deadline: number;
  signature: Hex | null;
}

interface Held {
  chainId: number;
  tokenId: string;
  owner: string;
  kind: number | null;
}

const chainOf = (id: number) => V3_CHAINS.find((k) => CHAINS[k].chainId === id);

function Medal({ kind, dim }: { kind: number; dim?: boolean }) {
  return <div aria-hidden className={`aspect-[5/6] w-full transition-[filter,transform] duration-300 [&>svg]:h-full [&>svg]:w-full ${dim ? "opacity-40 grayscale" : "group-hover:-translate-y-1 group-hover:rotate-[-2deg]"}`} dangerouslySetInnerHTML={{ __html: badgeSvg(kind) }} />;
}

export default function Arena() {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();

  const offers = useQuery({
    queryKey: ["arena-offers", address],
    enabled: !!address,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/keeper/arena?account=${address}`);
      if (!res.ok) throw new Error("arena unavailable");
      return ((await res.json()) as { offers: Offer[] }).offers;
    },
  });
  const claimed = useQuery({
    queryKey: ["arena-claimed", address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const hub = getPublicClient(config, { chainId: HUB.chainId })!;
      return Promise.all(BADGES.map((b) => hub.readContract({ address: BADGE_HOME, abi: omnitideBadgeAbi, functionName: "claimed", args: [address as Address, b.kind] })));
    },
  });
  const held = useQuery({
    queryKey: ["arena-held", address],
    enabled: !!address,
    refetchInterval: 8_000,
    queryFn: async () => (await (await fetch(`/api/indexer/badges?owner=${address}`)).json()) as Held[],
  });

  const owned = (held.data ?? []).filter((h) => h.kind !== null);
  const earned = claimed.data?.filter(Boolean).length ?? 0;

  async function claim(o: Offer) {
    await send(`Claim ${BADGES[o.kind]!.name}`, { chainId: HUB.chainId, address: BADGE_HOME, abi: omnitideBadgeAbi, functionName: "claim", args: [o.kind, BigInt(o.deadline), o.signature!] });
  }

  async function travel(h: Held) {
    const from = chainOf(h.chainId)!;
    const to: ChainKey = from === HUB_KEY ? V3_CHAINS.find((k) => k !== HUB_KEY)! : HUB_KEY;
    const client = getPublicClient(config, { chainId: h.chainId })!;
    const badge = v3Address(from, "OmnitideBadge");
    const fee = await client.readContract({ address: badge, abi: omnitideBadgeAbi, functionName: "quoteSend", args: [CHAINS[to].eid, address as Address, BigInt(h.tokenId)] });
    await send(`Send ${BADGES[h.kind!]!.name} to ${SHORT[to]}`, { chainId: h.chainId, address: badge, abi: omnitideBadgeAbi, functionName: "send", args: [CHAINS[to].eid, address as Address, BigInt(h.tokenId)], value: fee });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">ERC-721 · LayerZero ONFT · minted on Robinhood Chain against a keeper attestation</p>
          <h1 className="display mt-2 text-[44px] text-ink">Arena</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            Eight engraved medals for the things that actually take nerve on OMNITIDE. The keeper checks your record on-chain and signs a one-hour claim; the medal mints on the hub and sails to Arbitrum whenever you want it there.
          </p>
        </div>
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-navy p-5 text-white">
          <p className="tag text-white/60">Your collection</p>
          {address ? (
            <>
              <p className="display mt-2 text-[56px] leading-none">
                {earned}
                <span className="text-white/40"> / {BADGES.length}</span>
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-[#8fa3ff] transition-[width] duration-700" style={{ width: `${(earned / BADGES.length) * 100}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-white/60">{offers.data ? `${offers.data.filter((o) => o.eligible).length - earned > 0 ? `${offers.data.filter((o) => o.eligible).length - earned} ready to claim` : "Keep trading to unlock the rest"}` : "Checking your record…"}</p>
            </>
          ) : (
            <div className="mt-4">
              <Connect size="md" />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {BADGES.map((b) => {
          const o = offers.data?.find((x) => x.kind === b.kind);
          const has = !!claimed.data?.[b.kind];
          const ready = !has && o?.eligible && o.signature;
          return (
            <article key={b.kind} className={`group flex flex-col rounded-2xl border bg-card p-4 transition-colors ${ready ? "border-accent" : "border-line hover:border-line-strong"}`}>
              <Medal kind={b.kind} dim={!!address && !has && !ready} />
              <h2 className="mt-3 font-medium">{b.name}</h2>
              <p className="mt-1 flex-1 text-[13px] leading-5 text-ink-2">{b.line}</p>
              <div className="mt-3">
                {has ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-flood">
                    <Check size={14} strokeWidth={1.75} /> In your collection
                  </span>
                ) : ready ? (
                  <button type="button" className="btn btn-primary btn-sm w-full" disabled={busy} onClick={() => void claim(o!).catch(() => {})}>
                    Claim on {SHORT[HUB_KEY]}
                  </button>
                ) : (
                  <span className="tag text-ink-3">{address ? "not earned yet" : "connect to check"}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {owned.length > 0 && (
        <div className="rounded-2xl border border-line bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
            <h2 className="text-[20px] font-medium">Where your medals are</h2>
            <span className="tag text-ink-3">ONFT send · burn here, mint there, same token id</span>
          </div>
          <ul className="mt-3">
            {owned.map((h) => {
              const at = chainOf(h.chainId);
              return (
                <li key={`${h.chainId}-${h.tokenId}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px]">
                  <span className="font-medium">
                    {BADGES[h.kind!]!.name} <span className="num text-ink-3">#{h.tokenId}</span>
                  </span>
                  <span className="text-ink-2">on {at ? SHORT[at] : h.chainId}</span>
                  {at && V3_CHAINS.length > 1 && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void travel(h).catch(() => {})}>
                      <ArrowRightLeft size={14} strokeWidth={1.75} /> Send to {SHORT[at === HUB_KEY ? V3_CHAINS.find((k) => k !== HUB_KEY)! : HUB_KEY]}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
