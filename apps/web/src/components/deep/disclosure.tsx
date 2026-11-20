"use client";

import { useState } from "react";
import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { parseDisclosureKey } from "@omnitide/contracts/deep";
import { HUB_KEY, explorerTx } from "@/lib/chains";
import { MARKETS } from "@/lib/contracts";
import { openSeals, useDeepNotes } from "@/lib/deep";
import { csv, download } from "@/lib/report";
import { ago, money, price as fmtPrice, shortHash, signedMoney, units6, wad } from "@/lib/format";

export function DisclosureViewer() {
  const [input, setInput] = useState("");
  const parsed = parseDisclosureKey(input);
  const notes = useDeepNotes(parsed?.id);
  const seals = parsed && notes.data ? openSeals(notes.data, parsed.viewPrivate) : [];
  const readable = seals.filter((s) => s.book);
  const latest = readable[0]?.book;
  const allVerified = readable.length > 0 && readable.every((s) => s.verified);
  const flows = (notes.data ?? []).filter((n) => n.kind !== "seal");

  function exportCsv() {
    if (!latest || !parsed) return;
    const rows = latest.history.map((f) => [new Date(f.at * 1000).toISOString(), f.kind, f.marketId !== undefined ? `${MARKETS[f.marketId]?.symbol}-PERP` : "", f.sizeDelta ? wad(f.sizeDelta) : "", f.price ? wad(f.price) : "", units6(f.amount), f.fee ? units6(f.fee) : "", f.tx ?? ""]);
    download(`omnitide-deep-${parsed.id.slice(2, 10)}.csv`, csv(["time", "kind", "market", "size", "price", "amount_or_pnl_tdusd", "fee_tdusd", "tx"], rows));
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <label className="block rounded-2xl border border-line bg-card p-5">
          <span className="font-medium">Disclosure Key</span>
          <textarea
            className="field mt-3 h-24 resize-none py-3 font-mono text-[12px] leading-5"
            placeholder="dk1_…"
            spellCheck={false}
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value.trim())}
          />
          {input && !parsed && <span className="mt-2 block text-[13px] text-ebb">That isn't a Disclosure Key. It starts with dk1_ followed by 128 hex characters.</span>}
        </label>

        {parsed && notes.isLoading && <div className="h-40 animate-pulse rounded-2xl bg-raised" />}

        {parsed && notes.data && readable.length === 0 && (
          <div className="rounded-2xl border border-line bg-card p-5 text-[14px] leading-[22px] text-ink-2">
            {notes.data.length ? "The chain holds seals for this Deep id, but this key can't open them. Check that the key wasn't cut short." : "No seals for this Deep id yet. The first one lands shortly after the first deposit."}
          </div>
        )}

        {latest && (
          <>
            <div className="rounded-2xl border border-line bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-[12px] text-ink-3">{shortHash(parsed!.id)}</p>
                <span className={`tag inline-flex items-center gap-1.5 ${allVerified ? "text-flood" : "text-warn"}`}>
                  {allVerified ? <ShieldCheck size={14} strokeWidth={1.75} /> : <ShieldX size={14} strokeWidth={1.75} />}
                  {allVerified ? `all ${readable.length} seals match their on-chain commitments` : "some seals don't match the chain"}
                </span>
              </div>
              <dl className="mt-5 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
                {[
                  ["Collateral", money(units6(latest.collateral))],
                  ["Realized PnL", signedMoney(units6(latest.realized))],
                  ["Fees paid", money(units6(latest.fees))],
                  ["Open positions", String(latest.positions.length || "flat")],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-[140px] flex-1 bg-card p-4">
                    <dt className="text-[13px] text-ink-3">{k}</dt>
                    <dd className="num mt-1 text-[22px] leading-8 font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              {latest.positions.length > 0 && (
                <ul className="mt-4 space-y-1 text-[13px]">
                  {latest.positions.map((p) => (
                    <li key={p.marketId} className="num flex justify-between">
                      <span>
                        {MARKETS[p.marketId]?.symbol}-PERP {wad(p.size) > 0 ? "long" : "short"} {Math.abs(wad(p.size)).toPrecision(5)}
                      </span>
                      <span className="text-ink-2">entry {fmtPrice(wad(p.entry))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-line bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
                <h2 className="text-[20px] font-medium">Book history</h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
              <div className="relative mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[13px]">
                  <thead className="text-[12px] text-ink-3">
                    <tr>
                      {["Event", "Market", "Price", "tdUSD", "When", "Tx"].map((h) => (
                        <th key={h} className="px-5 py-2 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {latest.history.map((f, i) => (
                      <tr key={`${f.at}-${i}`} className="border-t border-line">
                        <td className="px-5 py-3 font-medium capitalize">{f.kind}</td>
                        <td className="px-5 py-3">{f.marketId !== undefined ? `${MARKETS[f.marketId]?.symbol} ${f.sizeDelta && BigInt(f.sizeDelta) > 0n ? "buy" : "sell"}` : ""}</td>
                        <td className="num px-5 py-3">{f.price ? fmtPrice(wad(f.price)) : ""}</td>
                        <td className="num px-5 py-3">{f.kind === "trade" ? signedMoney(units6(f.amount)) : money(units6(f.amount))}</td>
                        <td className="px-5 py-3 text-ink-3">{ago(f.at)}</td>
                        <td className="px-5 py-3">
                          {f.tx && (
                            <a href={explorerTx(HUB_KEY, f.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                              {shortHash(f.tx)}
                              <ExternalLink size={12} strokeWidth={1.5} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="flex flex-col gap-3">
        {readable.length > 0 ? (
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="font-medium">Seal chain</p>
            <ol className="mt-3 space-y-2">
              {seals.slice(0, 24).map((s) => (
                <li key={s.note.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="num text-ink-2">#{s.note.nonce}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-ink-3">{s.note.commitment}</span>
                  {s.verified ? <ShieldCheck size={14} strokeWidth={1.75} className="shrink-0 text-flood" aria-label="verified" /> : <ShieldX size={14} strokeWidth={1.75} className="shrink-0 text-warn" aria-label="not verified" />}
                </li>
              ))}
            </ol>
            {flows.length > 0 && <p className="mt-3 text-[12px] text-ink-3">{flows.length} public deposit and withdrawal events on this id</p>}
          </div>
        ) : null}
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">How the check works</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Every seal on OmnitideDeepPool carries a ciphertext and keccak256(id, nonce, collateral, flat, detailHash).</li>
            <li>The view key unwraps the AES-256-GCM content key with x25519 and decrypts the book.</li>
            <li>This page re-hashes each decrypted book and compares it to the commitment stored with that seal.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
