"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { BellRing, Mail, Send } from "lucide-react";
import { riptideMessage, type RiptideChannel, type RiptideRequest } from "@omnitide/contracts/riptide";
import { toast } from "../toasts";
import { explain } from "@/lib/tx";

interface AlertState {
  channels: Record<RiptideChannel, boolean>;
  vapidPublicKey: string | null;
  telegramBot: string | null;
  subscriptions: { channel: RiptideChannel; threshold: number; linked: boolean; lastSentAt: string | null }[];
}

const LEVELS = [0.5, 0.35, 0.2] as const;
const LABEL: Record<RiptideChannel, string> = { push: "Browser push", telegram: "Telegram", email: "Email" };
const ICON = { push: BellRing, telegram: Send, email: Mail };

function vapidKey(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Riptide Alerts: the keeper watches your tide gauge and pings you before the sea wall. */
export function RiptidePanel() {
  const { address } = useAccount();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [level, setLevel] = useState<number>(0.35);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<RiptideChannel | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const { data, isError } = useQuery({
    queryKey: ["alerts", address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const res = await fetch(`/api/alerts?account=${address}`, { cache: "no-store" });
      if (!res.ok) throw new Error("alerts unavailable");
      return (await res.json()) as AlertState;
    },
  });

  async function submit(r: Omit<RiptideRequest, "account" | "issuedAt">, target?: unknown) {
    const req: RiptideRequest = { ...r, account: address!.toLowerCase(), issuedAt: new Date().toISOString() };
    const signature = await signMessageAsync({ message: riptideMessage(req) });
    const res = await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...req, signature, target }) });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? "alert request failed");
    await qc.invalidateQueries({ queryKey: ["alerts", address] });
  }

  async function run(channel: RiptideChannel, fn: () => Promise<void>, done: string) {
    setBusy(channel);
    try {
      await fn();
      toast.push({ kind: "success", title: "Riptide Alerts", body: done });
    } catch (e) {
      toast.push({ kind: "error", title: "Riptide Alerts", body: explain(e) });
    } finally {
      setBusy(null);
    }
  }

  const subscribe = (channel: RiptideChannel) =>
    run(
      channel,
      async () => {
        if (channel === "push") {
          if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser can't receive push alerts");
          if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site");
          const reg = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
          const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(data!.vapidPublicKey!) }));
          await submit({ action: "subscribe", channel, threshold: level, deliverTo: "this browser" }, sub.toJSON());
        } else if (channel === "email") {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email first");
          await submit({ action: "subscribe", channel, threshold: level, deliverTo: email }, { email });
        } else {
          const code = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join("");
          await submit({ action: "subscribe", channel, threshold: level, deliverTo: `Telegram code ${code}` }, { code });
          setTelegramCode(code);
        }
      },
      channel === "telegram" ? "Now open the bot and press Start to link this chat" : `${LABEL[channel]} alerts armed below ${Math.round(level * 100)}%`,
    );

  const remove = (channel: RiptideChannel, threshold: number) => run(channel, () => submit({ action: "unsubscribe", channel, threshold, deliverTo: LABEL[channel] }), `${LABEL[channel]} alerts removed`);

  const enabled = data ? (Object.keys(data.channels) as RiptideChannel[]).filter((c) => data.channels[c]) : [];
  const active = new Map((data?.subscriptions ?? []).map((s) => [s.channel, s]));

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <p className="tag text-ink-3">Keeper-watched · checked every minute</p>
      <h2 className="mt-1 text-[20px] font-medium">Riptide Alerts</h2>
      <p className="mt-2 text-[13px] leading-5 text-ink-2">Pick how low the tide may run. The keeper reads your account on Robinhood Chain every minute and pings you, with a Lifeline link, the moment margin drops under that line.</p>
      {!address ? (
        <p className="mt-4 text-[13px] text-ink-3">Connect a wallet to arm alerts for it.</p>
      ) : isError ? (
        <p className="mt-4 text-[13px] text-ink-3">The alert desk is reconnecting to the keeper. Try again in a moment.</p>
      ) : !data ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-raised" />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Alert level">
            <span className="text-[13px] text-ink-3">Alert below</span>
            {LEVELS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)} className={`btn btn-sm ${level === l ? "bg-raised text-ink" : "btn-ghost"}`}>
                {Math.round(l * 100)}%
              </button>
            ))}
          </div>
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {enabled.map((c) => {
              const Icon = ICON[c];
              const sub = active.get(c);
              return (
                <li key={c} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Icon size={16} strokeWidth={1.5} className="text-ink-3" />
                  <span className="min-w-28 text-[14px]">{LABEL[c]}</span>
                  {c === "email" && !sub && <input className="field h-8 max-w-56 flex-1 text-[13px]" type="email" placeholder="you@desk.xyz" value={email} onChange={(e) => setEmail(e.target.value)} />}
                  <span className="flex-1" />
                  {sub ? (
                    <>
                      <span className="tag text-flood">{sub.linked ? `armed · below ${Math.round(sub.threshold * 100)}%` : "waiting for /start"}</span>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void remove(c, sub.threshold)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void subscribe(c)}>
                      {busy === c ? "Signing…" : "Arm"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {telegramCode && data.telegramBot && (
            <a className="btn btn-primary btn-sm mt-3" href={`https://t.me/${data.telegramBot}?start=${telegramCode}`} target="_blank" rel="noreferrer">
              Open @{data.telegramBot} and press Start
            </a>
          )}
          <p className="tag mt-3 text-ink-3">Each change is a free wallet signature, no transaction. Targets are never shown back.</p>
        </>
      )}
    </section>
  );
}
