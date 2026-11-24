"use client";

import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, ContractFunctionRevertedError, type Abi } from "viem";
import { toast } from "@/components/toasts";
import { chainKeyOf, explorerTx } from "./chains";
import { GOV } from "./contracts";

const FRIENDLY: Record<string, string> = {
  InsufficientMargin: "Not enough free margin for that size",
  InsufficientBalance: "Not enough collateral in the account",
  TriggerNotMet: "Trigger price not reached yet",
  ZeroAmount: "Enter an amount first",
  SlippageExceeded: "Price moved past your limit, try again",
  MissingPrice: "A price report was missing, try again",
  StaleReport: "Price report expired before the block, try again",
  DripCooldown: "Faucet refills once a day per address",
  RateLimitExceeded: "This lane's hourly limit is used up, try a smaller amount",
  DepositCapReached: "Deposit cap reached for now",
  TooManyPositions: "Eight open markets is the most one account can hold",
  TooManyOrders: "Sixteen open orders is the limit, cancel one first",
  OpenInterestCap: "This market's open-interest cap is full on that side",
  PausedIncrease: "The guardian paused new risk; closing still works",
  EnforcedPause: "The guardian paused this action for now",
  LimitNotSealable: "Only stop-loss and take-profit orders can be sealed",
  BadReveal: "The sealed order doesn't match its commitment",
  AlreadyClaimed: "This badge is already in your collection",
  BadAttestation: "The keeper's attestation didn't verify, ask for a fresh one",
  Expired: "That signature expired, try again",
  Stale: "A newer Lighthouse beam already shines for this account",
  NoWeight: `Stake ${GOV} before the proposal opens to vote on it`,
  AlreadyVoted: "This wallet already voted on that proposal",
  VotingClosed: "Voting on that proposal is closed",
  BelowThreshold: `Proposing needs 1,000 staked ${GOV} on Robinhood Chain`,
  Locked: "Stake stays locked until the proposals you voted on close",
  SeedTooSmall: "Seed the vault with at least the factory minimum of your own tdUSD",
  FeeLocked: "Leader fees top out at 20% and can only go down once a vault opens",
  NotLeader: "Only the vault's leader can trade it",
  NothingPending: "No queued deposits left to settle",
  ExitNotReady: "The 24h exit window hasn't passed yet",
  BadPreimage: "That isn't the latest sealed state of this book",
  FaucetClosed: `The ${GOV} faucet is closed`,
  FeeTooLow: "The LayerZero fee moved, try again",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name) return FRIENDLY[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (/rejected|denied/i.test(e.shortMessage)) return "Signature declined in the wallet";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

interface Call {
  chainId: number;
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/** Switch chain if needed, send, wait for the receipt, toast each stage, then refresh queries. */
export function useTx() {
  const config = useConfig();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const qc = useQueryClient();

  async function send(label: string, call: Call) {
    const id = toast.push({ kind: "pending", title: label, body: "Confirm in your wallet" });
    try {
      if (chainId !== call.chainId) await switchChainAsync({ chainId: call.chainId });
      const hash = await writeContractAsync(call as never);
      const key = chainKeyOf(call.chainId);
      toast.update(id, { body: "Waiting for the block", href: key ? explorerTx(key, hash) : undefined });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: call.chainId });
      if (receipt.status !== "success") throw new Error("Transaction reverted on-chain");
      toast.update(id, { kind: "success", body: "Confirmed" });
      await qc.invalidateQueries();
      return hash;
    } catch (e) {
      toast.update(id, { kind: "error", body: explain(e) });
      throw e;
    }
  }

  return { send, busy: isPending };
}
