import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/landing/hero";
import { HarborAtlas } from "@/components/landing/harbor-atlas";
import { Dive } from "@/components/landing/dive";
import { MarketsBoard } from "@/components/landing/markets-board";
import { Pulse } from "@/components/landing/pulse";
import { SeaWallBand } from "@/components/landing/sea-wall-band";
import { ContractsTable } from "@/components/landing/contracts-table";
import { Surface } from "@/components/landing/surface";
import { Blend } from "@/components/landing/blend";

function SectionHead({ tag, title, aside }: { tag: string; title: React.ReactNode; aside?: string }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px] md:items-end">
      <div>
        <p className="tag text-[12px] text-ink-2">{tag}</p>
        <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-ink">{title}</h2>
      </div>
      {aside && <p className="text-[14px] leading-[22px] text-ink-2">{aside}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />

        <Blend from="var(--bg)" to="var(--navy)" engrave="below" />
        <section data-tone="dark" className="engrave relative bg-navy py-8 text-white sm:py-12">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
            <div className="grid gap-6 md:grid-cols-[1fr_360px] md:items-end">
              <div>
                <p className="tag text-[12px] text-white/70">Topology · hub and spoke</p>
                <h2 className="display mt-4 text-[clamp(44px,6vw,80px)]">
                  One book.
                  <br />
                  Every chain.
                </h2>
              </div>
              <p className="text-[14px] leading-[22px] text-white/75">
                Every deposit lands as real margin in one book on Robinhood Chain. One balance, every network, always where you need it.
              </p>
            </div>
            <div className="mt-16">
              <HarborAtlas />
            </div>
          </div>
        </section>

        <Blend from="var(--navy)" to="var(--bg)" engrave="above" />

        <Dive />

        {/* the ascent: out of deep water and back up to the book */}
        <Blend from="var(--abyss)" to="var(--shelf)" className="h-56 sm:h-72">
          <div className="relative mx-auto flex h-full max-w-[1440px] items-center gap-4 px-4 sm:px-8">
            <span className="tag rounded-full border border-white/15 bg-abyss/70 px-3 py-1 text-white/80 backdrop-blur-sm">0 m · surfacing · every market on one margin</span>
            <span className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
          </div>
        </Blend>

        <section id="markets" className="relative scroll-mt-16 bg-shelf py-8 sm:py-12">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
            <SectionHead tag="12 markets · crypto and US stocks" title={<>Bitcoin to<br />Nvidia, one margin</>} aside="Crypto majors at up to 10× and US stocks at up to 5×, priced live from Coinbase and Nasdaq and settled in tdUSD, the dollar that moves with you across chains." />
            <div className="mt-12 rounded-2xl border border-line bg-card p-4 sm:p-6">
              <MarketsBoard landing />
            </div>
            <div className="mt-6">
              <Pulse />
            </div>
          </div>
        </section>

        <Blend from="var(--shelf)" to="#1f3dff" engrave="below" />
        <section data-tone="dark" className="engrave relative bg-accent py-8 sm:py-12" style={{ backgroundColor: "#1f3dff" }}>
          <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
            <SeaWallBand />
          </div>
        </section>

        <Blend from="#1f3dff" to="var(--bg)" engrave="above" />
        <section id="contracts" className="relative scroll-mt-16 py-8 sm:py-12">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
            <SectionHead tag="Upgradeable proxies · source verified" title={<>The contracts<br />behind the tide</>} aside="Every OMNITIDE contract sits behind a UUPS proxy with its source published on the chain's explorer. These are the addresses the terminal talks to." />
            <div className="mt-12">
              <ContractsTable />
            </div>
          </div>
        </section>

        <Blend from="var(--bg)" to="var(--navy)" />
        <Surface />
        <Blend from="var(--navy)" to="var(--bg)" />
      </main>
      <SiteFooter />
    </>
  );
}
