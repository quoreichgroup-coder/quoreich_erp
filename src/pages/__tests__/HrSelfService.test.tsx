import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), me: null as unknown }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import HrSelfService from "@/pages/HrSelfService";

const linked = {
  employee: { id: "e1", matricule: "M1", name: "Awa Ouédraogo", approver_name: "Chef" },
  types: [{ id: "t1", code: "cp", label: "Congé payé", kind: "leave", unit: "day", tracks_balance: true, approval_mode: "manager" }],
  requests: [], balances: [{ type_id: "t1", type_label: "Congé payé", unit: "day", balance: 7.5 }],
  to_approve: [{ id: "r9", employee_name: "Issa Kaboré", matricule: "M2", type_label: "Congé payé", unit: "day",
    start_date: "2040-06-10", end_date: "2040-06-12", quantity: 3, reason: "Vacances" }],
};

afterEach(cleanup);
beforeEach(() => {
  mocks.me = linked;
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "my_hr_self_service" ? mocks.me : "id", error: null }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><HrSelfService /></MemoryRouter></QueryClientProvider>);
}

describe("HrSelfService", () => {
  it("explains what to do when the account is not linked to an employee record", async () => {
    mocks.me = { employee: null, types: [], requests: [], balances: [], to_approve: [] };
    renderPage();
    expect(await screen.findByText(/n’est rattaché à aucune fiche salarié/)).toBeInTheDocument();
  });

  it("shows the balance, sends the employee's own request and lets the designated manager decide", async () => {
    renderPage();
    expect(await screen.findByText("7,5 jour(s)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Du"), { target: { value: "2040-07-01" } });
    fireEvent.change(screen.getByLabelText("Au"), { target: { value: "2040-07-03" } });
    fireEvent.change(screen.getByLabelText("Motif"), { target: { value: "Congé d’été" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("submit_my_time_request", {
      _type: "t1", _start: "2040-07-01", _end: "2040-07-03", _quantity: null, _reason: "Congé d’été" }));
    fireEvent.click(screen.getByRole("button", { name: "Approuver" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("decide_hr_time_request", { _id: "r9", _approve: true, _reason: null }));
  });
});
