import testnet from "./testnet.json" with { type: "json" };
import mainnet from "./mainnet.json" with { type: "json" };
import type { ChainKey } from "../chains.js";

export interface ProxyRecord {
  proxy: string;
  implementation: string;
  deployTx: string;
  block: number;
}

export interface ChainDeployment {
  chainId: number;
  eid: number;
  OmnitideUSD?: ProxyRecord;
  OmnitidePort?: ProxyRecord;
  OmnitideOracle?: ProxyRecord;
  OmnitideClearinghouse?: ProxyRecord;
  OmnitideHarbor?: ProxyRecord;
  OmnitideHarborShareAdapter?: ProxyRecord;
  OmnitideHarborShare?: ProxyRecord;
  OmnitideTideReader?: ProxyRecord;
  OmnitideDeepPool?: ProxyRecord;
  OmnitideLighthouse?: ProxyRecord;
  OmnitideBadge?: ProxyRecord;
  OmnitideToken?: ProxyRecord;
  OmnitideCouncil?: ProxyRecord;
  OmnitideCopyVaultFactory?: ProxyRecord & { beacon: string; vaultImplementation: string };
  wired?: string;
}

export type Deployments = Partial<Record<ChainKey, ChainDeployment>>;

// One entry per OMNITIDE_ENV. A configured chain may not be deployed yet; mainnet ships version by version.
export const DEPLOYMENTS: Record<"testnet" | "mainnet", Deployments> = { testnet, mainnet };
export type OmnitideEnv = keyof typeof DEPLOYMENTS;
