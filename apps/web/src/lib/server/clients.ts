import "server-only";
import { createPublicClient, http } from "viem";
import { CHAIN_LIST } from "@/lib/chains";
import { upstreamRpc } from "./env";

const cache = new Map<number, ReturnType<typeof createPublicClient>>();

/** Server-side viem client per chain, talking to the upstream RPC directly. */
export function serverClient(chainId: number) {
  let c = cache.get(chainId);
  if (!c) {
    const chain = CHAIN_LIST.find((x) => x.id === chainId);
    if (!chain) throw new Error(`unknown chain ${chainId}`);
    c = createPublicClient({ chain, transport: http(upstreamRpc(chainId), { timeout: 8_000 }) }) as ReturnType<typeof createPublicClient>;
    cache.set(chainId, c);
  }
  return c;
}
