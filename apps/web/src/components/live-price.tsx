"use client";

import { useEffect, useRef, useState } from "react";
import { price as fmt } from "@/lib/format";

/** A price that flashes flood/ebb once when it changes. */
export function LivePrice({ value, className = "" }: { value: number | undefined; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"" | "tick-up" | "tick-down">("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value !== undefined && prev.current !== undefined && value !== prev.current) {
      setDir(value > prev.current ? "tick-up" : "tick-down");
      setN((x) => x + 1);
    }
    prev.current = value;
  }, [value]);
  if (value === undefined) return <span className={`inline-block h-4 w-16 animate-none rounded bg-raised ${className}`} aria-label="Loading price" />;
  return (
    <span key={n} className={`num ${dir} ${className}`}>
      {fmt(value)}
    </span>
  );
}
