import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { pct } from "@/lib/format";

/** Flood (up) or ebb (down), the tide-table way of saying change. */
export function Change({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 num ${up ? "text-flood" : "text-ebb"}`}>
      <Icon size={14} strokeWidth={1.5} aria-hidden />
      {pct(value)}
      {suffix && <span className="text-ink-3">{suffix}</span>}
    </span>
  );
}
