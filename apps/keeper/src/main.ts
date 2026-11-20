import { createServer } from "node:http";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDb } from "@omnitide/db";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { loadEnv } from "./env.js";
import { quoteFor, type Quote } from "./prices.js";
import { recordQuote } from "./candles.js";
import { oracleDomain, signReport } from "./reports.js";
import { createExecutor } from "./executor.js";
import { backfill } from "./backfill.js";
import { createCurrent } from "./current.js";
import { createDeepWater } from "./deepwater.js";

const env = loadEnv();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const db = createDb(env.DATABASE_URL);
const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as `0x${string}`);
const deployed = DEPLOYMENTS[env.OMNITIDE_ENV];
const keys = (Object.keys(CHAINS) as ChainKey[]).filter((k) => deployed[k]?.OmnitideUSD);
const hubKey = keys.find((k) => CHAINS[k].hub);
const hub = hubKey ? deployed[hubKey] : undefined;
if (!hubKey || !hub?.OmnitideOracle || !hub.OmnitideClearinghouse) throw new Error("hub contracts are not deployed");
// V2/V3 pieces are optional: mainnet ships version by version
const readerKey = keys.find((k) => deployed[k]?.OmnitideTideReader);
const reader = readerKey ? deployed[readerKey]!.OmnitideTideReader : undefined;
const hubChain = defineChain({
  id: CHAINS[hubKey].chainId,
  name: CHAINS[hubKey].name,
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

const arbChain = defineChain({ id: CHAINS[readerKey ?? hubKey].chainId, name: CHAINS[readerKey ?? hubKey].name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.ARB_RPC_URL] } } });
const current = createCurrent({
  env,
  db,
  hub: pub,
  clearinghouse: hub.OmnitideClearinghouse.proxy as Address,
  harbor: hub.OmnitideHarbor?.proxy as Address | undefined,
  arb: reader
    ? { pub: createPublicClient({ chain: arbChain, transport: http(env.ARB_RPC_URL) }), wallet: createWalletClient({ chain: arbChain, transport: http(env.ARB_RPC_URL), account }), reader: reader.proxy as Address }
    : undefined,
  prices: () => Object.fromEntries(MARKETS.flatMap((m) => (fresh(m.feed) ? [[m.feed, Number(fresh(m.feed)!.price)]] : []))),
  log,
});
let currentState: Record<string, unknown> = {};

const lighthouseSpokes = keys.filter((k) => k !== hubKey && deployed[k]?.OmnitideLighthouse);
const deepWater =
  hub.OmnitideDeepPool && hub.OmnitideBadge && hub.OmnitideLighthouse
    ? createDeepWater({
        env,
        db,
        hub: pub,
        wallet,
        keeperKey: env.KEEPER_PRIVATE_KEY as `0x${string}`,
        hubEid: CHAINS[hubKey].eid,
        clearinghouse: hub.OmnitideClearinghouse.proxy as Address,
        pool: hub.OmnitideDeepPool.proxy as Address,
        poolBlock: BigInt(hub.OmnitideDeepPool.block),
        badge: hub.OmnitideBadge.proxy as Address,
        lighthouses: {
          [CHAINS[hubKey].chainId]: hub.OmnitideLighthouse.proxy as Address,
          ...Object.fromEntries(lighthouseSpokes.map((k) => [CHAINS[k].chainId, deployed[k]!.OmnitideLighthouse!.proxy as Address])),
        },
        reports: reportsFor,
        priceOf: (f) => (fresh(f) ? Number(fresh(f)!.price) : undefined),
        log,
      })
    : undefined;

void backfill(db, MARKETS, log);
every(3_000, "crypto", () => pollPrices("crypto"));
every(10_000, "stocks", () => pollPrices("stock"));
if (env.EXECUTE === "1") every(5_000, "executor", async () => (executorState = await executor.tick()));
// the indexer restarts with us on deploy, so give it a couple of minutes before giving up on this round
every(10 * 60_000, "snapshots", async () => {
  for (let i = 0; ; i++) {
    try {
      return Object.assign(currentState, await current.snapshot());
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
});
every(60_000, "riptide", async () => Object.assign(currentState, await current.riptide()));
every(20_000, "telegram", () => current.telegramLink());
if (env.EXECUTE === "1" && env.TIDE_READ_HOURS > 0) every(3_600_000, "lzRead", async () => Object.assign(currentState, await current.tideRead(env.TIDE_READ_HOURS * 3_600_000)));
if (env.EXECUTE === "1" && deepWater) {
  every(10_000, "deep", async () => Object.assign(currentState, await deepWater.syncDeposits(), await deepWater.liquidateDeep()));
  every(30_000, "seal", async () => Object.assign(currentState, await deepWater.sealDirty()));
  every(5_000, "sealed", async () => Object.assign(currentState, await deepWater.fillSealed()));
  every(60_000, "copy", async () => Object.assign(currentState, await deepWater.settleCopy()));
}
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

async function body(req: import("node:http").IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) return null;
  }
  return raw;
}

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
    const raw = await body(req);
    if (raw === null) return json(res, 413, { error: "too large" });
    try {
      const r = await current.handleRequest(JSON.parse(raw));
      return json(res, r.status, r.body);
    } catch {
      return json(res, 400, { error: "invalid alert request" });
    }
  }
  if (url.pathname.startsWith("/deep") || url.pathname === "/lighthouse" || url.pathname === "/arena") {
    if (!deepWater) return json(res, 503, { error: "Deep Water is not deployed here" });
    try {
      if (url.pathname === "/deep/key") return json(res, 200, { keeperKey: deepWater.keeperPublic });
      if (url.pathname === "/deep/status") return json(res, 200, await deepWater.status(url.searchParams.get("id") ?? ""));
      if (url.pathname === "/arena") {
        const account = url.searchParams.get("account") ?? "";
        if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return json(res, 400, { error: "account required" });
        return json(res, 200, { offers: await deepWater.badgeOffers(account as Address) });
      }
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      const raw = await body(req);
      if (raw === null) return json(res, 413, { error: "too large" });
      const input = JSON.parse(raw);
      const handler = { "/deep/register": deepWater.register, "/deep/trade": deepWater.trade, "/deep/withdraw": deepWater.withdraw, "/lighthouse": deepWater.attestBeam }[url.pathname];
      if (!handler) return json(res, 404, { error: "not found" });
      const r = await handler(input);
      return json(res, r.status, r.body);
    } catch (e) {
      if (e instanceof SyntaxError || (e as Error).name === "ZodError") return json(res, 400, { error: "invalid request" });
      log(`deep water: ${(e as Error).message.split("\n")[0]}`);
      return json(res, 503, { error: "the keeper could not finish that, try again shortly" });
    }
  }
  if (url.pathname === "/health") {
    const live = MARKETS.filter((m) => fresh(m.feed)).length;
    return json(res, live > 0 ? 200 : 503, { ok: live > 0, liveFeeds: live, totalFeeds: MARKETS.length, executor: env.EXECUTE === "1" ? executorState : "off" });
  }
  json(res, 404, { error: "not found" });
}).listen(env.PORT, env.HOST, () => log(`keeper listening on ${env.HOST}:${env.PORT} (${env.OMNITIDE_ENV})`));
