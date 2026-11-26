import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), batches: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: "p1", code: "vir", label: "Gabarit banque", bank_name: "Banque", active: true,
      separator: ";", encoding: "UTF-8", date_format: "DD/MM/YYYY", decimal_separator: ",", amount_decimals: 0, header_row: true,
      columns: [{ header: "RIB", field: "bank_account" }, { header: "Montant", field: "amount" }] }], error: null }) }) }) }),
  },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { permissions: ["hr.payroll_payment"] } }) }));
vi.mock("@/hooks/use-hr-data", () => ({
  usePayrollRuns: () => ({ data: [{ id: "run1", period: "2041-01", status: "posted", net_total: 135000, payroll_currency_code: "XOF" }] }),
}));
vi.mock("@/hooks/use-treasury-accounts", () => ({
  useTreasuryAccounts: () => ({ data: [{ id: "b1", name: "Banque paie", currency: "XOF", account_type: "bank", is_active: true }] }),
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/TransactionTabsBar", () => ({ TransactionTabsBar: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import HrPayments from "@/pages/HrPayments";
import { encodePaymentFile } from "@/hooks/use-hr-payments";

const sent = {
  id: "lot1", batch_number: "VIR-2041-01-01", run_id: "run1", period: "2041-01", bank_account_id: "b1", bank_account_name: "Banque paie",
  profile_id: "p1", profile_label: "Gabarit banque", payment_date: "2041-01-31", currency: "XOF", status: "sent", total_amount: 135000, line_count: 2,
  reference: null, created_by: "u1", approved_by: "u2", sent_at: "2041-01-31", file_name: "VIR.csv", file_sha256: "abcdef0123456789", cancelled_reason: null,
  lines: [
    { id: "l1", line_number: 1, employee_id: "e1", matricule: "M1", beneficiary_name: "Ouédraogo Awa", amount: 90000, status: "pending", bank_account: "BF001", rejection_reason: null, result_date: null },
    { id: "l2", line_number: 2, employee_id: "e2", matricule: "M2", beneficiary_name: "Kaboré Issa", amount: 45000, status: "pending", bank_account: "BF002", rejection_reason: null, result_date: null },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  mocks.batches = [sent];
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "list_payroll_payment_batches" ? mocks.batches : "id", error: null }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><HrPayments /></MemoryRouter></QueryClientProvider>);
}

describe("encodePaymentFile", () => {
  it("writes UTF-8, Latin-1 and Windows-1252, and refuses a character the bank encoding cannot hold", () => {
    expect(Array.from(encodePaymentFile("é", "UTF-8"))).toEqual([0xc3, 0xa9]);
    expect(Array.from(encodePaymentFile("é", "ISO-8859-1"))).toEqual([0xe9]);
    expect(Array.from(encodePaymentFile("€", "WINDOWS-1252"))).toEqual([0x80]);
    expect(() => encodePaymentFile("€", "ISO-8859-1")).toThrow(/impossible à écrire/);
  });
});

describe("HrPayments", () => {
  it("prepares a batch from a posted cycle with the chosen bank account and file format", async () => {
    renderPage();
    await screen.findByText("VIR-2041-01-01");
    fireEvent.change(screen.getByLabelText("Cycle comptabilisé"), { target: { value: "run1" } });
    fireEvent.change(screen.getByLabelText("Compte bancaire payeur"), { target: { value: "b1" } });
    await waitFor(() => expect(screen.getByLabelText("Format de fichier").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText("Format de fichier"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Préparer le lot" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_payroll_payment_batch", expect.objectContaining({
      _run_id: "run1", _bank_account_id: "b1", _profile_id: "p1", _reference: null })));
  });

  it("records bank returns: paid line, rejected line with its mandatory reason", async () => {
    renderPage();
    await screen.findByText("VIR-2041-01-01");
    fireEvent.change(screen.getByLabelText("Retour ligne 1"), { target: { value: "paid" } });
    fireEvent.change(screen.getByLabelText("Retour ligne 2"), { target: { value: "rejected" } });
    expect(screen.getByRole("button", { name: "Enregistrer les retours" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motif du rejet ligne 2"), { target: { value: "RIB invalide" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les retours" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("record_payroll_payment_results", expect.objectContaining({
      _batch_id: "lot1",
      _results: [{ line_id: "l1", status: "paid", reason: undefined }, { line_id: "l2", status: "rejected", reason: "RIB invalide" }],
    })));
  });
});
