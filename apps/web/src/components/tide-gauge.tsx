/** The signature: a tide-staff gauge. Water level = margin left above the sea wall (maintenance). */
export function TideGauge({ level, label, className = "" }: { level: number; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
  const tone = pct > 50 ? "bg-accent" : pct > 20 ? "bg-warn" : "bg-ebb";
  return (
    <div className={`flex items-end gap-2 ${className}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? "Margin health"}>
      <div className="relative h-12 w-3 overflow-hidden rounded-[4px] border border-line-strong bg-raised">
        {[0.25, 0.5, 0.75].map((t) => (
          <span key={t} className="absolute left-0 h-px w-1.5 bg-line-strong" style={{ bottom: `${t * 100}%` }} />
        ))}
        <span className={`absolute inset-x-0 bottom-0 ${tone} transition-[height] duration-500 ease-[var(--ease-tide)]`} style={{ height: `${pct}%` }} />
      </div>
      <span className="tag text-ink-3 num">{pct}%</span>
    </div>
  );
}
