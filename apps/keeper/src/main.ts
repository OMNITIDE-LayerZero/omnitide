import { createServer } from "node:http";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDb } from "@omnitide/db";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAINS } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { loadEnv } from "./env.js";
import { quoteFor, type Quote } from "./prices.js";
import { recordQuote } from "./candles.js";
import { oracleDomain, signReport } from "./reports.js";
import { createExecutor } from "./executor.js";
import { backfill } from "./backfill.js";
import { createCurrent } from "./current.js";

const env = loadEnv();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const db = createDb(env.DATABASE_URL);
const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as `0x${string}`);
const hub = DEPLOYMENTS[env.OMNITIDE_ENV as "testnet"].robinhoodTestnet;
if (!hub?.OmnitideOracle || !hub.OmnitideClearinghouse || !hub.OmnitideHarbor) throw new Error("hub contracts are not deployed");
const reader = DEPLOYMENTS[env.OMNITIDE_ENV as "testnet"].arbitrumSepolia?.OmnitideTideReader;
const hubChain = defineChain({
  id: CHAINS.robinhoodTestnet.chainId,
  name: CHAINS.robinhoodTestnet.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.HUB_RPC_URL] } },
});
const pub = createPublicClient({ chain: hubChain, transport: http(env.HUB_RPC_URL) });
const wallet = createWalletClient({ chain: hubChain, transport: http(env.HUB_RPC_URL), account });
const domain = oracleDomain(hubChain.id, hub.OmnitideOracle.proxy as Address);

const latest = new Map<string, Quote>();
const MAX_QUOTE_AGE_MS = { crypto: 60_000, stock: 15 * 60_000 } as const;
const kindOf = new Map(MARKETS.map((m) => [m.feed, m.kind]));

function fresh(feed: string): Quote | undefined {
  const q = latest.get(feed);
  const kind = kindOf.get(feed);
  return q && kind && Date.now() - q.observed <= MAX_QUOTE_AGE_MS[kind] ? q : undefined;
}

async function reportsFor(feeds: string[]) {
  const ts = Math.floor(Date.now() / 1000);
  return Promise.all(
    feeds.map((f) => {
      const q = fresh(f);
      if (!q) throw new Error(`no fresh price for ${f}`);
      return signReport(account, domain, f, q.price, ts);
    }),
  );
}

async function pollPrices(kind: "crypto" | "stock") {
  const results = await Promise.allSettled(MARKETS.filter((m) => m.kind === kind).map(quoteFor));
  for (const r of results) {
    if (r.status === "rejected") continue; // keep the last good quote; staleness is enforced on read
    latest.set(r.value.feed, r.value);
    await recordQuote(db, r.value).catch((e: Error) => log(`db write failed: ${e.message}`));
  }
}

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      log(`${name}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(run, ms);
}

const executor = createExecutor({
  pub,
  wallet,
  clearinghouse: hub.OmnitideClearinghouse.proxy as Address,
  fromBlock: BigInt(hub.OmnitideClearinghouse.block),
  reports: reportsFor,
  price: (f) => (fresh(f) ? Number(fresh(f)!.price) : undefined),
  log,
});
let executorState: Record<string, unknown> = {};

const arbChain = defineChain({ id: CHAINS.arbitrumSepolia.chainId, name: CHAINS.arbitrumSepolia.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.ARB_RPC_URL] } } });
const current = createCurrent({
  env,
  db,
  hub: pub,
  clearinghouse: hub.OmnitideClearinghouse.proxy as Address,
  harbor: hub.OmnitideHarbor.proxy as Address,
  arb: reader
    ? { pub: createPublicClient({ chain: arbChain, transport: http(env.ARB_RPC_URL) }), wallet: createWalletClient({ chain: arbChain, transport: http(env.ARB_RPC_URL), account }), reader: reader.proxy as Address }
    : undefined,
  prices: () => Object.fromEntries(MARKETS.flatMap((m) => (fresh(m.feed) ? [[m.feed, Number(fresh(m.feed)!.price)]] : []))),
  log,
});
let currentState: Record<string, unknown> = {};

void backfill(db, MARKETS, log);
every(3_000, "crypto", () => pollPrices("crypto"));
every(10_000, "stocks", () => pollPrices("stock"));
if (env.EXECUTE === "1") every(5_000, "executor", async () => (executorState = await executor.tick()));
every(10 * 60_000, "snapshots", async () => Object.assign(currentState, await current.snapshot()));
every(60_000, "riptide", async () => Object.assign(currentState, await current.riptide()));
every(20_000, "telegram", () => current.telegramLink());
if (env.EXECUTE === "1" && env.TIDE_READ_HOURS > 0) every(env.TIDE_READ_HOURS * 3_600_000, "lzRead", async () => Object.assign(currentState, await current.tideRead()));
every(15_000, "heartbeat", () =>
  db.heartbeat.upsert({
    where: { service: "keeper" },
    create: { service: "keeper", beatAt: new Date(), detail: { fresh: [...latest.keys()].filter((f) => fresh(f)).length, ...executorState, ...currentState } },
    update: { beatAt: new Date(), detail: { fresh: [...latest.keys()].filter((f) => fresh(f)).length, ...executorState, ...currentState } },
  }),
);

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://keeper");
  if (url.pathname === "/reports") {
    const feeds = (url.searchParams.get("feeds") ?? "").split(",").filter((f) => kindOf.has(f));
    if (feeds.length === 0) return json(res, 400, { error: "unknown feeds" });
    try {
      return json(res, 200, { reports: await reportsFor(feeds) });
    } catch (e) {
      return json(res, 503, { error: (e as Error).message });
    }
  }
  if (url.pathname === "/prices") {
    return json(res, 200, { prices: MARKETS.flatMap((m) => (fresh(m.feed) ? [fresh(m.feed)] : [])) });
  }
  if (url.pathname === "/alerts" && req.method === "GET") {
    const account = url.searchParams.get("account") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return json(res, 400, { error: "account required" });
    return json(res, 200, { channels: current.channels, vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null, telegramBot: env.TELEGRAM_BOT_USERNAME ?? null, subscriptions: await current.listFor(account) });
  }
  if (url.pathname === "/alerts" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8_192) return json(res, 413, { error: "too large" });
    }
    try {
      const r = await current.handleRequest(JSON.parse(raw));
      return json(res, r.status, r.body);
    } catch {
      return json(res, 400, { error: "invalid alert request" });
    }
  }
  if (url.pathname === "/health") {
    const live = MARKETS.filter((m) => fresh(m.feed)).length;
    return json(res, live > 0 ? 200 : 503, { ok: live > 0, liveFeeds: live, totalFeeds: MARKETS.length, executor: env.EXECUTE === "1" ? executorState : "off" });
  }
  json(res, 404, { error: "not found" });
}).listen(env.PORT, env.HOST, () => log(`keeper listening on ${env.HOST}:${env.PORT} (${env.OMNITIDE_ENV})`));
