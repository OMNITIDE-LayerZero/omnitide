import Link from "next/link";
import { Logo } from "./logo";
import { NetworkStatus } from "./network-status";
import { IS_MAINNET } from "@/lib/chains";
import { FEATURES } from "@/lib/contracts";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-12 sm:px-8 md:grid-cols-[1fr_auto]">
        <div>
          <Logo />
          <p className="display mt-6 text-[40px] text-ink">One book. Every chain.</p>
          <p className="tag mt-2 text-ink-2">Beneath the surface · {IS_MAINNET ? "live on mainnet" : "testnet season"} · secured by LayerZero</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-[14px] text-ink-2" aria-label="Footer">
          <Link href="/terminal/trade" className="hover:text-ink">Trade</Link>
          <Link href="/terminal/portfolio" className="hover:text-ink">Portfolio</Link>
          <Link href="/terminal/markets" className="hover:text-ink">Markets</Link>
          <Link href="/terminal/history" className="hover:text-ink">History</Link>
          {FEATURES.deepWater && <Link href="/terminal/deep" className="hover:text-ink">Deep Mode</Link>}
          <Link href="/terminal/currents" className="hover:text-ink">Currents</Link>
          <Link href="/disclosure" className="hover:text-ink">Disclosure</Link>
          <Link href="/sea-wall" className="hover:text-ink">Sea Wall</Link>
          <Link href="/#contracts" className="hover:text-ink">Contracts</Link>
        </nav>
      </div>
      <div className="border-t border-line">
        <NetworkStatus className="mx-auto max-w-[1440px] px-4 py-4 text-ink-2 sm:px-8" />
      </div>
    </footer>
  );
}
