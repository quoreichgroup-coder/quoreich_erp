import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CfoConsolidated from "@/pages/CfoConsolidated";
import type { ConsolidatedKpiRow } from "@/hooks/use-consolidated-cfo";

const mocks = vi.hoisted(() => ({
  exportCsv: vi.fn(), trends: vi.fn(), kpis: vi.fn(),
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ConsolidatedTrendsCard", () => ({
  ConsolidatedTrendsCard: ({ onMonthsChange }: { onMonthsChange: (months: number) => void }) => (
    <div>{[3, 6, 12].map((months) => <button key={months} onClick={() => onMonthsChange(months)}>{months} mois</button>)}</div>
  ),
}));
vi.mock("@/hooks/use-consolidated-cfo", async (original) => ({
  ...await original<typeof import("@/hooks/use-consolidated-cfo")>(),
  useAccessibleTenants: () => ({ data: [{ id: "t1", name: "Acme", currency: "XOF" }] }),
  useConsolidatedCfoKpis: mocks.kpis,
}));
vi.mock("@/hooks/use-consolidated-trends", () => ({ useConsolidatedTrends: mocks.trends }));
vi.mock("@/lib/csv-export", () => ({ exportToCSV: mocks.exportCsv }));

const rows: ConsolidatedKpiRow[] = [
  {
    tenant_id: "t1", tenant_name: "Acme", currency: "XOF",
    cash_on_hand: 1000, ar_outstanding: 500, ap_outstanding: 200,
    ar_overdue: 100, ap_overdue: 50, ar_overdue_count: 1, ap_overdue_count: 1,
    open_projects: 2, open_risks_high: 0, unmatched_recon_count: 0,
  },
];

const points = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, "0")}`, label: `Mois ${i + 1}`,
  revenue: 1250 + i, expenses: 300 + i, netProfit: 950, cashBalance: 1000,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kpis.mockReturnValue({ data: rows, refetch: vi.fn() });
  mocks.trends.mockImplementation((_ids, months) => ({ data: points.slice(-months) }));
});
afterEach(cleanup);

async function openDialog(key = "Enter") {
  const user = userEvent.setup();
  render(<CfoConsolidated />);
  const trigger = screen.getByRole("button", { name: /décomposition par société pour Trésorerie/ });
  trigger.focus();
  await user.keyboard(key === "Enter" ? "{Enter}" : " ");
  const dialog = screen.getByRole("dialog");
  const close = within(dialog).getByRole("button", { name: "Close" });
  await waitFor(() => expect(close).toHaveFocus());
  return { user, trigger, dialog, close };
}

describe("/cockpit/consolidated — accessibilité du drill-down réel", () => {
  it("expose un rôle dialog modal, un nom et une description liés à des éléments existants", async () => {
    const { dialog, trigger } = await openDialog();
    expect(dialog).toHaveAccessibleName(/Trésorerie/);
    expect(dialog).toHaveAccessibleDescription(/bank_accounts\.balance/);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
      const id = dialog.getAttribute(attr);
      expect(id).toBeTruthy();
      expect(document.getElementById(id ?? "")).toBeInTheDocument();
    }
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(dialog).getByRole("columnheader", { name: "Société" })).toBeInTheDocument();
  });

  it("garde le focus dans le modal avec Tab et Maj+Tab (un seul contrôle interactif)", async () => {
    const { user, close } = await openDialog();
    for (let i = 0; i < 3; i++) {
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(close).toHaveFocus();
    }
  });

  it("empêche aussi le déplacement programmatique du focus hors du modal", async () => {
    const { trigger, close } = await openDialog();
    trigger.focus();
    await waitFor(() => expect(close).toHaveFocus());
  });

  it.each(["Enter", "Space"])("ouvre avec %s, ferme avec Échap et restitue le focus", async (key) => {
    const { user, trigger } = await openDialog(key);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.tab();
    expect(screen.getByRole("button", { name: /décomposition par société pour Créances/ })).toHaveFocus();
  });

  it("ferme par activation clavier du bouton de fermeture et restitue le focus", async () => {
    const { user, trigger } = await openDialog();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("/cockpit/consolidated — CSV principal", () => {
  it.each([3, 6, 12])("inclut les KPI et les quatre séries sur %i mois", async (months) => {
    const user = userEvent.setup();
    render(<CfoConsolidated />);
    await user.click(screen.getByRole("button", { name: `${months} mois` }));
    await user.click(screen.getByRole("button", { name: /^CSV$/ }));
    expect(mocks.exportCsv).toHaveBeenCalledTimes(1);
    const [exported, columns, filename] = mocks.exportCsv.mock.calls[0];
    expect(filename).toMatch(/^cfo-consolidated-/);
    expect(exported).toHaveLength(1 + months);
    expect(exported[0]).toMatchObject({ tenant_name: "Acme", cash_on_hand: 1000, section: "KPI par société" });
    expect(exported.slice(1)).toEqual(points.slice(-months).map((point) => expect.objectContaining({
      ...point, section: "Tendance consolidée", scope: "Acme", currency: "XOF",
    })));
    expect(columns).toEqual(expect.arrayContaining([
      { key: "revenue", header: "Total Revenue" }, { key: "expenses", header: "Total Expenses" },
      { key: "netProfit", header: "Net Profit" }, { key: "cashBalance", header: "Cash Balance" },
    ]));
    expect(exported[1].months).toBe(months);
  });

  it.each([
    { data: undefined, isFetching: true },
    { data: points, isFetching: true },
    { data: points, isError: true },
  ])("empêche un export incomplet lorsque les tendances ne sont pas prêtes : %j", (state) => {
    mocks.trends.mockReturnValue(state);
    render(<CfoConsolidated />);
    expect(screen.getByRole("button", { name: /^CSV$/ })).toBeDisabled();
    expect(mocks.exportCsv).not.toHaveBeenCalled();
  });
});
