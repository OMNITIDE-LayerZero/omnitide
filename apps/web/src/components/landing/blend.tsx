import type { ReactNode } from "react";
import { tideGradient } from "@/lib/landing";

const FADE = { below: "linear-gradient(to bottom, transparent, black)", above: "linear-gradient(to bottom, black, transparent)" };

/** A tide zone between two sections: an eased fade through the water from one colour to the next, the engraved side's texture fading in with it. The header haze reads it through data-haze. */
export function Blend({ from, to, engrave, className = "h-40 sm:h-56", children }: { from: string; to: string; engrave?: keyof typeof FADE; className?: string; children?: ReactNode }) {
  return (
    <div aria-hidden data-haze className={`relative ${className}`} style={{ background: tideGradient(from, to) }}>
      {engrave && <div className="engrave absolute inset-0" style={{ maskImage: FADE[engrave], WebkitMaskImage: FADE[engrave] }} />}
      {children}
    </div>
  );
}
