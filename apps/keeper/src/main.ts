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

const env = loadEnv();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const db = createDb(env.DATABASE_URL);
const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY as `0x${string}`);
const hub = DEPLOYMENTS[env.OMNITIDE_ENV as "testnet"].robinhoodTestnet;
if (!hub?.OmnitideOracle || !hub.OmnitideClearinghouse) throw new Error("hub contracts are not deployed");
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

void backfill(db, MARKETS, log);
every(3_000, "crypto", () => pollPrices("crypto"));
every(10_000, "stocks", () => pollPrices("stock"));
if (env.EXECUTE === "1") every(5_000, "executor", async () => (executorState = await executor.tick()));
every(15_000, "heartbeat", () =>
  db.heartbeat.upsert({
    where: { service: "keeper" },
    create: { service: "keeper", beatAt: new Date(), detail: { fresh: [...latest.keys()].filter((f) => fresh(f)).length, ...executorState } },
    update: { beatAt: new Date(), detail: { fresh: [...latest.keys()].filter((f) => fresh(f)).length, ...executorState } },
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
  if (url.pathname === "/health") {
    const live = MARKETS.filter((m) => fresh(m.feed)).length;
    return json(res, live > 0 ? 200 : 503, { ok: live > 0, liveFeeds: live, totalFeeds: MARKETS.length, executor: env.EXECUTE === "1" ? executorState : "off" });
  }
  json(res, 404, { error: "not found" });
}).listen(env.PORT, env.HOST, () => log(`keeper listening on ${env.HOST}:${env.PORT} (${env.OMNITIDE_ENV})`));
