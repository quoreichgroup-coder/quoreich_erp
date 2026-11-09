/**
 * E2E — Submitting the period via the Enter key must enforce the same
 * validation as the click path: invalid periods never reach the RPC and
 * surface the localized error message.
 */
import { test, expect, type Route } from "@playwright/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

test("Treasury close — Enter key on invalid period blocks the RPC", async ({ page }) => {
  let rpcCalled = false;

  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    rpcCalled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const input = page.getByTestId("treasury-close-period");
  await input.fill("2025-13");
  await input.press("Enter");

  await expect(page.getByTestId("treasury-close-error")).toContainText(/invalide/i);
  await expect(page.getByTestId("treasury-close-button")).toBeDisabled();

  await page.waitForTimeout(200);
  expect(rpcCalled).toBe(false);
});
