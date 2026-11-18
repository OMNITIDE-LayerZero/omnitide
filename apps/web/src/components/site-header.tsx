"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme";

const LINKS = [
  { href: "/terminal/trade", label: "Terminal" },
  { href: "/#markets", label: "Markets" },
  { href: "/sea-wall", label: "Sea Wall" },
  { href: "/#contracts", label: "Contracts" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="absolute inset-x-0 top-0 z-30">
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
