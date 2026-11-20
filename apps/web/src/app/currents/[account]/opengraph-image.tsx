import { ImageResponse } from "next/og";
import { upstream } from "@/lib/server/upstream";

export const alt = "OMNITIDE Currents verified PnL card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Trader {
  trader: { account: string; trades: number; volumeUsd: string; realizedPnl: string } | null;
  rank?: number;
  of?: number;
}

const usd = (v: number) => `${v < 0 ? "−" : "+"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function Image({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(account);
  const data = valid ? await upstream<Trader>("indexer", `/trader?account=${account.toLowerCase()}`).catch(() => null) : null;
  const t = data?.trader;
  const pnl = t ? Number(BigInt(t.realizedPnl)) / 1e6 : 0;
  const vol = t ? Number(BigInt(t.volumeUsd)) / 1e18 : 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0b1530", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, opacity: 0.7, letterSpacing: 2 }}>
          <span>OMNITIDE CURRENTS</span>
          <span>{valid ? `${account.slice(0, 6)}…${account.slice(-4)}` : ""}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 30, opacity: 0.6 }}>{t ? "Verified realized PnL" : "Riding the tide on Robinhood Chain"}</span>
          <span style={{ fontSize: 150, fontWeight: 700, color: t ? (pnl >= 0 ? "#7ee0b5" : "#ff9a8a") : "#ffffff", lineHeight: 1.05 }}>{t ? usd(pnl) : "OMNITIDE"}</span>
        </div>
        <div style={{ display: "flex", gap: 64, fontSize: 32 }}>
          {t && <span>{data?.rank ? `Rank #${data.rank} of ${data.of}` : ""}</span>}
          {t && <span>Volume ${Math.round(vol).toLocaleString("en-US")}</span>}
          {t && <span>{t.trades} fills</span>}
          <span style={{ marginLeft: "auto", color: "#8fa3ff" }}>omnichain perps</span>
        </div>
      </div>
    ),
    size,
  );
}
