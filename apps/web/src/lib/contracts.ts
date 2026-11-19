import type { Address } from "viem";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";

import { omnitideClearinghouseAbi, omnitideOracleAbi } from "@omnitide/contracts/abi";
export { omnitideClearinghouseAbi, omnitideUSDAbi, omnitideOracleAbi } from "@omnitide/contracts/abi";

/** Clearinghouse ABI plus the oracle's errors, so reverts from price checks decode by name. */
export const CH_ABI = [...omnitideClearinghouseAbi, ...omnitideOracleAbi.filter((x) => x.type === "error")] as const;
export { MARKETS };

const D = DEPLOYMENTS.testnet;

// callers only pass live chains (CHAIN_KEYS), and the hub is always deployed
export const usdAddress = (k: ChainKey) => D[k]!.OmnitideUSD!.proxy as Address;
export const CLEARINGHOUSE = D.robinhoodTestnet!.OmnitideClearinghouse!.proxy as Address;
export const ORACLE = D.robinhoodTestnet!.OmnitideOracle!.proxy as Address;

/** Every proxy and its implementation, for the contracts section. */
export const CONTRACT_ROWS = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) =>
  (["OmnitideClearinghouse", "OmnitideOracle", "OmnitideUSD"] as const).flatMap((name) => {
    const rec = D[k]?.[name];
    return rec ? [{ chain: k, name, proxy: rec.proxy as Address, implementation: rec.implementation as Address }] : [];
  }),
);

export const marketById = (id: number) => MARKETS.find((m) => m.id === id);
export const marketBySymbol = (s: string) => MARKETS.find((m) => m.symbol.toLowerCase() === s.toLowerCase());
export const TDUSD_DECIMALS = 6;
export const FEE_BPS = 10;
