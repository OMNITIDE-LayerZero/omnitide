import "server-only";
import { createDb } from "@omnitide/db";
import { env } from "./env";

const g = globalThis as unknown as { omnitideDb?: ReturnType<typeof createDb> };
export const db = () => (g.omnitideDb ??= createDb(env().DATABASE_URL));
