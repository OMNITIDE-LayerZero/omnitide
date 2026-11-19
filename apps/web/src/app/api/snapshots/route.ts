import { z } from "zod";
import { db } from "@/lib/server/db";

const Q = z.union([
  z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase()), days: z.coerce.number().int().min(1).max(90).default(30) }),
  z.object({ harbor: z.literal("1"), days: z.coerce.number().int().min(1).max(90).default(30) }),
]);

/** Keeper snapshots: an account's equity curve, or Harbor's size and share price. */
export async function GET(req: Request) {
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json({ error: "bad query" }, { status: 400 });
  const since = new Date(Date.now() - q.data.days * 86_400_000);
  const headers = { "cache-control": "public, max-age=30" };
  if ("harbor" in q.data) {
    const rows = await db().harborSnapshot.findMany({ where: { at: { gte: since } }, orderBy: { at: "asc" } });
    return Response.json({ points: rows.map((r) => ({ time: Math.floor(r.at.getTime() / 1000), assets: Number(r.totalAssets), supply: Number(r.totalSupply) })) }, { headers });
  }
  const rows = await db().accountSnapshot.findMany({ where: { account: q.data.account, at: { gte: since } }, orderBy: { at: "asc" } });
  return Response.json(
    { points: rows.map((r) => ({ time: Math.floor(r.at.getTime() / 1000), equity: Number(r.equity), collateral: Number(r.collateral), upnl: Number(r.upnl), notional: Number(r.notional) })) },
    { headers },
  );
}
