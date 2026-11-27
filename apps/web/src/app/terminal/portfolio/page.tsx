"use client";

import { useAccount } from "wagmi";
import { useHubAccount } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { money, signedMoney } from "@/lib/format";
import { TideGauge } from "@/components/tide-gauge";
import { CollateralPanel } from "@/components/terminal/collateral";
import { PositionsPanel } from "@/components/terminal/positions";
import { QuickFund } from "@/components/terminal/quick-fund";
import { Connect } from "@/components/connect";
import { InflowRoutes } from "@/components/terminal/routes";
import { Pulse } from "@/components/landing/pulse";
import { Lifeline } from "@/components/terminal/lifeline";
import { FEATURES } from "@/lib/contracts";
import { Inlet } from "@/components/terminal/inlet";

export default function Portfolio() {
  const { isConnected } = useAccount();
  const { data: acct } = useHubAccount();
  const prices = usePriceMap();
  const h = accountHealth(acct?.collateral ?? 0, acct?.positions ?? [], prices);
  const upnl = h.equity - (acct?.collateral ?? 0);
  const funded = !!acct && (acct.collateral > 0 || acct.positions.length > 0);

  const figures = funded
    ? [
        { label: "Equity", value: money(h.equity) },
        { label: "Collateral", value: money(acct.collateral) },
        ...(acct.positions.length ? [{ label: "Unrealized PnL", value: signedMoney(upnl), tone: upnl >= 0 ? "text-flood" : "text-ebb" }] : []),
        ...(h.notional > 0 ? [{ label: "Leverage", value: `${h.leverage.toFixed(2)}×` }] : []),
        { label: "Free margin", value: money(Math.max(0, h.free)) },
      ]
    : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="tag text-ink-3">One account · Robinhood Chain hub</p>
              <h1 className="display mt-2 text-[44px] text-ink">Portfolio</h1>
            </div>
            {funded && (
              <div className="text-right">
                <p className="text-[12px] text-ink-3">Above the sea wall</p>
                <TideGauge level={h.level} className="mt-1 justify-end" />
              </div>
            )}
          </div>
          {!isConnected ? (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <p className="text-[14px] text-ink-2">Connect a wallet to see your margin, positions and collateral across chains.</p>
              <Connect size="md" />
            </div>
          ) : !funded ? (
            <div className="mt-6 max-w-xl">
              <QuickFund />
            </div>
          ) : (
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-5">
              {figures.map((f) => (
                <div key={f.label} className="bg-card p-4">
                  <dt className="text-[13px] text-ink-3">{f.label}</dt>
                  <dd className={`num mt-1 text-[24px] leading-8 font-medium ${"tone" in f ? f.tone : ""}`}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {funded && h.notional > 0 && (
            <p className="tag mt-4 text-ink-3">
              Maintenance {money(h.mm)} · initial {money(h.im)} · liquidation when equity meets maintenance
            </p>
          )}
        </div>
        {funded && <Lifeline always />}
        {funded ? (
          <div className="rounded-2xl border border-line bg-card">
            <PositionsPanel />
          </div>
        ) : (
          <>
            <Pulse />
            <InflowRoutes />
          </>
        )}
      </section>
      <aside className="flex flex-col gap-3">
        <CollateralPanel />
        {FEATURES.inlet && <Inlet />}
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">How collateral moves</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Inflow burns tdUSD on the source chain and LayerZero mints it on the hub.</li>
            <li>lzCompose credits it to your account inside the clearinghouse in the same delivery.</li>
            <li>Ebb checks free margin against signed prices, then sends tdUSD out the same way.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
