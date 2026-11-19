import "server-only";
import { z } from "zod";

const Env = z.object({
  OMNITIDE_ENV: z.enum(["testnet", "mainnet"]).default("testnet"),
  DATABASE_URL: z.string().url(),
  KEEPER_URL: z.string().url().default("http://127.0.0.1:4303"),
  INDEXER_URL: z.string().url().default("http://127.0.0.1:4302"),
  RPC_46630: z.string().url().default("https://rpc.testnet.chain.robinhood.com"),
  RPC_11155111: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),
  RPC_43113: z.string().url().default("https://avalanche-fuji-c-chain-rpc.publicnode.com"),
});

let cached: z.infer<typeof Env> | undefined;

/** Validated server env; reports variable names only, never values. */
export function env() {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) throw new Error(`invalid server env: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return (cached = parsed.data);
}

export function upstreamRpc(chainId: number): string | undefined {
  const e = env() as Record<string, unknown>;
  const v = e[`RPC_${chainId}`];
  return typeof v === "string" ? v : undefined;
}
