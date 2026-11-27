import { Hono } from "hono";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, client, count, desc, eq, inArray, isNotNull, ne, notInArray } from "ponder";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";

// Bound to 127.0.0.1 on the VPS: only the web app's route handlers call this.
const app = new Hono();
app.use("/sql/*", client({ db, schema }));

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const addr = (s: string | undefined) => (s && /^0x[0-9a-fA-F]{40}$/.test(s) ? (s.toLowerCase() as `0x${string}`) : null);
const limit = (s: string | undefined) => Math.min(Math.max(Number(s) || 50, 1), 200);

app.get("/stats", async (c) => {
  const [global] = await db.select().from(schema.stats).where(eq(schema.stats.id, "global"));
  const markets = await db.select().from(schema.market).orderBy(schema.market.id);
  return c.json(json({ global: global ?? null, markets }));
});

app.get("/trades", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.trade);
  const rows = await (account ? q.where(eq(schema.trade.account, account)) : q).orderBy(desc(schema.trade.timestamp)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/positions", async (c) => {
  const account = addr(c.req.query("account"));
  if (!account) return c.json({ error: "account required" }, 400);
  const rows = await db.select().from(schema.position).where(and(eq(schema.position.account, account), ne(schema.position.size, 0n)));
  return c.json(json(rows));
});

