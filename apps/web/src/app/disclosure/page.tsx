import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DisclosureViewer } from "@/components/deep/disclosure";

export const metadata: Metadata = { title: "Disclosure", description: "Open a Deep Mode book with its Disclosure Key and verify every sealed state against OmnitideDeepPool on Robinhood Chain." };

export default function Disclosure() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1440px] px-4 pt-28 pb-24 sm:px-8 sm:pt-36">
        <div className="grid gap-6 md:grid-cols-[1fr_380px] md:items-end">
          <div>
            <p className="tag text-ink-3">Auditor view · decrypts in your browser · nothing is sent anywhere</p>
            <h1 className="display mt-4 text-[clamp(52px,8vw,112px)] text-ink">Disclosure</h1>
          </div>
          <p className="text-[14px] leading-[22px] text-ink-2">A Disclosure Key opens one Deep book end to end: every seal, every fill, every dollar in and out. Each state is hashed here and matched to the commitment OmnitideDeepPool holds on-chain, so the book can't be edited after the fact.</p>
        </div>
        <div className="mt-12">
          <DisclosureViewer />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
