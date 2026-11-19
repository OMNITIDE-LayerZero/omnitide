import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import { CHAINS, type ChainKey } from "../chains.js";
import type { Deployments } from "../deployments/index.js";

export const DEPLOYER = "0xB58dE05CC819F7B04ca611F23e4be9E4be0C23f9";

export type { ProxyRecord, ChainDeployment, Deployments } from "../deployments/index.js";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "deployments", `${process.env.OMNITIDE_ENV ?? "testnet"}.json`);

export function loadDeployments(): Deployments {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Deployments) : {};
}

export function saveDeployments(d: Deployments) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
}

export function chainKeyById(chainId: number): ChainKey {
  const entry = Object.entries(CHAINS).find(([, c]) => c.chainId === chainId);
  if (!entry) throw new Error(`chain ${chainId} is not an OMNITIDE chain`);
  return entry[0] as ChainKey;
}

/** First configured signer, refusing to run as anything but the OMNITIDE deployer. */
export async function deployerSigner(ethers: HardhatEthers) {
  const [signer] = await ethers.getSigners();
  if (!signer || signer.address.toLowerCase() !== DEPLOYER.toLowerCase()) throw new Error(`unexpected signer ${signer?.address}`);
  return signer;
}
