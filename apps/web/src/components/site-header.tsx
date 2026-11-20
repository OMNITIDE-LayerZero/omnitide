"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle, useTheme } from "./theme";

const LINKS = [
  { href: "/terminal/trade", label: "Terminal" },
  { href: "/#markets", label: "Markets" },
  { href: "/terminal/deep", label: "Deep Mode" },
  { href: "/sea-wall", label: "Sea Wall" },
  { href: "/#contracts", label: "Contracts" },
];

// blur strength per band, weakest at the bottom edge of the haze
const BLUR = [1, 2, 4, 8, 16, 32];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  // what sits under the nav: its colour tints the haze, and dark sections flip the nav to light ink
  const [under, setUnder] = useState({ bg: "", dark: false });
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const hit = document.elementsFromPoint(window.innerWidth / 2, 40).find((el) => !el.closest("header"));
      let bg = "";
      for (let el: Element | null = hit ?? null; el && !bg; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (c !== "transparent" && c !== "rgba(0, 0, 0, 0)") bg = c;
      }
      const dark = !!hit?.closest('[data-tone="dark"]');
      setUnder((u) => (u.bg === bg && u.dark === dark ? u : { bg, dark }));
    };
    const onScroll = () => (raf ||= requestAnimationFrame(read));
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [theme]);
  const tint = under.bg || "var(--bg)";
  return (
    <header className="fixed inset-x-0 top-0 z-30 text-ink" data-theme={under.dark ? "dark" : undefined} style={under.dark ? ({ "--text-2": "rgb(255 255 255 / 0.84)" } as React.CSSProperties) : undefined}>
      {/* progressive blur: content melts into haze as it scrolls under the nav, no hard edge */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120px]">
        {BLUR.map((b, i) => {
          const mask = `linear-gradient(to top, transparent ${i * 12.5}%, black ${(i + 1) * 12.5}%${i < BLUR.length - 1 ? `, black ${(i + 2) * 12.5}%, transparent ${(i + 3) * 12.5}%` : ""})`;
          return <div key={b} className="absolute inset-0" style={{ backdropFilter: `blur(${b}px)`, WebkitBackdropFilter: `blur(${b}px)`, maskImage: mask, WebkitMaskImage: mask }} />;
        })}
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, color-mix(in srgb, ${tint} 75%, transparent), color-mix(in srgb, ${tint} 30%, transparent) 55%, transparent)` }} />
      </div>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-8">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="btn btn-ghost btn-sm">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/terminal/trade" className="btn btn-primary btn-sm hidden sm:inline-flex">
            Open terminal
          </Link>
          <button type="button" className="btn btn-ghost btn-sm w-8 px-0 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X size={16} strokeWidth={1.5} /> : <Menu size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="rise mx-4 rounded-xl border border-line bg-card p-2 shadow-md md:hidden" aria-label="Mobile">
          {[...LINKS, { href: "/terminal/trade", label: "Open terminal" }].map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setOpen(false)} className="flex h-10 items-center rounded-lg px-3 text-ink-2 hover:bg-raised hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
