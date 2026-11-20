import type { Address } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";

import { omnitideClearinghouseAbi, omnitideOracleAbi } from "@omnitide/contracts/abi";
import { D, HUB_KEY } from "./chains";
export {
  omnitideClearinghouseAbi,
  omnitideUSDAbi,
  omnitideOracleAbi,
  omnitideHarborAbi,
  omnitideHarborShareAbi,
  omnitideTideReaderAbi,
  omnitideDeepPoolAbi,
  omnitideLighthouseAbi,
  omnitideBadgeAbi,
  omnitideTokenAbi,
  omnitideCouncilAbi,
  omnitideCopyVaultAbi,
  omnitideCopyVaultFactoryAbi,
  omnitidePortAbi,
} from "@omnitide/contracts/abi";

/** Clearinghouse ABI plus the oracle's errors, so reverts from price checks decode by name. */
export const CH_ABI = [...omnitideClearinghouseAbi, ...omnitideOracleAbi.filter((x) => x.type === "error")] as const;
export { MARKETS };

const hub = D[HUB_KEY]!;
const readerChain = (Object.keys(CHAINS) as ChainKey[]).find((k) => D[k]?.OmnitideTideReader);

// callers only pass live chains (CHAIN_KEYS), and the hub is always deployed
export const usdAddress = (k: ChainKey) => D[k]!.OmnitideUSD!.proxy as Address;
export const CLEARINGHOUSE = hub.OmnitideClearinghouse!.proxy as Address;
export const ORACLE = hub.OmnitideOracle!.proxy as Address;
/** Features ship version by version on mainnet; pages and panels whose contracts are absent stay hidden. */
export const FEATURES = { harbor: !!hub.OmnitideHarbor, tide: !!readerChain, deepWater: !!hub.OmnitideDeepPool } as const;
// V2/V3 addresses are only read behind FEATURES
export const HARBOR = hub.OmnitideHarbor?.proxy as Address;
export const HARBOR_ADAPTER = hub.OmnitideHarborShareAdapter?.proxy as Address;
export const TIDE_READER_CHAIN = readerChain;
export const TIDE_READER = (readerChain && D[readerChain]!.OmnitideTideReader!.proxy) as Address;
export const DEEP_POOL = hub.OmnitideDeepPool?.proxy as Address;
export const COPY_FACTORY = hub.OmnitideCopyVaultFactory?.proxy as Address;
export const BADGE_HOME = hub.OmnitideBadge?.proxy as Address;
/** Stablecoin Ports (mainnet): tdUSD minted 1:1 against USDG on the hub, USDC on spokes. */
export const portOf = (k: ChainKey) => {
  const port = D[k]?.OmnitidePort;
  const stable = CHAINS[k].stable;
  return port && stable ? { port: port.proxy as Address, stable: stable.address as Address, symbol: stable.symbol } : undefined;
};
/** Chains carrying the V3 OApps (TIDE, Council, Lighthouse, Arena Badges): the hub plus every deepWater spoke. */
export const V3_CHAINS = (Object.keys(CHAINS) as ChainKey[]).filter((k) => D[k]?.OmnitideCouncil);
export const v3Address = (k: ChainKey, name: "OmnitideToken" | "OmnitideCouncil" | "OmnitideLighthouse" | "OmnitideBadge") => D[k]![name]!.proxy as Address;
/** Chains that hold Harbor shares besides the hub (direct lanes both ways). */
export const SHARE_CHAINS = (Object.keys(CHAINS) as ChainKey[]).filter((k) => D[k]?.OmnitideHarborShare);
export const shareAddress = (k: ChainKey) => (CHAINS[k].hub ? HARBOR : (D[k]!.OmnitideHarborShare!.proxy as Address));

/** Every proxy and its implementation, for the contracts section. */
export const CONTRACT_ROWS = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) =>
  (
    [
      "OmnitideClearinghouse",
      "OmnitideOracle",
      "OmnitideUSD",
      "OmnitidePort",
      "OmnitideHarbor",
      "OmnitideHarborShareAdapter",
      "OmnitideHarborShare",
      "OmnitideTideReader",
      "OmnitideDeepPool",
      "OmnitideCopyVaultFactory",
      "OmnitideToken",
      "OmnitideCouncil",
      "OmnitideLighthouse",
      "OmnitideBadge",
    ] as const
  ).flatMap((name) => {
    const rec = D[k]?.[name];
    return rec ? [{ chain: k, name, proxy: rec.proxy as Address, implementation: rec.implementation as Address }] : [];
  }),
);

export const marketById = (id: number) => MARKETS.find((m) => m.id === id);
export const marketBySymbol = (s: string) => MARKETS.find((m) => m.symbol.toLowerCase() === s.toLowerCase());
export const TDUSD_DECIMALS = 6;
export const FEE_BPS = 10;
