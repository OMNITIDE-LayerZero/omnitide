import { Hono } from "hono";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, client, desc, eq, ne } from "ponder";

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
  const rows = await db.select().from(schema.bridge).orderBy(desc(schema.bridge.sentAt)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

app.get("/leaderboard", async (c) => {
  const rows = await db.select().from(schema.trader).orderBy(desc(schema.trader.realizedPnl)).limit(limit(c.req.query("limit")));
  return c.json(json(rows));
});

export default app;
