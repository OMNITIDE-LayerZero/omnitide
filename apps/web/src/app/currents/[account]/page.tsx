import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PnlCard } from "@/components/currents/pnl-card";

type Props = { params: Promise<{ account: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { account } = await params;
  return { title: `Currents · ${account.slice(0, 6)}…${account.slice(-4)}`, description: "Verified PnL on OMNITIDE, summed from on-chain fills on Robinhood Chain." };
}

export default async function TraderCard({ params }: Props) {
  const { account } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[880px] px-4 pt-28 pb-24 sm:px-8 sm:pt-36">
        <p className="tag text-ink-3">Currents · verified PnL card</p>
        <div className="mt-6">
          <PnlCard account={account.toLowerCase()} />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/terminal/currents" className="btn btn-primary">
            See the full board
          </Link>
          <Link href="/terminal/trade" className="btn btn-secondary">
            Catch your own current
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
