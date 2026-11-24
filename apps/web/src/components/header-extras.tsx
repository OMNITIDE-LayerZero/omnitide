"use client";

import { usePathname } from "next/navigation";
import { IS_MAINNET } from "@/lib/chains";

const SITES = [
  { env: "mainnet", label: "Mainnet", short: "Main", origin: "https://omnitide.trade" },
  { env: "testnet", label: "Testnet", short: "Test", origin: "https://testnet.omnitide.trade" },
] as const;

/** Mainnet / Testnet switch: jumps to the same page on the other deployment. */
export function EnvToggle({ className = "" }: { className?: string }) {
  const path = usePathname() ?? "/";
  const current = IS_MAINNET ? "mainnet" : "testnet";
  return (
    <div role="group" aria-label="Environment" className={`inline-flex h-8 shrink-0 items-center rounded-lg border border-line p-0.5 text-[12px] font-medium ${className}`}>
      {SITES.map((s) =>
        s.env === current ? (
          <span key={s.env} aria-current="true" className="inline-flex h-full items-center rounded-md bg-ink px-2 text-bg">
            <span className="sm:hidden">{s.short}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </span>
        ) : (
          <a key={s.env} href={s.origin + path} className="inline-flex h-full items-center rounded-md px-2 text-ink-3 transition-colors hover:bg-raised hover:text-ink">
            <span className="sm:hidden">{s.short}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </a>
        ),
      )}
    </div>
  );
}

export const X_URL = "https://x.com/TradeOmniTide";

/** Link to the OMNITIDE account on X. */
export function XLink({ className = "" }: { className?: string }) {
  return (
    <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="OMNITIDE on X" className={`btn btn-ghost btn-sm w-8 px-0 ${className}`}>
      <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}
