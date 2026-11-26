import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "../DashboardSidebar";
import { ProtectedRoute } from "../ProtectedRoute";

const mocks = vi.hoisted(() => ({ access: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => mocks.access }));
vi.mock("@/hooks/use-active-modules", () => ({ useActiveModules: () => ({ data: [] }) }));
vi.mock("@/hooks/use-fiscal-calendar", () => ({ useFiscalCalendar: () => ({ data: { years: [] } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "accountant", user_metadata: { role: "admin" } }, loading: false,
}) }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { tenant_id: "tenant-a" } }) }) }) }),
} }));

const permissions = ["accounting.chart", "ar.invoice", "ap.invoice", "customers.manage", "suppliers.manage", "assets.depreciate", "expenses.post", "projects.export", "procurement.import", "reports.templates"];
const clients: QueryClient[] = [];
function showPage(path = "/hr") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(["profile", "accountant"], { tenant_id: "tenant-a" });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ProtectedRoute><div>Données du module</div></ProtectedRoute>
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mocks.access = { data: { roles: ["accountant"], permissions }, isSuccess: true, isPending: false, isError: false };
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("modules accessibles au comptable", () => {
  it("masque les modules sans permission et conserve les modules comptables", () => {
    render(<MemoryRouter><SidebarProvider><DashboardSidebar /></SidebarProvider></MemoryRouter>);
    expect(screen.getByText("Comptes clients", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Grand livre", { exact: true })).toBeInTheDocument();
    for (const name of ["RH et paie", "Gestion des stocks", "CRM", "Commandes de vente", "Trésorerie", "Conformité", "Risques", "Budget et prévisions"]) {
      expect(screen.queryByText(name, { exact: true })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Rôles et autorisations", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Gestion des modules", { exact: true })).not.toBeInTheDocument();
  });

  it.each(["/hr", "/payroll", "/inventory/transactions", "/crm/contacts", "/settings?tab=roles"])("refuse l'accès direct à %s avant de monter la page", async (path) => {
    showPage(path);
    await waitFor(() => expect(screen.queryByText("Données du module")).not.toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Accès refusé" })).toBeInTheDocument();
  });

  it("autorise les comptes clients avec le droit ar.invoice", async () => {
    showPage("/receivables/transactions");
    expect(await screen.findByText("Données du module")).toBeInTheDocument();
  });

  it("n'ouvre aucune page métier pendant le chargement ou après un échec, même avec d'anciens droits admin", () => {
    mocks.access = { data: { roles: ["admin"], permissions: [] }, isSuccess: false, isPending: false, isError: true, refetch: vi.fn() };
    showPage("/hr");
    expect(screen.queryByText("Données du module")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("attend la vérification des permissions avant de monter la page", () => {
    mocks.access = { data: undefined, isSuccess: false, isPending: true, isError: false };
    showPage("/hr");
    expect(screen.queryByText("Données du module")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("laisse l'administrateur ouvrir tous les modules", async () => {
    mocks.access = { data: { roles: ["admin"], permissions: [] }, isSuccess: true };
    showPage("/hr");
    expect(await screen.findByText("Données du module")).toBeInTheDocument();
  });
});