app.get("/orders", async (c) => {
  const account = addr(c.req.query("account"));
  if (!account) return c.json({ error: "account required" }, 400);
  const rows = await db.select().from(schema.order).where(eq(schema.order.account, account)).orderBy(desc(schema.order.placedAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/flows", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.flow);
  const rows = await (account ? q.where(eq(schema.flow.account, account)) : q).orderBy(desc(schema.flow.timestamp)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/bridge", async (c) => {
  // receive-only rows come from retired spokes whose send side is no longer indexed
  const rows = await db.select().from(schema.bridge).where(isNotNull(schema.bridge.sentTx)).orderBy(desc(schema.bridge.sentAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/harbor", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.harborFlow);
  const rows = await (account ? q.where(eq(schema.harborFlow.account, account)) : q).orderBy(desc(schema.harborFlow.timestamp)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/lending", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.lendingFlow);
  const rows = await (account ? q.where(eq(schema.lendingFlow.account, account)) : q).orderBy(desc(schema.lendingFlow.timestamp)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/tide", async (c) => {
  const rows = await db.select().from(schema.tideRead).orderBy(desc(schema.tideRead.readAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

// every open position in the book, for book-wide stress tests and concentration
app.get("/book", async (c) => {
  const rows = await db.select().from(schema.position).where(ne(schema.position.size, 0n)).limit(2000);
  return c.json(json(rows));
});

// accounts that ever funded the book, for keeper snapshots and alerts
app.get("/accounts", async (c) => {
  const rows = await db.selectDistinct({ account: schema.flow.account }).from(schema.flow).limit(2000);
  return c.json(rows.map((r) => r.account));
});

// the Deep pool trades for many private books at once, so it never ranks as a trader
const DEEP_POOL = Object.values(DEPLOYMENTS[process.env.OMNITIDE_ENV === "mainnet" ? "mainnet" : "testnet"]).find((c) => c?.OmnitideDeepPool)?.OmnitideDeepPool?.proxy.toLowerCase() as `0x${string}` | undefined;
const notPool = DEEP_POOL ? notInArray(schema.trader.account, [DEEP_POOL]) : undefined;

app.get("/leaderboard", async (c) => {
  const by = c.req.query("by") === "volume" ? schema.trader.volumeUsd : schema.trader.realizedPnl;
  const rows = await db.select().from(schema.trader).where(notPool).orderBy(desc(by)).limit(limit(c.req.query("limit")));
  const vaults = await db.select({ address: schema.copyVault.address, name: schema.copyVault.name }).from(schema.copyVault);
  const names = new Map(vaults.map((v) => [v.address.toLowerCase(), v.name]));
  return c.json(json(rows.map((r) => ({ ...r, vault: names.get(r.account.toLowerCase()) ?? null }))));
});

app.get("/trader", async (c) => {
  const account = addr(c.req.query("account"));
  if (!account) return c.json({ error: "account required" }, 400);
  const [row] = await db.select().from(schema.trader).where(eq(schema.trader.account, account));
  if (!row) return c.json({ trader: null });
  const all = await db.select({ pnl: schema.trader.realizedPnl }).from(schema.trader).where(notPool);
  return c.json(json({ trader: row, rank: all.filter((t) => t.pnl > row.realizedPnl).length + 1, of: all.length }));
});

// ───────── V3 Deep Water ─────────

app.get("/deep/:id", async (c) => {
  const id = c.req.param("id").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id)) return c.json({ error: "bad id" }, 400);
  const rows = await db.select().from(schema.deepNote).where(eq(schema.deepNote.deepId, id as `0x${string}`)).orderBy(desc(schema.deepNote.timestamp)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/deep", async (c) => {
  const seals = await db.select({ n: count() }).from(schema.deepNote).where(eq(schema.deepNote.kind, "seal"));
  const latest = await db.select({ deepId: schema.deepNote.deepId, kind: schema.deepNote.kind, commitment: schema.deepNote.commitment, timestamp: schema.deepNote.timestamp, tx: schema.deepNote.tx }).from(schema.deepNote).orderBy(desc(schema.deepNote.timestamp)).limit(limit(c.req.query("limit")));
  const books = await db.selectDistinct({ deepId: schema.deepNote.deepId }).from(schema.deepNote);
  return c.json(json({ books: books.length, seals: seals[0]?.n ?? 0, latest }));
});

app.get("/sealed", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.sealedOrder);
  const rows = await (account ? q.where(eq(schema.sealedOrder.account, account)) : q).orderBy(desc(schema.sealedOrder.placedAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/lighthouse", async (c) => {
  const account = addr(c.req.query("account"));
  const q = db.select().from(schema.beam);
  const rows = await (account ? q.where(eq(schema.beam.account, account)) : q).orderBy(desc(schema.beam.issuedAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/badges", async (c) => {
  const owner = addr(c.req.query("owner"));
  const q = db.select().from(schema.badge);
  const rows = await (owner ? q.where(eq(schema.badge.owner, owner)) : q).orderBy(desc(schema.badge.updatedAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/council", async (c) => {
  const proposals = await db.select().from(schema.proposal).where(ne(schema.proposal.start, 0)).orderBy(desc(schema.proposal.id)).limit(limit(c.req.query("limit")));
  const voter = addr(c.req.query("voter"));
  const votes = voter ? await db.select().from(schema.vote).where(eq(schema.vote.voter, voter)) : [];
  const stakes = await db.select().from(schema.stake);
  const totals = new Map<number, bigint>();
  for (const s of stakes) totals.set(s.chainId, (totals.get(s.chainId) ?? 0n) + s.amount);
  return c.json(json({ proposals, votes, staked: Object.fromEntries(totals), stakers: stakes.filter((s) => s.amount > 0n).length, mine: voter ? stakes.filter((s) => s.account.toLowerCase() === voter) : [] }));
});

app.get("/council/:id", async (c) => {
  const id = BigInt(c.req.param("id").replace(/\D/g, "") || "0");
  const [p] = await db.select().from(schema.proposal).where(eq(schema.proposal.id, id));
  if (!p) return c.json({ error: "unknown proposal" }, 404);
  const votes = await db.select().from(schema.vote).where(eq(schema.vote.proposalId, id)).orderBy(desc(schema.vote.weight)).limit(200);
  return c.json(json({ proposal: p, votes }));
});

app.get("/vaults", async (c) => {
  const rows = await db.select().from(schema.copyVault).orderBy(desc(schema.copyVault.createdAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/vaults/:address", async (c) => {
  const vault = addr(c.req.param("address"));
  if (!vault) return c.json({ error: "bad address" }, 400);
  const [v] = await db.select().from(schema.copyVault).where(eq(schema.copyVault.address, vault));
  if (!v) return c.json({ error: "unknown vault" }, 404);
  const [flows, trades, pending] = await Promise.all([
    db.select().from(schema.copyFlow).where(eq(schema.copyFlow.vault, vault)).orderBy(desc(schema.copyFlow.timestamp)).limit(100),
    db.select().from(schema.trade).where(eq(schema.trade.account, vault)).orderBy(desc(schema.trade.timestamp)).limit(100),
    db.select().from(schema.copyPending).where(eq(schema.copyPending.vault, vault)),
  ]);
  return c.json(json({ vault: v, flows, trades, pending }));
});

// keeper: queued omnichain deposits waiting for settle()
app.get("/copy/pending", async (c) => {
  const rows = await db.select().from(schema.copyPending);
  const byVault = new Map<string, string[]>();
  for (const r of rows) byVault.set(r.vault, [...(byVault.get(r.vault) ?? []), r.account]);
  return c.json([...byVault].map(([vault, accounts]) => ({ vault, accounts })));
});

// keeper: what an account has done, for Arena Badge claims
app.get("/eligibility", async (c) => {
  const account = addr(c.req.query("account"));
  if (!account) return c.json({ error: "account required" }, 400);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [trades, inflows, harbor, votes, beams] = await Promise.all([
    n(db.select({ n: count() }).from(schema.trade).where(eq(schema.trade.account, account))),
    n(db.select({ n: count() }).from(schema.flow).where(and(eq(schema.flow.account, account), inArray(schema.flow.kind, ["inflow"])))),
    n(db.select({ n: count() }).from(schema.harborFlow).where(and(eq(schema.harborFlow.account, account), eq(schema.harborFlow.kind, "deposit")))),
    n(db.select({ n: count() }).from(schema.vote).where(eq(schema.vote.voter, account))),
    n(db.select({ n: count() }).from(schema.beamSent).where(eq(schema.beamSent.account, account))),
  ]);
  return c.json({ trades, inflows, harbor, votes, beams });
});

export default app;
