import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), versions: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/hooks/use-my-access", () => ({
  useMyAccess: () => ({ data: { permissions: ["hr.payroll_settings", "hr.payroll_rules_validate"] } }),
}));
vi.mock("@/hooks/use-hr-data", () => ({
  useHrPayrollSettings: () => ({ data: null }),
  useHrMovementReferences: () => ({ data: [{ id: "c1", kind: "payroll_category", code: "cadre", label: "Cadre", active: true }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PayrollRuleVersionsPanel } from "@/components/PayrollRuleVersionsPanel";

const validated = {
  id: "v1", country_code: "BF", currency_code: "XOF", effective_from: "2035-01-01", reference: "Texte de test",
  notes: null, proration_method: "calendar_days", rounding_unit: 1, rounding_mode: "nearest", taxable_rounding_unit: 100,
  income_tax_bands: [{ up_to: null, rate_pct: 10 }], tax_abatements: [], family_reductions: [], family_max_dependents: null,
  contributions: [{ id: "c1", code: "PENS", label: "Pension", organism: "CNSS", employee_rate_pct: 5, employer_rate_pct: 6,
    base_floor: null, employee_ceiling: 600000, employer_ceiling: 600000, deductible_from_tax: true,
    payable_account_code: null, employer_account_code: null, sort_order: 0 }],
  status: "validated", issues: [],
};

afterEach(cleanup);
beforeEach(() => {
  mocks.versions = [validated, { ...validated, id: "v2", effective_from: "2036-01-01", reference: "", status: "draft",
    issues: ["Référence officielle (texte, article, URL) obligatoire"] }];
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "list_payroll_rule_versions" ? mocks.versions : "new-id", error: null,
  }));
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PayrollRuleVersionsPanel /></QueryClientProvider>);
}

describe("PayrollRuleVersionsPanel", () => {
  it("lists dated versions and blocks validation of a draft that still has issues", async () => {
    renderPanel();
    expect(await screen.findByText("2035-01-01")).toBeInTheDocument();
    expect(screen.getAllByText("PENS 5 % / 6 %")).toHaveLength(2);
    expect(screen.getByText("Référence officielle (texte, article, URL) obligatoire")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider" })).toBeDisabled();
  });

  it("copies a validated version into a new draft and saves it with its contributions", async () => {
    renderPanel();
    await screen.findByText("2035-01-01");
    fireEvent.click(screen.getAllByRole("button", { name: "Copier en nouvelle version" })[0]);
    fireEvent.change(screen.getByLabelText("Date d’effet"), { target: { value: "2037-01-01" } });
    fireEvent.change(screen.getByLabelText("Source officielle (texte, article, date, URL)"), { target: { value: "Loi de test 2037" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_payroll_rule_version", {
      _input: expect.objectContaining({
        effective_from: "2037-01-01", reference: "Loi de test 2037", country_code: "BF",
        contributions: [expect.objectContaining({ code: "PENS", employee_rate_pct: 5, employer_rate_pct: 6, employee_ceiling: 600000 })],
      }),
    }));
    const input = mocks.rpc.mock.calls.find(([name]) => name === "save_payroll_rule_version")![1]._input;
    expect(input.id).toBeUndefined();
    expect(input.contributions[0].id).toBeUndefined();
  });
});
