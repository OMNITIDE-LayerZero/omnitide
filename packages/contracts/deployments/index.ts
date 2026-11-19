import testnet from "./testnet.json" with { type: "json" };
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
  OmnitideOracle?: ProxyRecord;
  OmnitideClearinghouse?: ProxyRecord;
  OmnitideHarbor?: ProxyRecord;
  OmnitideHarborShareAdapter?: ProxyRecord;
  OmnitideHarborShare?: ProxyRecord;
  OmnitideTideReader?: ProxyRecord;
  wired?: string;
}

export type Deployments = Partial<Record<ChainKey, ChainDeployment>>;

// One entry per OMNITIDE_ENV; mainnet is added when Phase 2 deploys. A configured chain may not be deployed yet.
export const DEPLOYMENTS: Record<"testnet", Deployments> = { testnet };
export type OmnitideEnv = keyof typeof DEPLOYMENTS;
