import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { CHAINS } from "@omnitide/contracts/chains";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FEATURE_LIST, featureId } from "@/components/landing/features";
import { CHAIN_COUNT, ENV, HUB_KEY, SHORT, explorerAddress } from "@/lib/chains";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { ago, shortHash } from "@/lib/format";
import { receipts } from "@/lib/server/receipts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Proof",
  description: "Every OMNITIDE feature mapped to the page it runs on, the contract it lives in and its latest on-chain transaction.",
};

const ENDPOINTS = [
  { path: "/api/receipts", what: "latest transaction per feature" },
  { path: "/api/indexer/stats", what: "trades, volume, inflows and ebbs per market" },
  { path: "/api/indexer/bridge", what: "every tdUSD LayerZero message, both ends" },
  { path: "/api/seawall", what: "reserves, lane limits and DVN config read live" },
  { path: "/llms.txt", what: "this page as plain text" },
];

const contractOf = (name: string) => CONTRACT_ROWS.find((r) => r.name === name && r.chain === HUB_KEY) ?? CONTRACT_ROWS.find((r) => r.name === name);

export default async function Proof() {
  const r = await receipts();
  const proven = FEATURE_LIST.filter((f) => r[featureId(f)]).length;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1440px] px-4 pt-28 pb-24 sm:px-8 sm:pt-36">
        <div className="grid gap-6 md:grid-cols-[1fr_380px] md:items-end">
          <div>
            <p className="tag text-ink-3">
              Receipts · {ENV} · {CONTRACT_ROWS.length} contracts on {CHAIN_COUNT} chains
            </p>
            <h1 className="display mt-4 text-[clamp(52px,8vw,112px)] text-ink">Proof</h1>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">
            Every feature on the landing page, the screen where it runs and the contract it lives in.{proven > 0 && ` ${proven} of ${FEATURE_LIST.length} carry their latest on-chain transaction, read from the indexer as this page loads.`}
          </p>
        </div>

        <section className="mt-12 overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead className="tag text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-normal">#</th>
                <th className="px-4 py-3 font-normal">Feature</th>
                <th className="px-4 py-3 font-normal">Runs at</th>
                <th className="px-4 py-3 font-normal">Contract</th>
                <th className="px-4 py-3 font-normal">Latest on-chain</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_LIST.map((f) => {
                const [num, name] = f.tag.replace("#", "").split(" · ");
                const c = f.contract ? contractOf(f.contract) : undefined;
                const rec = r[featureId(f)];
                return (
                  <tr key={f.tag} className="border-b border-line last:border-0 align-top">
                    <td className="tag px-4 py-3 text-ink-3">{num}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{f.title}</span>
                      <span className="tag text-ink-3">{name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={f.href} className="inline-flex items-center gap-1 font-mono text-[12px] text-accent-ink hover:underline">
                        {f.href}
                        <ArrowUpRight size={12} strokeWidth={1.5} />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {c ? (
                        <a href={explorerAddress(c.chain, c.proxy)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline">
                          {c.name.replace("Omnitide", "")}
                          <span className="font-mono text-[12px] text-ink-3">
                            {SHORT[c.chain]} · {shortHash(c.proxy)}
                          </span>
                          <ExternalLink size={11} strokeWidth={1.5} />
                        </a>
                      ) : (
                        <span className="tag text-ink-3">view over on-chain state</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {rec ? (
                        <a href={rec.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink hover:underline">
                          <span className="size-1.5 rounded-full bg-[#4cc38a]" aria-hidden />
                          {rec.chain} · {shortHash(rec.tx)} · {ago(rec.at)}
                          <ExternalLink size={11} strokeWidth={1.5} />
                        </a>
                      ) : (
                        <Link href={f.href} className="tag text-ink-3 hover:text-ink">
                          open it live
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="mt-20 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            <p className="tag text-ink-3">Proxies and implementations · source published on each explorer</p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead className="tag text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-4 py-3 font-normal">Chain</th>
                    <th className="px-4 py-3 font-normal">Contract</th>
                    <th className="px-4 py-3 font-normal">Proxy</th>
                    <th className="px-4 py-3 font-normal">Implementation</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACT_ROWS.map((c) => (
                    <tr key={`${c.chain}${c.name}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-ink-2">{CHAINS[c.chain].name}</td>
                      <td className="px-4 py-2.5 text-ink">{c.name}</td>
                      {[c.proxy, c.implementation].map((a) => (
                        <td key={a} className="px-4 py-2.5">
                          <a href={explorerAddress(c.chain, a)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-accent-ink hover:underline">
                            {a}
                          </a>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <aside>
            <p className="tag text-ink-3">Read it yourself · JSON, no key</p>
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-card">
              {ENDPOINTS.map((e) => (
                <li key={e.path} className="px-4 py-3">
                  <a href={e.path} className="font-mono text-[13px] text-accent-ink hover:underline">
                    {e.path}
                  </a>
                  <span className="tag block text-ink-3">{e.what}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
