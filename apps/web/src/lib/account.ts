"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { erc20Abi, type Address, type Hex } from "viem";
import { MARKETS } from "@omnitide/contracts/markets";
import { CLEARINGHOUSE, omnitideClearinghouseAbi, omnitidePortAbi, omnitideUSDAbi, portOf, usdAddress } from "./contracts";
import { HUB, HUB_KEY, chainKeyOf } from "./chains";
import type { Pos } from "./margin";

export interface ChainReport {
  feed: Hex;
  price: bigint;
  timestamp: bigint;
  signature: Hex;
}

/** Fresh signed reports from the keeper for the given feeds, in contract struct form. */
export async function fetchReports(feeds: string[]): Promise<ChainReport[]> {
  const unique = [...new Set(feeds)];
  if (unique.length === 0) return [];
  const res = await fetch(`/api/reports?feeds=${unique.join(",")}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Price service is catching its breath, try again in a few seconds");
  const { reports } = (await res.json()) as { reports: { feed: Hex; price: string; timestamp: number; signature: Hex }[] };
  return reports.map((r) => ({ feed: r.feed, price: BigInt(r.price), timestamp: BigInt(r.timestamp), signature: r.signature }));
}

export interface HubAccount {
  collateral: number; // tdUSD
  collateralRaw: bigint;
  positions: (Pos & { sizeRaw: bigint })[];
  openOrders: number;
  hubWallet: number; // tdUSD in the wallet on the hub
}

/** Live account state on the hub clearinghouse, polled straight from the chain. */
export function useHubAccount() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: HUB.chainId });
  return useQuery({
    queryKey: ["hub-account", address],
    enabled: !!address && !!client,
    refetchInterval: 4_000,
    queryFn: async (): Promise<HubAccount> => {
      const a = address as Address;
      const read = <T,>(functionName: string, args: unknown[]) =>
        client!.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const [bal, open, orders, wallet] = await Promise.all([
        read<bigint>("balances", [a]),
        read<readonly number[]>("openMarkets", [a]),
        read<bigint>("openOrderCount", [a]),
        client!.readContract({ address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "balanceOf", args: [a] }),
      ]);
      const positions = await Promise.all(
        open.map(async (id) => {
          const [size, entry] = await read<readonly [bigint, bigint]>("positions", [a, id]);
          return { marketId: Number(id), size: Number(size) / 1e18, entry: Number(entry) / 1e18, sizeRaw: size };
        }),
      );
      return { collateral: Number(bal) / 1e6, collateralRaw: bal, positions: positions.filter((p) => p.sizeRaw !== 0n), openOrders: Number(orders), hubWallet: Number(wallet) / 1e6 };
    },
  });
}

/** tdUSD in the wallet, faucet cooldown and (mainnet) the chain's stablecoin Port, on whichever OMNITIDE chain the wallet is on. */
export function useLocalToken(chainId: number | undefined) {
  const { address } = useAccount();
  const key = chainKeyOf(chainId);
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["local-token", address, chainId],
    enabled: !!address && !!key && !!client,
    refetchInterval: 6_000,
    queryFn: async () => {
      const token = usdAddress(key!);
      const a = address as Address;
      const port = portOf(key!);
      const [balance, last, stable, allowance, reserve] = await Promise.all([
        client!.readContract({ address: token, abi: omnitideUSDAbi, functionName: "balanceOf", args: [a] }),
        client!.readContract({ address: token, abi: omnitideUSDAbi, functionName: "lastDrip", args: [a] }),
        port ? client!.readContract({ address: port.stable, abi: erc20Abi, functionName: "balanceOf", args: [a] }) : 0n,
        port ? client!.readContract({ address: port.stable, abi: erc20Abi, functionName: "allowance", args: [a, port.port] }) : 0n,
        port ? client!.readContract({ address: port.port, abi: omnitidePortAbi, functionName: "reserve" }) : 0n,
      ]);
      const nextDrip = last === 0n ? 0 : Number(last) + 86_400;
      return { chain: key!, balance: Number(balance) / 1e6, balanceRaw: balance, nextDrip, port, stable: Number(stable) / 1e6, stableRaw: stable, stableAllowance: allowance, reserve: Number(reserve) / 1e6, reserveRaw: reserve };
    },
  });
}

/** Feeds the clearinghouse needs prices for when this account acts (all open markets plus `extra`). */
export function feedsFor(positions: { marketId: number }[], extra?: string) {
  const feeds = positions.map((p) => MARKETS[p.marketId]!.feed);
  return extra ? [...feeds, extra] : feeds;
}
