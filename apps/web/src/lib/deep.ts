"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSignTypedData, useSwitchChain } from "wagmi";
import type { Address, Hex } from "viem";
import { DEEP_INTENT_TYPES, DEEP_MESSAGE, DEEP_WITHDRAWAL_TYPES, deepCommitment, deepId, deepIntentDomain, deriveDeepKeys, open, type DeepBook, type DeepKeys } from "@omnitide/contracts/deep";
import { HUB } from "./chains";

export interface DeepNote {
  id: string;
  deepId: Hex;
  kind: "deposit" | "seal" | "withdraw" | "exit-request" | "exit";
  amount: string | null;
  eid: number | null;
  nonce: number | null;
  commitment: Hex | null;
  ciphertext: Hex | null;
  timestamp: number;
  tx: Hex;
}

export interface Unlocked extends DeepKeys {
  id: Hex;
  owner: Address;
}

const KEY = (a: string) => `omnitide.deep.${a.toLowerCase()}`;

// the view key never leaves this tab: session storage only, gone when the tab closes
function load(owner: string): Unlocked | null {
  try {
    const raw = sessionStorage.getItem(KEY(owner));
    return raw ? (JSON.parse(raw) as Unlocked) : null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/keeper/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "The keeper turned that down");
  return json;
}

/** Deep keys for the connected wallet: one signature derives the Deep id and view key, the keeper learns the public half. */
export function useDeepKeys() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [keys, setKeys] = useState<Unlocked | null>(null);

  useEffect(() => setKeys(address ? load(address) : null), [address]);

  async function unlock() {
    if (!address) return;
    const signature = await signMessageAsync({ message: DEEP_MESSAGE });
    const k = deriveDeepKeys(signature);
    const id = deepId(address, k.salt);
    if (chainId !== HUB.chainId) await switchChainAsync({ chainId: HUB.chainId });
    const reg = await signTypedDataAsync({ domain: deepIntentDomain(HUB.chainId), types: DEEP_INTENT_TYPES, primaryType: "DeepRegister", message: { id, salt: k.salt, viewKey: k.viewPublic } });
    await post("deep/register", { owner: address, id, salt: k.salt, viewKey: k.viewPublic, signature: reg });
    const u = { ...k, id, owner: address };
    try {
      sessionStorage.setItem(KEY(address), JSON.stringify(u));
    } catch {
      // private window: keys live for this page view only
    }
    setKeys(u);
  }

  function lock() {
    if (address)
      try {
        sessionStorage.removeItem(KEY(address));
      } catch {}
    setKeys(null);
  }

  return { keys, unlock, lock };
}

export interface OpenedSeal {
  note: DeepNote;
  book: DeepBook | null;
  verified: boolean; // the decrypted book hashes to the commitment the chain holds
}

/** Every seal for a Deep id, opened with the view key and checked against its on-chain commitment. */
export function openSeals(notes: DeepNote[], viewPrivate: Hex): OpenedSeal[] {
  return notes
    .filter((n) => n.kind === "seal")
    .map((note) => {
      const text = note.ciphertext && note.ciphertext !== "0x" ? open(viewPrivate, note.ciphertext) : null;
      const book = text ? (JSON.parse(text) as DeepBook) : null;
      return { note, book, verified: !!book && !!note.commitment && deepCommitment(book) === note.commitment };
    });
}

export function useDeepNotes(id: Hex | undefined) {
  return useQuery({
    queryKey: ["deep-notes", id],
    enabled: !!id,
    refetchInterval: 6_000,
    queryFn: async () => {
      const res = await fetch(`/api/indexer/deep/${id}?limit=200`);
      if (!res.ok) throw new Error("indexer unavailable");
      return (await res.json()) as DeepNote[];
    },
  });
}

/** The newest readable book plus whether the keeper still has changes to seal. */
export function useDeepBook(keys: Unlocked | null) {
  const notes = useDeepNotes(keys?.id);
  const status = useQuery({
    queryKey: ["deep-status", keys?.id],
    enabled: !!keys,
    refetchInterval: 5_000,
    queryFn: async () => (await (await fetch(`/api/keeper/deep/status?id=${keys!.id}`)).json()) as { registered: boolean; sealing: boolean; intentNonce: number },
  });
  const seals = keys && notes.data ? openSeals(notes.data, keys.viewPrivate) : [];
  const latest = seals.find((s) => s.book);
  return { notes: notes.data ?? [], seals, book: latest?.book ?? null, verified: latest?.verified ?? false, status: status.data, loading: notes.isLoading };
}

export function useDeepActions(keys: Unlocked | null) {
  const { chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();

  async function onHub() {
    if (chainId !== HUB.chainId) await switchChainAsync({ chainId: HUB.chainId });
  }

  async function trade(marketId: number, sizeDelta: bigint, priceLimit: bigint) {
    if (!keys) throw new Error("Unlock Deep Mode first");
    await onHub();
    const status = (await (await fetch(`/api/keeper/deep/status?id=${keys.id}`)).json()) as { intentNonce: number };
    const message = { id: keys.id, marketId, sizeDelta, priceLimit, nonce: BigInt(status.intentNonce + 1), deadline: BigInt(Math.floor(Date.now() / 1000) + 120) };
    const signature = await signTypedDataAsync({ domain: deepIntentDomain(HUB.chainId), types: DEEP_INTENT_TYPES, primaryType: "DeepTrade", message });
    const r = await post<{ tx: Hex }>("deep/trade", { ...message, nonce: Number(message.nonce), deadline: Number(message.deadline), signature });
    await qc.invalidateQueries({ queryKey: ["deep-status"] });
    return r.tx;
  }

  async function withdraw(amount: bigint, pool: Address) {
    if (!keys) throw new Error("Unlock Deep Mode first");
    await onHub();
    const w = { salt: keys.salt, amount, dstEid: HUB.eid, receiver: keys.owner, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    const signature = await signTypedDataAsync({ domain: { name: "OMNITIDE Deep Pool", version: "1", chainId: HUB.chainId, verifyingContract: pool }, types: DEEP_WITHDRAWAL_TYPES, primaryType: "DeepWithdrawal", message: w });
    const r = await post<{ tx: Hex }>("deep/withdraw", { w: { ...w, owner: keys.owner, deadline: Number(w.deadline) }, signature });
    await qc.invalidateQueries();
    return r.tx;
  }

  return { trade, withdraw };
}
