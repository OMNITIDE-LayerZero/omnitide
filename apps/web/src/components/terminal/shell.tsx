"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
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
  { slug: "deep", label: "Deep" },
  { slug: "harbor", label: "Harbor" },
  { slug: "copy", label: "Copy" },
  { slug: "currents", label: "Currents" },
  { slug: "council", label: "Council" },
  { slug: "arena", label: "Arena" },
  { slug: "tide", label: "Tide Chart" },
  { slug: "history", label: "History" },
  { slug: "markets", label: "Markets" },
  { slug: "watchlist", label: "Watchlist" },
] as const;

// number keys 1–9 reach the first nine; the rest sit under More on desktop
const KEYED = VIEWS.slice(0, 9);
const MORE = VIEWS.slice(9);

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

function Tab({ slug, label, hint }: { slug: string; label: string; hint?: number }) {
  const path = usePathname();
  const active = path?.startsWith(`/terminal/${slug}`);
  return (
    <Link
      href={`/terminal/${slug}`}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] transition-colors ${active ? "bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
      {hint !== undefined && <span className="kbd hidden xl:inline-flex">{hint}</span>}
    </Link>
  );
}

function More() {
  const path = usePathname();
  const active = MORE.find((v) => path?.startsWith(`/terminal/${v.slug}`));
  return (
    // keyed by path so it folds shut after every navigation
    <details key={path} className="group relative shrink-0">
      <summary className={`flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-[14px] transition-colors [&::-webkit-details-marker]:hidden ${active ? "bg-raised text-ink" : "text-ink-2 hover:text-ink"}`}>
        {active?.label ?? "More"}
        <ChevronDown size={14} strokeWidth={1.75} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute top-10 right-0 z-40 min-w-44 rounded-xl border border-line bg-card p-1 shadow-lg">
        {MORE.map((v) => (
          <Link key={v.slug} href={`/terminal/${v.slug}`} className="block rounded-lg px-3 py-2 text-[14px] text-ink-2 hover:bg-raised hover:text-ink">
            {v.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

function ViewTabs({ className, all }: { className: string; all?: boolean }) {
  return (
    <nav className={`relative items-center gap-1 ${all ? "overflow-x-auto" : ""} ${className}`} aria-label="Terminal views">
      {(all ? VIEWS : KEYED).map((v, i) => (
        <Tab key={v.slug} slug={v.slug} label={v.label} hint={all ? undefined : i + 1} />
      ))}
      {!all && <More />}
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
      const v = KEYED[Number(e.key) - 1];
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
        <ViewTabs all className="flex border-t border-line px-2 py-1 lg:hidden" />
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
