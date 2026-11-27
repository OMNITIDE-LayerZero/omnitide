import { describe, expect, it } from "vitest";
import { ORIGINS, stageOf } from "./intents";

describe("intents", () => {
  it("folds 1Click statuses into tracker stages", () => {
    expect(stageOf(undefined)).toBe("waiting");
    expect(stageOf("PENDING_DEPOSIT")).toBe("waiting");
    expect(stageOf("INCOMPLETE_DEPOSIT")).toBe("waiting");
    expect(stageOf("KNOWN_DEPOSIT_TX")).toBe("swapping");
    expect(stageOf("PROCESSING")).toBe("swapping");
    expect(stageOf("SUCCESS")).toBe("landed");
    expect(stageOf("REFUNDED")).toBe("refunded");
    expect(stageOf("FAILED")).toBe("failed");
  });

  it("keeps origin ids unique and wallet origins on an EVM chain", () => {
    expect(new Set(ORIGINS.map((o) => o.id)).size).toBe(ORIGINS.length);
    for (const o of ORIGINS.filter((x) => x.token)) expect(o.chainId).toBeDefined();
  });
});
