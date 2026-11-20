import { ExternalLink } from "lucide-react";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { SHORT, explorerAddress } from "@/lib/chains";
import { CHAINS } from "@omnitide/contracts/chains";

const ROLE: Record<string, string> = {
  OmnitideClearinghouse: "Cross-margin book, orders, liquidations, Inflow via lzCompose",
  OmnitideOracle: "Verifies EIP-712 signed price reports, 120 s max age",
  OmnitideUSD: "tdUSD omnichain collateral (LayerZero OFT)",
  OmnitideHarbor: "Harbor OVault (ERC-4626) that owns the Tide Pool; composes cross-chain deposits and redemptions",
  OmnitideHarborShareAdapter: "Locks htdUSD on the hub so Harbor shares travel as an OFT",
  OmnitideHarborShare: "htdUSD on spokes, minted and burned by LayerZero",
  OmnitideTideReader: "LayerZero lzRead of tdUSD supply across chains for the Tide Chart",
  OmnitideDeepPool: "Deep Mode pool: pooled fills, sealed book commitments, signed withdrawals, keeper-free exit",
  OmnitideCopyVaultFactory: "Launches copy vaults behind one upgradeable beacon; vaults take omnichain deposits via lzCompose",
  OmnitideToken: "TIDE governance token (LayerZero OFT)",
  OmnitideCouncil: "Stake and vote from any chain; spoke votes cross to the hub tally (OApp)",
  OmnitideLighthouse: "Lighthouse Proof: keeper-attested Book Score, readable on every chain (OApp)",
  OmnitideBadge: "Arena Badges: keeper-attested ERC-721 that travels as an ONFT",
};

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function ContractsTable() {
  return (
    <div className="relative overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full min-w-[760px] text-left text-[14px]">
        <thead>
          <tr className="text-[12px] text-ink-3">
            <th className="px-5 py-3 font-normal">Contract</th>
            <th className="px-5 py-3 font-normal">Chain</th>
            <th className="px-5 py-3 font-normal">Proxy</th>
            <th className="px-5 py-3 font-normal">Implementation</th>
            <th className="px-5 py-3 font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {CONTRACT_ROWS.map((r) => (
            <tr key={`${r.chain}${r.name}`} className="border-t border-line align-top">
              <td className="px-5 py-3">
                <span className="font-medium">{r.name}</span>
                <span className="mt-1 block text-[12px] leading-4 text-ink-3">{ROLE[r.name]}</span>
              </td>
              <td className="px-5 py-3 text-ink-2">
                {SHORT[r.chain]}
                <span className="tag block text-ink-3">eid {CHAINS[r.chain].eid}</span>
              </td>
              <td className="px-5 py-3">
                <a href={explorerAddress(r.chain, r.proxy)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-accent-ink hover:underline">
                  {short(r.proxy)}
                  <ExternalLink size={12} strokeWidth={1.5} />
                </a>
              </td>
              <td className="px-5 py-3">
                <a href={explorerAddress(r.chain, r.implementation)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-ink-2 hover:text-ink hover:underline">
                  {short(r.implementation)}
                  <ExternalLink size={12} strokeWidth={1.5} />
                </a>
              </td>
              <td className="px-5 py-3">
                <span className="tag text-flood">verified · UUPS</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
