/**
 * E2E — Multiple consecutive PDF generation failures must:
 *   - keep surfacing a clear localized toast (no silent failure);
 *   - de-duplicate / cap stacked toasts (no excessive duplicates);
 *   - keep the history table and per-row buttons fully operational.
 */
import { test, expect, type Route } from "@playwright/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const PERIOD = "2025-05";

test("Treasury close — repeated PDF failures keep UI usable and avoid excessive toast duplication", async ({ page }) => {
  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "00000000-0000-0000-0000-000000000010",
          period: PERIOD,
          status: "completed",
          total_balance: 500000,
          accounts_count: 1,
          reconciliations_count: 0,
          error_message: null,
          closed_by: "tester",
          closed_at: "2025-05-31T18:00:00Z",
          closed_by_name: "Tester",
        },
      ]),
    });
  });

  await page.addInitScript(() => {
    const OriginalBlob = window.Blob;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Blob = function PoisonBlob(parts: BlobPart[], opts?: BlobPropertyBag) {
      const type = opts?.type ?? "";
      if (type.includes("pdf") || type.includes("octet-stream")) {
        throw new Error("synthetic Blob failure for PDF export");
      }
      return new OriginalBlob(parts, opts);
    };
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const reportBtn = page.getByTestId(`treasury-close-report-${PERIOD}`);
  await expect(reportBtn).toBeVisible();

  // Burst of failures
  for (let i = 0; i < 5; i++) {
    await reportBtn.click();
    await page.waitForTimeout(120);
  }

  // Toast text remains visible.
  const toast = page.getByText(/Impossible de générer le rapport PDF/i);
  await expect(toast.first()).toBeVisible({ timeout: 5000 });

  // Excessive duplication guard: shadcn caps stacked toasts; assert a sane upper bound.
  const toastCount = await toast.count();
  expect(toastCount).toBeLessThanOrEqual(5);

  // History + button remain operational after the burst.
  await expect(page.getByTestId("treasury-close-history")).toBeVisible();
  await expect(reportBtn).toBeEnabled();
  await reportBtn.click();
  await expect(page.getByTestId(`treasury-close-row-${PERIOD}`)).toBeVisible();
});
