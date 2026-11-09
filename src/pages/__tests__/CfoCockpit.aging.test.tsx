import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Build rows with dates relative to "today" so we don't depend on fake timers.
const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const arRows = [
  { id: "ar-1", invoice_number: "INV-001", invoice_date: iso(-60), due_date: iso(-30), total: 100_000, amount_paid: 0, status: "open" },
  { id: "ar-2", invoice_number: "INV-002", invoice_date: iso(-45), due_date: iso(-15), total: 50_000, amount_paid: 20_000, status: "partial" },
  { id: "ar-3", invoice_number: "INV-003", invoice_date: iso(-5), due_date: iso(+15), total: 30_000, amount_paid: 0, status: "open" }, // not overdue
];
const apRows = [
  { id: "ap-1", invoice_number: "BILL-001", invoice_date: iso(-60), due_date: iso(-30), total: 200_000, amount_paid: 0, status: "open" },
];

function makeQB(rows: any[]) {
  const qb: any = {
    _rows: rows,
    select: vi.fn(function (this: any) { return this; }),
    eq: vi.fn(function (this: any) { return this; }),
    neq: vi.fn(function (this: any, _c: string, val: string) {
      this._rows = this._rows.filter((r: any) => r.status !== val);
      return this;
    }),
    lt: vi.fn(function (this: any, col: string, val: string) {
      this._rows = this._rows.filter((r: any) => r[col] && r[col] < val);
      return this;
    }),
    in: vi.fn(function (this: any) { return this; }),
    gte: vi.fn(function (this: any, col: string, val: string) {
      this._rows = this._rows.filter((r: any) => r[col] && r[col] >= val);
      return this;
    }),
    lte: vi.fn(function (this: any, col: string, val: string) {
      this._rows = this._rows.filter((r: any) => r[col] && r[col] <= val);
      return this;
    }),
    order: vi.fn(function (this: any) { return this; }),
    // `AgingDrilldownDialog` pagine côté serveur via `.range()` : sans cette
    // méthode le mock lève un TypeError et le dialogue affiche son état
    // d'erreur, si bien que la table n'est jamais montée.
    range: vi.fn(function (this: any, start: number, end: number) {
      this._rows = this._rows.slice(start, end + 1);
      return this;
    }),
    limit: vi.fn(function (this: any) { return Promise.resolve({ data: this._rows, error: null, count: this._rows.length }); }),
    then: function (this: any, resolve: any) {
      return Promise.resolve({ data: this._rows, error: null, count: this._rows.length }).then(resolve);
    },
  };
  return qb;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "ar_invoices") return makeQB([...arRows]);
      if (table === "ap_invoices") return makeQB([...apRows]);
      if (table === "bank_accounts") return makeQB([{ current_balance: 1_000_000 }]);
      if (table === "payments") return makeQB([]);
      if (table === "payroll_runs") return makeQB([]);
      if (table === "inventory_period_closes") return makeQB([{ period: "2026-05" }]);
      if (table === "treasury_period_closes") return makeQB([{ period: "2026-05" }]);
      return makeQB([]);
    },
  },
}));

vi.mock("@/components/PageShell", () => ({
  PageShell: ({ children }: any) => <div>{children}</div>,
}));

import CfoCockpit from "@/pages/CfoCockpit";

afterEach(() => {
  cleanup();
});

function renderCockpit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CfoCockpit />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CFO Cockpit — Échus/Aging", () => {
  it("renders AR/AP overdue KPIs with inline counters", async () => {
    renderCockpit();
    // AR overdue: INV-001 (100k) + INV-002 (50k - 20k = 30k) = 130k, 2 factures
    const arCount = await screen.findByTestId("aging-ar-count");
    expect(arCount.textContent).toContain("2");
    const apCount = await screen.findByTestId("aging-ap-count");
    expect(apCount.textContent).toContain("1");
    // Amount visible somewhere in the card
    const arCard = screen.getByTestId("aging-ar-card");
    expect(arCard.textContent).toMatch(/130\s?000/);
  });

  it("drill-down opens and lists overdue invoices", async () => {
    renderCockpit();
    const arCard = await screen.findByTestId("aging-ar-card");
    fireEvent.click(arCard);
    await waitFor(() => {
      expect(screen.getByTestId("aging-drilldown-table")).toBeTruthy();
    });
    const table = screen.getByTestId("aging-drilldown-table");
    expect(table.textContent).toContain("INV-001");
    expect(table.textContent).toContain("INV-002");
    expect(table.textContent).not.toContain("INV-003"); // not overdue
  });
});
