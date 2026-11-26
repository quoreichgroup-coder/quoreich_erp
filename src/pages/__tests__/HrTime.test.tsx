import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), permissions: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("@/hooks/use-hr-data", () => ({
  useEmployees: () => ({ data: [{ id: "e1", matricule: "M1", first_name: "Awa", last_name: "Ouédraogo", status: "active" }] }),
  useHrPayrollComponents: () => ({ data: [] }),
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/TransactionTabsBar", () => ({ TransactionTabsBar: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import HrTime from "@/pages/HrTime";

const request = {
  id: "r1", employee_id: "e1", employee_name: "Awa Ouédraogo", matricule: "M1", type_id: "t1", type_code: "cp", type_label: "Congé payé",
  type_kind: "leave", unit: "day", start_date: "2039-03-10", end_date: "2039-03-12", quantity: 3, reason: "Vacances",
  status: "pending", created_by: "u1", created_at: "2039-03-01", decided_by: null, decision_reason: null, payroll_run_id: null, payroll_period: null,
};

afterEach(cleanup);
beforeEach(() => {
  mocks.permissions = ["hr.time_request", "hr.time_approve"];
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "list_hr_time_types"
      ? [{ id: "t1", code: "cp", label: "Congé payé", kind: "leave", unit: "day", count_method: "calendar", component_id: null,
        tracks_balance: true, accrual_per_month: 2.5, allow_negative_balance: false, requires_second_person: true, active: true, sort_order: 0 }]
      : name === "list_hr_time_requests" ? [request] : name.startsWith("list_") ? [] : "new-id",
    error: null,
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><HrTime /></MemoryRouter></QueryClientProvider>);
}

describe("HrTime", () => {
  it("submits a leave request through the database function (quantity computed when left empty)", async () => {
    renderPage();
    await screen.findByText("Vacances");
    fireEvent.change(screen.getByLabelText("Salarié"), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Du"), { target: { value: "2039-03-24" } });
    fireEvent.change(screen.getByLabelText("Au"), { target: { value: "2039-03-26" } });
    fireEvent.change(screen.getByLabelText("Motif"), { target: { value: "Congé annuel" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la demande" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("submit_hr_time_request", {
      _employee: "e1", _type: "t1", _start: "2039-03-24", _end: "2039-03-26", _quantity: null, _reason: "Congé annuel",
    }));
  });

  it("offers approval only with the approval right, and requires a reason to reject", async () => {
    renderPage();
    await screen.findByText("Vacances");
    expect(screen.getByRole("button", { name: "Rejeter" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approuver" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("decide_hr_time_request", { _id: "r1", _approve: true, _reason: null }));
    cleanup();
    mocks.permissions = ["hr.time_request"];
    renderPage();
    await screen.findByText("Vacances");
    expect(screen.queryByRole("button", { name: "Approuver" })).toBeNull();
  });
});
