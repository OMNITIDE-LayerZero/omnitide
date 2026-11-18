import testnet from "./testnet.json" with { type: "json" };

// One entry per OMNITIDE_ENV; mainnet is added when Phase 2 deploys.
export const DEPLOYMENTS = { testnet } as const;
export type OmnitideEnv = keyof typeof DEPLOYMENTS;
