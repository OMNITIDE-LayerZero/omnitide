import { defineConfig } from "prisma/config";

// DATABASE_URL is only needed for migrate; `prisma generate` (CI build) runs without it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
