import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="OMNITIDE home">
      <Image unoptimized src="/brand/mark.webp" alt="" width={33} height={24} priority />
      <span className="display text-[22px] leading-none tracking-[0.02em] font-normal">Omnitide</span>
    </Link>
  );
}
