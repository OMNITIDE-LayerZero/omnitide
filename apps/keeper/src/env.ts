import { z } from "zod";

const Env = z.object({
  OMNITIDE_ENV: z.enum(["testnet", "mainnet"]).default("testnet"),
  DATABASE_URL: z.string().url(),
  KEEPER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key"),
  HUB_RPC_URL: z.string().url(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(4303),
  // set to 0 to run price + report service only (e.g. local dev without gas)
  EXECUTE: z.enum(["0", "1"]).default("1"),
  // V2 Current
  INDEXER_URL: z.string().url().default("http://127.0.0.1:4302"),
  SITE_URL: z.string().url().default("https://testnet.omnitide.trade"),
  ARB_RPC_URL: z.string().url().default("https://sepolia-rollup.arbitrum.io/rpc"),
  TIDE_READ_HOURS: z.coerce.number().min(0).default(12), // 0 turns scheduled lzRead off
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:alerts@omnitide.app"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    // never echo values: report variable names only
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid keeper env: ${names}`);
  }
  return parsed.data;
}
