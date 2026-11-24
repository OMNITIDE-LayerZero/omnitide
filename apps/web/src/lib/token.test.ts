import { describe, expect, it } from "vitest";
import { parseToken } from "./token";

const OK = { ca: "0x1111111111111111111111111111111111111111", symbol: "$omnitide", chain: "Robinhood Chain", explorer: "https://explorer.chain.robinhood.com/token/0x1111111111111111111111111111111111111111" };

describe("launch token file", () => {
  it("accepts an EVM or Solana address and normalises the symbol", () => {
    expect(parseToken(OK)).toEqual({ ...OK, symbol: "OMNITIDE", buy: undefined });
    expect(parseToken({ ...OK, ca: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", chain: "Solana" })?.ca).toBe("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  });

  it("shows nothing for a malformed file", () => {
    expect(parseToken(null)).toBeNull();
    expect(parseToken({ ...OK, ca: "0x123" })).toBeNull();
    expect(parseToken({ ...OK, explorer: "http://evil.example" })).toBeNull();
    expect(parseToken({ ...OK, symbol: "<script>" })).toBeNull();
  });

  it("drops a non-https buy link but keeps the token", () => {
    expect(parseToken({ ...OK, buy: "javascript:alert(1)" })?.buy).toBeUndefined();
    expect(parseToken({ ...OK, buy: "https://app.uniswap.org/swap" })?.buy).toBe("https://app.uniswap.org/swap");
  });

  it("never shows a project wallet", () => {
    expect(parseToken({ ...OK, ca: "0xB58dE05CC819F7B04ca611F23e4be9E4be0C23f9" }, ["0xb58de05cc819f7b04ca611f23e4be9e4be0c23f9"])).toBeNull();
  });
});
