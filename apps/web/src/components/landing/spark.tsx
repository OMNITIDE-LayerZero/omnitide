"use client";

import { useState } from "react";
import { price } from "@/lib/format";
import { sparkGeometry } from "@/lib/landing";

const W = 112;
const H = 32;

/** Hourly closes ending at the live price; hovering reads the price at that hour. Renders nothing until there are two points. */
export function Spark({ closes, live, label }: { closes: number[] | undefined; live?: number; label: string }) {
  const [at, setAt] = useState<number | null>(null);
  const pts = closes ? (live !== undefined ? [...closes, live] : closes) : [];
  if (pts.length < 2) return <span className="inline-block h-8 w-28 rounded bg-raised/70" aria-hidden />;
  const { xy, line, area } = sparkGeometry(pts, W, H);
  const up = pts.at(-1)! >= pts[0]!;
  const tone = up ? "text-flood" : "text-ebb";
  const last = pts.length - 1;
  const hover = at !== null ? xy[at] : undefined;
  return (
    <span className="relative inline-flex">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className={`overflow-visible ${tone}`}
        role="img"
        aria-label={`${label}, last 24 hours, ${up ? "up" : "down"}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width) * last))));
        }}
        onPointerLeave={() => setAt(null)}
      >
        <path d={area} fill="currentColor" opacity="0.08" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <circle cx={xy[last]![0]} cy={xy[last]![1]} r="2" fill="currentColor" />
        {hover && (
          <>
            <line x1={hover[0]} x2={hover[0]} y1="0" y2={H} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 2" />
            <circle cx={hover[0]} cy={hover[1]} r="2.5" fill="var(--card)" stroke="currentColor" strokeWidth="1.25" />
          </>
        )}
      </svg>
      {at !== null && (
        <span className="tag pointer-events-none absolute -top-6 right-0 z-10 rounded-md border border-line bg-card px-1.5 py-0.5 whitespace-nowrap text-ink shadow-sm">
          {at === last && live !== undefined ? "now" : `${last - at}h ago`} · {price(pts[at]!)}
        </span>
      )}
    </span>
  );
}
