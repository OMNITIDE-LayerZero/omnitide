import { parseUnits, stringToHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export interface SignedReport {
  feed: Hex;
  price: string; // 1e18 fixed point, decimal string
  timestamp: number;
  signature: Hex;
}

export const REPORT_TYPES = {
  PriceReport: [
    { name: "feed", type: "bytes32" },
    { name: "price", type: "uint256" },
    { name: "timestamp", type: "uint64" },
  ],
} as const;

export function oracleDomain(chainId: number, oracle: Address) {
  return { name: "OmnitideOracle", version: "1", chainId, verifyingContract: oracle } as const;
}

export const feedId = (feed: string) => stringToHex(feed, { size: 32 });

export async function signReport(account: PrivateKeyAccount, domain: ReturnType<typeof oracleDomain>, feed: string, price: string, timestamp: number): Promise<SignedReport> {
  const wad = parseUnits(price, 18);
  const id = feedId(feed);
  const signature = await account.signTypedData({ domain, types: REPORT_TYPES, primaryType: "PriceReport", message: { feed: id, price: wad, timestamp: BigInt(timestamp) } });
  return { feed: id, price: wad.toString(), timestamp, signature };
}
