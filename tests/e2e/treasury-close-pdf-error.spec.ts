/**
 * E2E — Forcing a PDF mini-report generation failure must surface a
 * clear toast WITHOUT crashing the closure history table.
 *
 * We inject a script that makes jsPDF's internal Blob creation throw,
 * then click the per-row "PDF" action and assert:
 *   - the error toast renders with the localized message;
 *   - the history table is still mounted and the row remains visible
 *     and interactive (button can be clicked again).
 */
import { test, expect, type Route } from "@playwright/test";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const PERIOD = "2025-04";

test("Treasury close — PDF report failure shows toast and keeps history accessible", async ({ page }) => {
  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "00000000-0000-0000-0000-000000000001",
          period: PERIOD,
          status: "completed",
          total_balance: 1000000,
          accounts_count: 2,
          reconciliations_count: 1,
          error_message: null,
          closed_by: "tester",
          closed_at: "2025-04-30T18:00:00Z",
          closed_by_name: "Tester",
        },
      ]),
    });
  });

  // Force jsPDF's internal Blob creation to fail.
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
    // Belt and suspenders: also poison the object-URL path jsPDF can take.
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      if (obj instanceof Blob && (obj.type.includes("pdf") || obj.type.includes("octet-stream"))) {
        throw new Error("synthetic createObjectURL failure for PDF export");
      }
      return origCreate(obj);
    };
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();

  const reportBtn = page.getByTestId(`treasury-close-report-${PERIOD}`);
  await expect(reportBtn).toBeVisible();
  await reportBtn.click();

  // Toast surfaces with a clear localized message.
  await expect(page.getByText(/Impossible de générer le rapport PDF/i)).toBeVisible({ timeout: 5000 });

  // History table is still mounted and the row remains accessible.
  await expect(page.getByTestId("treasury-close-history")).toBeVisible();
  await expect(page.getByTestId(`treasury-close-row-${PERIOD}`)).toBeVisible();
  await expect(reportBtn).toBeEnabled();

  // Clicking again must not blow up the page.
  await reportBtn.click();
  await expect(page.getByTestId("treasury-close-history")).toBeVisible();
});
