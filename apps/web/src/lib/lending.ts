"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { HUB } from "./chains";
import { LENDING, omnitideLendingAbi } from "./contracts";

export interface RateModel {
  baseRate: number; // APR, fraction
  kinkRate: number;
  maxRate: number;
  kink: number; // utilisation, fraction
}

/** Borrow APR at a utilisation (fractions), as OmnitideLending.borrowRate. */
export function borrowApr(m: RateModel, util: number): number {
  const u = Math.max(0, Math.min(1, util));
  if (u <= m.kink) return m.baseRate + ((m.kinkRate - m.baseRate) * u) / m.kink;
  return m.kinkRate + ((m.maxRate - m.kinkRate) * (u - m.kink)) / (1 - m.kink);
}

/** Lender APR: what borrowers pay, spread over everything supplied, less the Tide Pool's cut. */
export const supplyApr = (m: RateModel, util: number, reserve: number) => borrowApr(m, util) * Math.max(0, Math.min(1, util)) * (1 - reserve);

/** ETH price at which a loan crosses the liquidation line; null with no debt or no collateral. */
export function liquidationPrice(debt: number, eth: number, liquidation: number): number | null {
  return debt > 0 && eth > 0 ? debt / (eth * liquidation) : null;
}

/** How far the loan sits from liquidation as a 0–1 level for the gauge: 1 = no debt, 0 = at the line. */
export function anchorHold(debt: number, ethValue: number, liquidation: number): number {
  if (debt <= 0) return 1;
  const limit = ethValue * liquidation;
  return limit <= 0 ? 0 : Math.max(0, Math.min(1, 1 - debt / limit));
}

/** tdUSD still borrowable against `eth` at `price`, after what is already owed. */
export const borrowRoom = (eth: number, price: number, ltv: number, debt: number) => Math.max(0, eth * price * ltv - debt);

const WAD = 1e18;
const bps = (v: number) => v / 10_000;

export interface LendingLive {
  supplied: number; // tdUSD
  borrowed: number;
  cash: number;
  ethLocked: number;
  util: number; // fraction
  model: RateModel;
  ltv: number;
  liquidation: number;
  bonus: number;
  reserve: number;
  supplyCap: number;
  borrowCap: number;
}

export function useLendingLive() {
  const client = usePublicClient({ chainId: HUB.chainId });
  return useQuery({
    queryKey: ["lending-live"],
    enabled: !!client && !!LENDING,
    refetchInterval: 12_000,
    queryFn: async (): Promise<LendingLive> => {
      const c = { address: LENDING, abi: omnitideLendingAbi } as const;
      const [supplied, borrowed, cash, ethLocked, util, p] = await Promise.all([
        client!.readContract({ ...c, functionName: "totalAssets" }),
        client!.readContract({ ...c, functionName: "totalDebt" }),
        client!.readContract({ ...c, functionName: "cash" }),
        client!.readContract({ ...c, functionName: "totalCollateral" }),
        client!.readContract({ ...c, functionName: "utilization" }),
        client!.readContract({ ...c, functionName: "params" }),
      ]);
      const [ltvBps, liquidationBps, bonusBps, reserveBps, , baseRate, kinkRate, maxRate, kinkBps, supplyCap, borrowCap] = p;
      return {
        supplied: Number(supplied) / 1e6,
        borrowed: Number(borrowed) / 1e6,
        cash: Number(cash) / 1e6,
        ethLocked: Number(ethLocked) / WAD,
        util: bps(Number(util)),
        model: { baseRate: Number(baseRate) / WAD, kinkRate: Number(kinkRate) / WAD, maxRate: Number(maxRate) / WAD, kink: bps(kinkBps) },
        ltv: bps(ltvBps),
        liquidation: bps(liquidationBps),
        bonus: bps(bonusBps),
        reserve: bps(reserveBps),
        supplyCap: Number(supplyCap) / 1e6,
        borrowCap: Number(borrowCap) / 1e6,
      };
    },
  });
}

export interface LendingMine {
  eth: number;
  ethRaw: bigint;
  debt: number;
  debtRaw: bigint;
  shares: bigint;
  lent: number; // tdUSD value of the shares
  maxWithdraw: bigint;
}

export function useLendingMine() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: HUB.chainId });
  return useQuery({
    queryKey: ["lending-mine", address],
    enabled: !!client && !!address && !!LENDING,
    refetchInterval: 10_000,
    queryFn: async (): Promise<LendingMine> => {
      const c = { address: LENDING, abi: omnitideLendingAbi } as const;
      const who = address as Address;
      const [acct, debt, shares, maxWithdraw] = await Promise.all([
        client!.readContract({ ...c, functionName: "accounts", args: [who] }),
        client!.readContract({ ...c, functionName: "debtOf", args: [who] }),
        client!.readContract({ ...c, functionName: "balanceOf", args: [who] }),
        client!.readContract({ ...c, functionName: "maxWithdraw", args: [who] }),
      ]);
      const lent = shares > 0n ? await client!.readContract({ ...c, functionName: "convertToAssets", args: [shares] }) : 0n;
      return { eth: Number(acct[0]) / WAD, ethRaw: acct[0], debt: Number(debt) / 1e6, debtRaw: debt, shares, lent: Number(lent) / 1e6, maxWithdraw };
    },
  });
}
