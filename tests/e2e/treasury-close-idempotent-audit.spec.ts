/**
 * E2E — Une période déjà clôturée ne se reclôture pas depuis l'écran :
 *   - la première clôture appelle la RPC une fois (audit period_close_completed avec
 *     period_start, period_end et actor_id) ;
 *   - ensuite, le bouton est verrouillé avec « Période déjà clôturée », la RPC n'est plus
 *     appelée et l'historique ne se duplique pas.
 *
 * L'écran bloque désormais ce second envoi (TreasuryControl : `alreadyClosed`). La version
 * Lovable de cette spec recliquait et attendait l'audit `period_close_idempotent` : c'est le
 * comportement de la RPC appelée deux fois, qui reste vrai côté base mais que l'écran
 * n'expose plus.
 */
import { test, expect, type Route } from "./fixtures/test";
import { periodBounds } from "@/lib/treasury-close";

const PORT = process.env.PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;
const FAKE_USER = "22222222-2222-2222-2222-222222222222";

function currentValidPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

test("Treasury close — idempotent retry audits start/end/actor and does not duplicate history", async ({ page }) => {
  const PERIOD = currentValidPeriod();
  const bounds = periodBounds(PERIOD);

  const audit: Array<{ action: string; period: string; period_start: string; period_end: string; actor_id: string }> = [];
  const historyRow = {
    id: "00000000-0000-0000-0000-0000000000aa",
    period: PERIOD,
    status: "completed",
    total_balance: 0,
    accounts_count: 0,
    reconciliations_count: 0,
    error_message: null,
    closed_by: FAKE_USER,
    closed_at: new Date().toISOString(),
    closed_by_name: "Tester",
  };
  const history: typeof historyRow[] = [];
  let rpcCalls = 0;

  await page.addInitScript((uid) => {
    (window as unknown as { __TEST_USER_ID__: string }).__TEST_USER_ID__ = uid;
  }, FAKE_USER);

  await page.route(/treasury_close_history_view/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) });
  });

  await page.route(/rpc\/close_treasury_period/, async (route: Route) => {
    rpcCalls += 1;
    const isIdempotent = rpcCalls > 1;
    if (!isIdempotent) history.push(historyRow);
    audit.push({
      action: isIdempotent ? "period_close_idempotent" : "period_close_completed",
      period: PERIOD,
      period_start: bounds.start,
      period_end: bounds.end,
      actor_id: FAKE_USER,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: historyRow.id, period: PERIOD, status: "completed", idempotent: isIdempotent }),
    });
  });

  await page.goto(`${BASE}/treasury/control`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Clôture de période/i }).click();
  await page.getByTestId("treasury-close-period").fill(PERIOD);

  // 1st click — completed
  await page.getByTestId("treasury-close-button").click();
  await expect(page.getByText(`Période ${PERIOD} clôturée`)).toBeVisible({ timeout: 5000 });

  // Seconde tentative : verrouillée par l'écran, aucun nouvel appel.
  await page.getByTestId("treasury-close-period").fill(PERIOD);
  await expect(page.getByTestId("treasury-close-button")).toBeDisabled();
  await expect(page.getByTestId("treasury-close-error")).toContainText(/déjà clôturée/i);
  await page.getByTestId("treasury-close-period").press("Enter");
  await page.waitForTimeout(500);

  expect(rpcCalls).toBe(1);
  expect(audit).toHaveLength(1);
  const first = audit[0];
  expect(first.action).toBe("period_close_completed");
  expect(first.period_start).toBe(bounds.start);
  expect(first.period_end).toBe(bounds.end);
  expect(first.actor_id).toBe(FAKE_USER);

  // History must not duplicate the row.
  expect(history).toHaveLength(1);
  await expect(page.getByTestId(`treasury-close-row-${PERIOD}`)).toHaveCount(1);
});
