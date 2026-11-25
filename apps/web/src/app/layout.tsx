import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { CHAIN_COUNT } from "@/lib/chains";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-barlow", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4391"),
  title: { default: "OMNITIDE — Be the tide. Not the target.", template: "%s · OMNITIDE" },
  description: `One book. Every chain. Beneath the surface. Bring collateral from ${CHAIN_COUNT} chains into one cross-margin account and trade crypto, US and China stock perps on Robinhood Chain.`,
  openGraph: { images: [{ url: "/brand/link-preview.jpg", width: 1200, height: 630, alt: "OMNITIDE · Be the tide, not the target." }], siteName: "OMNITIDE" },
  twitter: { card: "summary_large_image", images: ["/brand/link-preview.jpg"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#feeddf" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d14" },
  ],
};

// Sets the theme before paint so there is no flash; light is the default.
const themeScript = `try{var t=localStorage.getItem("omnitide-theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${geist.variable} ${geistMono.variable} ${barlow.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
