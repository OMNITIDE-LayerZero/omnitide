import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="OMNITIDE home">
      {/* transparent mark; on paper the white foam is tinted so the crests stay visible */}
      <Image unoptimized src="/brand/mark-light.webp" alt="" width={33} height={24} className="dark:hidden" priority />
      <Image unoptimized src="/brand/mark-dark.webp" alt="" width={33} height={24} className="hidden dark:block" priority />
      <span className="display text-[22px] leading-none tracking-[0.02em] font-normal">Omnitide</span>
    </Link>
  );
}
