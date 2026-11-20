import { expect, test, type Page } from "@playwright/test";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";

// the suite runs against either env; the host decides which deployments and versions it expects
const D = DEPLOYMENTS[/\/\/(www\.)?omnitide\.trade/.test(process.env.E2E_BASE_URL ?? "") ? "mainnet" : "testnet"];
const hub = Object.entries(D).find(([k, d]) => CHAINS[k as ChainKey]?.hub && d?.OmnitideClearinghouse)![1]!;
const HARBOR = !!hub.OmnitideHarbor;
const TIDE = Object.values(D).some((d) => d?.OmnitideTideReader);
const DEEP = !!hub.OmnitideDeepPool;

const DEPLOYER = /0xB58dE05CC819F7B04ca611F23e4be9E4be0C23f9/i;

async function noPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Live data has arrived, and the rules hold: no $0.00 figures, no deployer address. */
async function checkCopyRules(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\$0\.00(?!\d)/);
  expect(text).not.toMatch(/^\s*[—-]\s*$/m);
  expect(text).not.toMatch(DEPLOYER);
}

test("landing shows live prices, the contracts and the sea wall", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/be the tide/i);
  await expect(page.getByText("BTC-PERP").first()).toBeVisible();
  await expect(page.locator("text=/\\$\\d{2},\\d{3}/").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`a[href*="${hub.OmnitideClearinghouse!.proxy}" i]`).first()).toBeVisible();
  await expect(page.getByText(/fully backed/i)).toBeVisible({ timeout: 30_000 });
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("trade terminal renders a live chart and the ticket", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/terminal/trade?m=ETH");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^long$/i })).toBeVisible();
  await expect(page.getByText("Contract spec · ETH-PERP")).toBeVisible();
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("sea wall reads reserves and lanes from chain", async ({ page }) => {
  await page.goto("/sea-wall");
  await expect(page.getByText(/rate limits, dvns and confirmations/i)).toBeVisible();
  await expect(page.locator("text=/\\d+\\.\\d{2}%/").first()).toBeVisible({ timeout: 30_000 });
  await checkCopyRules(page);
});

test("terminal views switch with number keys", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are a desktop feature");
  await page.goto("/terminal/trade");
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/terminal\/portfolio/);
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/terminal\/risk/);
});

test("harbor shows live TVL and share price", async ({ page }) => {
  test.skip(!HARBOR, "Harbor opens with V2");
  const errors = await noPageErrors(page);
  await page.goto("/terminal/harbor");
  await expect(page.getByRole("heading", { name: "Harbor", level: 1 })).toBeVisible();
  await expect(page.getByText(/\d\.\d{6} tdUSD/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/deposit|redeem/i).first()).toBeVisible();
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("tide chart lists every chain with its lzRead reading", async ({ page }) => {
  test.skip(!TIDE, "Tide Chart opens with V2");
  const errors = await noPageErrors(page);
  await page.goto("/terminal/tide");
  await expect(page.getByRole("heading", { name: "Tide Chart", level: 1 })).toBeVisible();
  await expect(page.getByText(/lzRead attested/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("BTC-PERP").first()).toBeVisible();
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("risk page runs the simulator without a wallet", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/terminal/risk");
  await expect(page.getByText(/shared vs isolated/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Keeps \$/).first()).toBeVisible();
  await page.getByRole("radio", { name: "Flash crash" }).click();
  await expect(page.getByText("Riptide Alerts")).toBeVisible();
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("health endpoint reports database and hub RPC", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.database.ok).toBe(true);
  expect(body.rpc.ok).toBe(true);
});

test("rpc proxy refuses methods outside the allowlist", async ({ request }) => {
  const res = await request.post("/api/rpc/46630", { data: { jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] } });
  const body = await res.json();
  expect(body.error?.code).toBe(-32601);
});

// ───────── V3 Deep Water ─────────

test("deep mode explains the sealed ledger before a wallet connects", async ({ page }) => {
  test.skip(!DEEP, "Deep Water opens with V3");
  const errors = await noPageErrors(page);
  await page.goto("/terminal/deep");
  await expect(page.getByRole("heading", { name: "Deep Mode", level: 1 })).toBeVisible();
  await expect(page.getByText(/who sees what/i)).toBeVisible();
  await expect(page.getByText(/Live from OmnitideDeepPool/i)).toBeVisible({ timeout: 30_000 });
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("disclosure refuses a malformed key and accepts the dk1 format", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/disclosure");
  await page.getByPlaceholder("dk1_…").fill("dk1_nope");
  await expect(page.getByText(/isn't a Disclosure Key/)).toBeVisible();
  await page.getByPlaceholder("dk1_…").fill(`dk1_${"ab".repeat(64)}`);
  await expect(page.getByText(/isn't a Disclosure Key/)).toHaveCount(0);
  await expect(page.getByText(/No seals for this Deep id yet/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("currents board ranks traders without the house desk and runs a paper account", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/terminal/currents");
  await expect(page.getByRole("heading", { name: "Currents", level: 1 })).toBeVisible();
  await expect(page.getByText("Paper account")).toBeVisible();
  await expect(page.locator("text=/\\$\\d+,\\d{3}\\.\\d{2}/").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Paper long" }).click();
  await expect(page.getByText(/paper fills/)).toContainText(/[1-9]\d* paper fills/);
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("arena shows all eight medals and council and copy render live", async ({ page }) => {
  test.skip(!DEEP, "Deep Water opens with V3");
  const errors = await noPageErrors(page);
  await page.goto("/terminal/arena");
  await expect(page.getByRole("heading", { name: "Arena", level: 1 })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(8);
  await page.goto("/terminal/council");
  await expect(page.getByRole("heading", { name: "Council", level: 1 })).toBeVisible();
  await expect(page.getByText(/TIP-\d+/).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/terminal/copy");
  await expect(page.getByRole("heading", { name: "Copy", level: 1 })).toBeVisible();
  await expect(page.getByText(/Leader fills/)).toBeVisible({ timeout: 30_000 });
  await checkCopyRules(page);
  expect(errors).toEqual([]);
});

test("badge metadata and artwork are served for tokenURI", async ({ request }) => {
  const meta = await request.get("/api/badge/0/1");
  expect(meta.status()).toBe(200);
  const body = await meta.json();
  expect(body.name).toBe("First Fill #1");
  const art = await request.get("/api/badge/0/1.svg");
  expect(art.headers()["content-type"]).toContain("image/svg+xml");
  expect((await request.get("/api/badge/9/1")).status()).toBe(404);
});

test("keeper proxy only forwards the Deep Water allowlist", async ({ request }) => {
  test.skip(!DEEP, "Deep Water opens with V3");
  expect((await request.get("/api/keeper/deep/key")).status()).toBe(200);
  expect((await request.get("/api/keeper/alerts")).status()).toBe(404);
  expect((await request.post("/api/keeper/deep/trade", { data: { nope: 1 } })).status()).toBe(400);
});
