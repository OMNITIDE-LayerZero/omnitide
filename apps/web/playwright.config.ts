import { defineConfig, devices } from "@playwright/test";

// Runs against a live stack: local dev (tools) or the deployed testnet via E2E_BASE_URL.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4391", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } },
  ],
});
