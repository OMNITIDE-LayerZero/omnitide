"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { ChainKey } from "@omnitide/contracts/chains";
import { CHAINS } from "@omnitide/contracts/chains";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { HUB_KEY, SHORT, explorerAddress } from "@/lib/chains";

const ROLE: Record<string, string> = {
  OmnitideClearinghouse: "Cross-margin book, orders and private sealed orders, liquidations, Inflow via lzCompose",
  OmnitideOracle: "Verifies EIP-712 signed price reports, 120 s max age",
  OmnitideUSD: "tdUSD omnichain collateral (LayerZero OFT)",
  OmnitidePort: "Stablecoin Port: USDG or USDC in, tdUSD out 1:1, redeemable from its reserve",
  OmnitideHarbor: "Harbor OVault (ERC-4626) that owns the Tide Pool; composes cross-chain deposits and redemptions",
  OmnitideHarborShareAdapter: "Locks htdUSD on the hub so Harbor shares travel as an OFT",
  OmnitideHarborShare: "htdUSD on spokes, minted and burned by LayerZero",
  OmnitideInlet: "Inlet: a CREATE2 deposit address per account for NEAR Intents and plain transfers, swept into margin, loan repayment or ETH collateral, owner-only rescue",
  OmnitideLending: "Lending (ltdUSD, ERC-4626): tdUSD loans against ETH, kinked rate curve, keeper liquidations, interest share to the Tide Pool",
  OmnitideTideReader: "LayerZero lzRead of tdUSD supply across chains for the Tide Chart",
  OmnitideDeepPool: "Deep Mode privacy pool: pooled fills, encrypted book commitments, selective disclosure, signed withdrawals, keeper-free exit",
  OmnitideCopyVaultFactory: "Launches copy vaults behind one upgradeable beacon; vaults take omnichain deposits via lzCompose",
  OmnitideToken: "Governance token on spokes, one supply across chains (LayerZero OFT)",
  OmnitideTokenAdapter: "Locks $OMNITIDE on the hub so it travels to every chain as an OFT",
  OmnitideCouncil: "Stake and vote from any chain; spoke votes cross to the hub tally (OApp)",
  OmnitideLighthouse: "Lighthouse Proof: keeper-attested Book Score, no positions revealed, readable on every chain (OApp)",
  OmnitideBadge: "Arena Badges: keeper-attested ERC-721 that travels as an ONFT",
};

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const TABS = [...new Set(CONTRACT_ROWS.map((r) => r.chain))].sort((a, b) => Number(b === HUB_KEY) - Number(a === HUB_KEY));

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={ok ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          // clipboard blocked: the explorer link next to it still works
        }
      }}
      className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${ok ? "text-flood" : "text-ink-3 hover:bg-raised hover:text-ink"}`}
    >
      {ok ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.5} />}
    </button>
  );
}

function Address({ chain, value, label, strong }: { chain: ChainKey; value: string; label: string; strong?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <a href={explorerAddress(chain, value)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-mono text-[13px] hover:underline ${strong ? "text-accent-ink" : "text-ink-2 hover:text-ink"}`}>
        {short(value)}
        <ExternalLink size={12} strokeWidth={1.5} />
      </a>
      <CopyButton text={value} label={label} />
    </span>
  );
}

/** Every OMNITIDE proxy, grouped by chain, with its implementation and explorer links. */
export function ContractsTable() {
  const [chain, setChain] = useState<ChainKey>(TABS[0]!);
  const rows = CONTRACT_ROWS.filter((r) => r.chain === chain);
  return (
    <div className="rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3 sm:px-5">
        <div role="tablist" aria-label="Chain" className="flex flex-wrap gap-1">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={chain === k}
              onClick={() => setChain(k)}
              className={`h-8 rounded-md px-3 text-[13px] transition-colors ${chain === k ? "bg-ink text-bg" : "text-ink-2 hover:bg-raised hover:text-ink"}`}
            >
              {SHORT[k]}
              <span className={`tag ml-1.5 ${chain === k ? "text-bg/70" : "text-ink-3"}`}>{CONTRACT_ROWS.filter((r) => r.chain === k).length}</span>
            </button>
          ))}
        </div>
        <p className="tag text-[12px] text-ink-2">
          {CONTRACT_ROWS.length} contracts · {TABS.length} chains · UUPS proxies, source verified
        </p>
      </div>

      <div role="tabpanel" aria-label={`${SHORT[chain]} contracts`}>
        <table className="hidden w-full text-left text-[14px] md:table">
          <thead>
            <tr className="text-[12px] text-ink-3">
              <th className="px-5 py-3 font-normal">Contract</th>
              <th className="px-5 py-3 font-normal">Proxy</th>
              <th className="px-5 py-3 font-normal">Implementation</th>
              <th className="px-5 py-3 font-normal">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.chain}${r.name}`} className="border-t border-line align-top transition-colors hover:bg-raised/40">
                <td className="px-5 py-3">
                  <span className="font-medium">{r.name}</span>
                  <span className="mt-1 block max-w-md text-[12px] leading-4 text-ink-3">{ROLE[r.name]}</span>
                </td>
                <td className="px-5 py-2.5">
                  <Address chain={r.chain} value={r.proxy} label={`${r.name} proxy address`} strong />
                </td>
                <td className="px-5 py-2.5">
                  <Address chain={r.chain} value={r.implementation} label={`${r.name} implementation address`} />
                </td>
                <td className="px-5 py-3">
                  <span className="tag text-flood">verified · UUPS</span>
                  <span className="tag block text-ink-3">eid {CHAINS[r.chain].eid}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-line md:hidden">
          {rows.map((r) => (
            <li key={`${r.chain}${r.name}`} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{r.name}</span>
                <span className="tag shrink-0 text-flood">verified · UUPS</span>
              </div>
              <p className="mt-1 text-[12px] leading-4 text-ink-3">{ROLE[r.name]}</p>
              <dl className="mt-3 grid grid-cols-[96px_1fr] items-center gap-y-1 text-[12px]">
                <dt className="text-ink-3">Proxy</dt>
                <dd>
                  <Address chain={r.chain} value={r.proxy} label={`${r.name} proxy address`} strong />
                </dd>
                <dt className="text-ink-3">Implementation</dt>
                <dd>
                  <Address chain={r.chain} value={r.implementation} label={`${r.name} implementation address`} />
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
