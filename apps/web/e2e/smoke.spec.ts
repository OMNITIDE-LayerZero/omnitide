import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.locator(`a[href*="0x31fcb7B2DaC407ECC2AB51c1764204Bd3a882F1e" i]`).first()).toBeVisible();
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
  await page.keyboard.press("4");
  await expect(page).toHaveURL(/\/terminal\/markets/);
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/terminal\/history/);
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
