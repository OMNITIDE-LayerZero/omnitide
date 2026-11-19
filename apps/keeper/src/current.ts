import webpush from "web-push";
import { z } from "zod";
import { verifyMessage, type Account, type Address, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import type { createDb } from "@omnitide/db";
import { omnitideClearinghouseAbi, omnitideHarborAbi, omnitideTideReaderAbi } from "@omnitide/contracts/abi";
import { accountHealth, type Pos } from "@omnitide/contracts/margin";
import { MARKETS } from "@omnitide/contracts/markets";
import { RIPTIDE_CHANNELS, riptideMessage } from "@omnitide/contracts/riptide";
import type { Env } from "./env.js";

type Db = ReturnType<typeof createDb>;

export interface CurrentDeps {
  env: Env;
  db: Db;
  hub: PublicClient<Transport, Chain>;
  clearinghouse: Address;
  harbor: Address;
  arb?: { pub: PublicClient<Transport, Chain>; wallet: WalletClient<Transport, Chain, Account>; reader: Address };
  prices: () => Record<string, number>;
  log: (m: string) => void;
}

export interface AccountState {
  collateral: number;
  positions: Pos[];
}

/** V2 Current background work: equity and Harbor snapshots, Riptide Alerts and scheduled lzRead. */
export function createCurrent(d: CurrentDeps) {
  const { env, db, hub, log } = d;
  const pushOn = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  if (pushOn) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  const channels = { push: pushOn, telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME), email: !!(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM) };

  const ch = <T,>(functionName: string, args: unknown[]) =>
    hub.readContract({ address: d.clearinghouse, abi: omnitideClearinghouseAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  async function readAccount(account: Address): Promise<AccountState> {
    const [bal, open] = await Promise.all([ch<bigint>("balances", [account]), ch<readonly number[]>("openMarkets", [account])]);
    const positions = await Promise.all(
      open.map(async (id) => {
        const [size, entry] = await ch<readonly [bigint, bigint]>("positions", [account, id]);
        return { marketId: Number(id), size: Number(size) / 1e18, entry: Number(entry) / 1e18 };
      }),
    );
    return { collateral: Number(bal) / 1e6, positions: positions.filter((p) => p.size !== 0) };
  }

  async function accounts(): Promise<Address[]> {
    const res = await fetch(`${env.INDEXER_URL}/accounts`);
    if (!res.ok) throw new Error(`indexer /accounts ${res.status}`);
    return z.array(z.string().regex(/^0x[0-9a-f]{40}$/)).parse(await res.json()) as Address[];
  }

  async function snapshot() {
    const at = new Date();
    const prices = d.prices();
    const [supply, assets] = await Promise.all([
      hub.readContract({ address: d.harbor, abi: omnitideHarborAbi, functionName: "totalSupply" }),
      hub.readContract({ address: d.harbor, abi: omnitideHarborAbi, functionName: "totalAssets" }),
    ]);
    if (supply > 0n) await db.harborSnapshot.create({ data: { at, totalAssets: (Number(assets) / 1e6).toFixed(6), totalSupply: (Number(supply) / 1e6).toFixed(6) } });

    let n = 0;
    for (const account of await accounts()) {
      const s = await readAccount(account);
      if (s.collateral === 0 && s.positions.length === 0) continue;
      // skip accounts whose open markets have no fresh price: their equity would be wrong
      if (s.positions.some((p) => prices[feedOf(p.marketId)] === undefined)) continue;
      const h = accountHealth(s.collateral, s.positions, prices);
      await db.accountSnapshot.create({
        data: { account, at, equity: h.equity.toFixed(6), collateral: s.collateral.toFixed(6), upnl: (h.equity - s.collateral).toFixed(6), notional: h.notional.toFixed(6), maintenance: h.mm.toFixed(6) },
      });
      n++;
    }
    return { snapshots: n };
  }

  // ───────── Riptide Alerts ─────────

  async function deliver(sub: { id: string; channel: string; target: unknown }, title: string, body: string) {
    const url = `${env.SITE_URL}/terminal/portfolio#lifeline`;
    if (sub.channel === "push" && pushOn) {
      try {
        await webpush.sendNotification(sub.target as webpush.PushSubscription, JSON.stringify({ title, body, url }), { TTL: 3600 });
      } catch (e) {
        // the browser dropped this subscription; forget it
        if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) await db.alertSubscription.delete({ where: { id: sub.id } });
        throw e;
      }
    } else if (sub.channel === "telegram" && channels.telegram) {
      const chatId = (sub.target as { chatId?: number }).chatId;
      if (!chatId) return false;
      await telegram("sendMessage", { chat_id: chatId, text: `${title}\n${body}\n${url}` });
    } else if (sub.channel === "email" && channels.email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.ALERT_EMAIL_FROM, to: (sub.target as { email: string }).email, subject: title, text: `${body}\n\n${url}` }),
      });
      if (!res.ok) throw new Error(`email ${res.status}`);
    } else return false;
    return true;
  }

  async function riptide() {
    const subs = await db.alertSubscription.findMany();
    const prices = d.prices();
    const byAccount = new Map<string, typeof subs>();
    for (const s of subs) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s]);
    let sent = 0;
    for (const [account, list] of byAccount) {
      const s = await readAccount(account as Address);
      if (s.positions.length === 0 || s.positions.some((p) => prices[feedOf(p.marketId)] === undefined)) continue;
      const h = accountHealth(s.collateral, s.positions, prices);
      for (const sub of list) {
        const quiet = sub.lastSentAt && Date.now() - sub.lastSentAt.getTime() < 30 * 60_000;
        const deeper = sub.lastLevel === null || h.level < sub.lastLevel - 0.1;
        if (h.level >= sub.threshold || (quiet && !deeper)) continue;
        const pct = Math.round(h.level * 100);
        const title = pct <= 10 ? `Riptide: ${pct}% above the sea wall` : `Riptide: margin down to ${pct}%`;
        const body = `Equity $${h.equity.toFixed(2)} vs maintenance $${h.mm.toFixed(2)}. Throw a Lifeline: Inflow tdUSD from any chain before the tide reaches the wall.`;
        try {
          if (await deliver(sub, title, body)) {
            await db.alertSubscription.update({ where: { id: sub.id }, data: { lastSentAt: new Date(), lastLevel: h.level } });
            sent++;
          }
        } catch (e) {
          log(`riptide ${sub.channel} ${account.slice(0, 8)}: ${(e as Error).message}`);
        }
      }
    }
    return { alertSubs: subs.length, alertsSent: sent };
  }

  // ───────── Telegram linking: "/start <code>" binds the chat to a pending subscription ─────────

  let updateOffset = 0;
  async function telegram(method: string, body: unknown) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`telegram ${method} ${res.status}`);
    return (await res.json()) as { result: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
  }

  async function telegramLink() {
    if (!channels.telegram) return;
    const { result } = await telegram("getUpdates", { offset: updateOffset, timeout: 0 });
    for (const u of result) {
      updateOffset = u.update_id + 1;
      const code = u.message?.text?.match(/^\/start\s+([a-z0-9]{8,32})$/i)?.[1];
      if (!code || !u.message) continue;
      const sub = (await db.alertSubscription.findMany({ where: { channel: "telegram" } })).find((s) => (s.target as { code?: string }).code === code);
      if (!sub) continue;
      await db.alertSubscription.update({ where: { id: sub.id }, data: { target: { code, chatId: u.message.chat.id } } });
      await telegram("sendMessage", { chat_id: u.message.chat.id, text: `Riptide Alerts linked for ${sub.account.slice(0, 6)}…${sub.account.slice(-4)}. You'll hear from us when margin drops below ${Math.round(sub.threshold * 100)}%.` });
    }
  }

  // ───────── signed subscription requests, forwarded by the web app ─────────

  const Request = z.object({
    action: z.enum(["subscribe", "unsubscribe"]),
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    channel: z.enum(RIPTIDE_CHANNELS),
    threshold: z.number().min(0.05).max(0.9),
    deliverTo: z.string().min(1).max(200),
    issuedAt: z.string().datetime(),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
    target: z.union([
      z.object({ endpoint: z.string().url().startsWith("https://"), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
      z.object({ email: z.string().email().max(200) }),
      z.object({ code: z.string().regex(/^[a-z0-9]{8,32}$/i) }),
    ]).optional(),
  });

  async function handleRequest(raw: unknown) {
    const r = Request.parse(raw);
    if (!channels[r.channel]) return { status: 400, body: { error: `${r.channel} alerts are not enabled` } };
    const age = Date.now() - Date.parse(r.issuedAt);
    if (age < -60_000 || age > 10 * 60_000) return { status: 400, body: { error: "signature expired, sign again" } };
    const ok = await verifyMessage({ address: r.account as Address, message: riptideMessage(r), signature: r.signature as `0x${string}` });
    if (!ok) return { status: 401, body: { error: "signature does not match the account" } };
    const account = r.account.toLowerCase();
    if (r.action === "unsubscribe") {
      await db.alertSubscription.deleteMany({ where: { account, channel: r.channel } });
      return { status: 200, body: { ok: true } };
    }
    const t = r.target;
    const fits = r.channel === "push" ? t && "endpoint" in t : r.channel === "email" ? t && "email" in t && t.email === r.deliverTo : t && "code" in t;
    if (!t || !fits) return { status: 400, body: { error: "target does not match the channel" } };
    const data = { threshold: r.threshold, target: t, lastSentAt: null, lastLevel: null };
    await db.alertSubscription.upsert({ where: { account_channel: { account, channel: r.channel } }, create: { account, channel: r.channel, ...data }, update: data });
    return { status: 200, body: { ok: true } };
  }

  async function listFor(account: string) {
    const subs = await db.alertSubscription.findMany({ where: { account: account.toLowerCase() } });
    // never echo targets back: only what the UI needs to show state
    return subs.map((s) => ({ channel: s.channel, threshold: s.threshold, linked: s.channel !== "telegram" || !!(s.target as { chatId?: number }).chatId, lastSentAt: s.lastSentAt }));
  }

  // ───────── Tide Chart: pay for one lzRead from Arbitrum on a schedule ─────────

  async function tideRead() {
    const a = d.arb;
    if (!a) return;
    const fee = await a.pub.readContract({ address: a.reader, abi: omnitideTideReaderAbi, functionName: "quote" });
    const hash = await a.wallet.writeContract({ address: a.reader, abi: omnitideTideReaderAbi, functionName: "refresh", value: (fee * 12n) / 10n, chain: a.wallet.chain, account: a.wallet.account });
    log(`lzRead requested ${hash}`);
    return { lastTideRead: hash };
  }

  return { channels, snapshot, riptide, telegramLink, handleRequest, listFor, tideRead };
}

const feedOf = (marketId: number) => MARKETS[marketId]?.feed ?? "";
