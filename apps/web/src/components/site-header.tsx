"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle, useTheme } from "./theme";
import { haze, type Surface } from "@/lib/haze";

const LINKS = [
  { href: "/terminal/trade", label: "Terminal" },
  { href: "/#markets", label: "Markets" },
  { href: "/terminal/deep", label: "Deep Mode" },
  { href: "/sea-wall", label: "Sea Wall" },
  { href: "/#contracts", label: "Contracts" },
];

// blur strength per band, weakest at the bottom edge of the haze
const BLUR = [1, 2, 4, 8, 16, 32];
const HAZE = 120; // px of haze under the nav
const NAV_Y = 32; // the nav's text line
const FADE = "linear-gradient(to bottom, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.3) 55%, transparent)";
const COLOR = /(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\([^()]*\)/g;

/** The full-bleed surface painted at height y; a data-haze gradient band reports all of its stops. */
function surfaceAt(y: number, vw: number): Surface {
  const hit = document.elementsFromPoint(vw / 2, y).find((el) => !el.closest("header"));
  let box: DOMRect | null = null;
  for (let el: Element | null = hit ?? null; el; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width < vw - 1) continue; // cards and pills don't tint the haze
    box ??= r;
    const s = getComputedStyle(el);
    const ends = el.hasAttribute("data-haze") ? s.backgroundImage.match(COLOR) : null;
    if (ends && ends.length > 1) return { top: r.top, bottom: r.bottom, colors: ends };
    const c = s.backgroundColor;
    if (c !== "transparent" && c !== "rgba(0, 0, 0, 0)") return { top: box.top, bottom: box.bottom, colors: [c] };
  }
  const c = getComputedStyle(document.body).backgroundColor;
  return { top: -Infinity, bottom: Infinity, colors: [c] };
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  // the haze takes the colours of the surfaces scrolling under it, seam for seam, and dark ones flip the nav to light ink
  const tint = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let raf = 0;
    let last = "";
    const read = () => {
      raf = 0;
      const vw = document.documentElement.clientWidth;
      const surfaces: Surface[] = [];
      for (let y = 0; y < HAZE && surfaces.length < 6; ) {
        const s = surfaceAt(y, vw);
        surfaces.push(s);
        y = Math.max(y + 1, Math.ceil(s.bottom));
      }
      const h = haze(surfaces, NAV_Y);
      if (tint.current && h.tint !== last) tint.current.style.background = last = h.tint;
      setDark(h.dark);
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
  return (
    <header className="fixed inset-x-0 top-0 z-30 text-ink transition-colors duration-300" data-theme={dark ? "dark" : undefined} style={dark ? ({ "--text-2": "rgb(255 255 255 / 0.84)" } as React.CSSProperties) : undefined}>
      {/* progressive blur: content melts into haze as it scrolls under the nav, no hard edge */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120px]">
        {BLUR.map((b, i) => {
          const mask = `linear-gradient(to top, transparent ${i * 12.5}%, black ${(i + 1) * 12.5}%${i < BLUR.length - 1 ? `, black ${(i + 2) * 12.5}%, transparent ${(i + 3) * 12.5}%` : ""})`;
          return <div key={b} className="absolute inset-0" style={{ backdropFilter: `blur(${b}px)`, WebkitBackdropFilter: `blur(${b}px)`, maskImage: mask, WebkitMaskImage: mask }} />;
        })}
        <div ref={tint} className="absolute inset-0" style={{ maskImage: FADE, WebkitMaskImage: FADE }} />
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
