"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme";
import { Connect } from "../connect";
import { Toasts } from "../toasts";
import { TideGauge } from "../tide-gauge";
import { Lifeline } from "./lifeline";
import { useHubAccount } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { money } from "@/lib/format";

export const VIEWS = [
  { slug: "trade", label: "Trade" },
  { slug: "portfolio", label: "Portfolio" },
  { slug: "risk", label: "Risk" },
  { slug: "harbor", label: "Harbor" },
  { slug: "tide", label: "Tide Chart" },
  { slug: "history", label: "History" },
  { slug: "markets", label: "Markets" },
  { slug: "watchlist", label: "Watchlist" },
] as const;

function AccountStrip() {
  const { isConnected } = useAccount();
  const { data } = useHubAccount();
  const prices = usePriceMap();
  if (!isConnected || !data || (data.collateral === 0 && data.positions.length === 0)) return null;
  const h = accountHealth(data.collateral, data.positions, prices);
  return (
    <div className="hidden items-center gap-6 xl:flex">
      <div>
        <p className="text-[12px] leading-4 text-ink-3">Equity</p>
        <p className="num text-[14px] font-medium">{money(h.equity)}</p>
      </div>
      <div>
        <p className="text-[12px] leading-4 text-ink-3">Free margin</p>
        <p className="num text-[14px] font-medium">{money(Math.max(0, h.free))}</p>
      </div>
      <TideGauge level={h.level} className="[&>div]:h-8" />
    </div>
  );
}

function ViewTabs({ className }: { className: string }) {
  const path = usePathname();
  return (
    <nav className={`relative items-center gap-1 overflow-x-auto ${className}`} aria-label="Terminal views">
      {VIEWS.map((v, i) => {
        const active = path?.startsWith(`/terminal/${v.slug}`);
        return (
          <Link
            key={v.slug}
            href={`/terminal/${v.slug}`}
            aria-current={active ? "page" : undefined}
            className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] transition-colors ${active ? "bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" : "text-ink-2 hover:text-ink"}`}
          >
            {v.label}
            <span className="kbd hidden lg:inline-flex">{i + 1}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();

  // number keys jump between views, like a desk terminal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(t.tagName)) return;
      const v = VIEWS[Number(e.key) - 1];
      if (v) router.push(`/terminal/${v.slug}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="flex min-h-[100svh] flex-col bg-bg-deep">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-4 px-4 sm:gap-6">
          <Logo href="/" />
          <ViewTabs className="hidden min-w-0 flex-1 lg:flex" />
          <div className="flex-1 lg:hidden" />
          <AccountStrip />
          <ThemeToggle />
          <Connect />
        </div>
        <ViewTabs className="flex border-t border-line px-2 py-1 lg:hidden" />
      </header>
      <main className="mx-auto w-full max-w-[1680px] flex-1 p-3 sm:p-4">
        {/* portfolio shows its own, always-on Lifeline */}
        {!path?.startsWith("/terminal/portfolio") && (
          <div className="mb-3 empty:hidden">
            <Lifeline />
          </div>
        )}
        {children}
      </main>
      <Toasts />
    </div>
  );
}
