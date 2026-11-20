import Image from "next/image";
import Link from "next/link";

const WORD = "Omnitide";

/** Hover or focus: the mark rides a swell and a ripple runs through the wordmark. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo flex items-center gap-2" aria-label="OMNITIDE home">
      <span className="logo-mark relative inline-flex">
        <Image unoptimized src="/brand/mark.webp" alt="" width={33} height={24} priority />
      </span>
      <span aria-hidden className="display flex text-[22px] leading-none tracking-[0.02em] font-normal">
        {[...WORD].map((c, i) => (
          <span key={i} className="logo-letter" style={{ "--i": i } as React.CSSProperties}>
            {c}
          </span>
        ))}
      </span>
    </Link>
  );
}
