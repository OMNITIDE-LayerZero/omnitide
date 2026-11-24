"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAccount } from "wagmi";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme";
import { Connect } from "../connect";
import { EnvToggle, XLink } from "../header-extras";
import { Toasts } from "../toasts";
import { TideGauge } from "../tide-gauge";
import { Lifeline } from "./lifeline";
import { useHubAccount } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { money } from "@/lib/format";
import { FEATURES } from "@/lib/contracts";

const ALL_VIEWS = [
  { slug: "trade", label: "Trade", on: true },
  { slug: "portfolio", label: "Portfolio", on: true },
  { slug: "risk", label: "Risk", on: true },
  { slug: "deep", label: "Deep", on: FEATURES.deepWater },
  { slug: "harbor", label: "Harbor", on: FEATURES.harbor },
  { slug: "copy", label: "Copy", on: FEATURES.deepWater },
  { slug: "currents", label: "Currents", on: true },
  { slug: "council", label: "Council", on: FEATURES.deepWater },
  { slug: "arena", label: "Arena", on: FEATURES.deepWater },
  { slug: "tide", label: "Tide Chart", on: FEATURES.tide },
  { slug: "history", label: "History", on: true },
  { slug: "markets", label: "Markets", on: true },
  { slug: "watchlist", label: "Watchlist", on: true },
] as const;
/** Views whose contracts are live in this env. */
export const VIEWS = ALL_VIEWS.filter((v) => v.on);

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

function Tab({ slug, label, hint, cut }: { slug: string; label: string; hint?: number; cut?: boolean }) {
  const path = usePathname();
  const active = path?.startsWith(`/terminal/${slug}`);
  return (
    <Link
      href={`/terminal/${slug}`}
      aria-current={active ? "page" : undefined}
      aria-hidden={cut || undefined}
      tabIndex={cut ? -1 : undefined}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[14px] transition-colors ${cut ? "invisible" : ""} ${active ? "bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
      {hint !== undefined && <span className="kbd hidden xl:inline-flex">{hint}</span>}
    </Link>
  );
}

function More({ views }: { views: readonly (typeof VIEWS)[number][] }) {
  const path = usePathname();
  const active = views.find((v) => path?.startsWith(`/terminal/${v.slug}`));
  return (
    // keyed by path so it folds shut after every navigation
    <details key={path} className="group relative shrink-0">
      <summary className={`flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-[14px] transition-colors [&::-webkit-details-marker]:hidden ${active ? "bg-raised text-ink" : "text-ink-2 hover:text-ink"}`}>
        {active?.label ?? "More"}
        <ChevronDown size={14} strokeWidth={1.75} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute top-10 right-0 z-40 min-w-44 rounded-xl border border-line bg-card p-1 shadow-lg">
        {views.map((v) => (
          <Link key={v.slug} href={`/terminal/${v.slug}`} className="block rounded-lg px-3 py-2 text-[14px] text-ink-2 hover:bg-raised hover:text-ink">
            {v.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** Desktop row: tabs that don't fit beside the account strip and wallet fold into More. */
function DeskTabs() {
  const box = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const path = usePathname();
  const [fit, setFit] = useState<number>(KEYED.length);
  const [edge, setEdge] = useState<number>();
  useLayoutEffect(() => {
    const wrap = box.current;
    const el = nav.current;
    if (!wrap || !el) return;
    // folded tabs stay in layout (invisible), so every edge stays measurable; the nav is then cut at the last visible tab so More sits right after it
    const measure = () => {
      const tabs = [...el.children] as HTMLElement[];
      const over = (room: number) => tabs.findIndex((t) => t.offsetLeft + t.offsetWidth > room);
      const more = MORE.length > 0 || over(wrap.clientWidth) >= 0 ? (wrap.querySelector("details")?.offsetWidth ?? 96) + 4 : 0;
      const n = over(wrap.clientWidth - more);
      const k = n < 0 ? tabs.length : n;
      setFit(k);
      const last = tabs[k - 1];
      setEdge(last ? last.offsetLeft + last.offsetWidth : 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    const more = wrap.querySelector("details");
    if (more) ro.observe(more);
    return () => ro.disconnect();
  }, [path]);
  const folded = [...KEYED.slice(fit), ...MORE];
  return (
    <div ref={box} className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
      <nav ref={nav} style={{ width: edge }} className="relative flex min-w-0 items-center gap-1 overflow-hidden" aria-label="Terminal views">
        {KEYED.map((v, i) => (
          <Tab key={v.slug} slug={v.slug} label={v.label} hint={i + 1} cut={i >= fit} />
        ))}
      </nav>
      {folded.length > 0 && <More views={folded} />}
    </div>
  );
}

function AllTabs() {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-2 py-1 lg:hidden" aria-label="Terminal views">
      <EnvToggle className="sm:hidden" />
      <XLink className="shrink-0 sm:hidden" />
      {VIEWS.map((v) => (
        <Tab key={v.slug} slug={v.slug} label={v.label} />
      ))}
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
          <DeskTabs />
          <div className="flex-1 lg:hidden" />
          <AccountStrip />
          <XLink className="hidden sm:inline-flex" />
          <ThemeToggle />
          <div className="hidden sm:block">
            <EnvToggle />
          </div>
          <Connect />
        </div>
        <AllTabs />
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
