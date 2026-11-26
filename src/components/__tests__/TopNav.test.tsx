import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { MyAccess } from "@/hooks/use-my-access";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { name: "Entreprise", currency: "XOF" }, error: null }) }) }) }),
} }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => false, apiGet: vi.fn() }));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-a" }) }));
vi.mock("@/hooks/use-fiscal-calendar", () => ({ useFiscalCalendar: () => ({ data: { years: [] } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: "invite", email: "invite@example.test", user_metadata: { full_name: "Compte invité", role: "admin" } },
  signOut: vi.fn(),
}) }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import { TopNav } from "../TopNav";

const accessKey = ["my-access", "invite", "tenant-a", "supabase"];
const clients: QueryClient[] = [];

function showTopNav(access?: MyAccess, stale = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (access) client.setQueryData(accessKey, access, stale ? { updatedAt: 1 } : undefined);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SidebarProvider><TopNav /></SidebarProvider></MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => { mocks.rpc.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("identité du rôle dans la barre du haut", () => {
  it.each([
    ["un invité lecteur", ["viewer"], []],
    ["un comptable", ["accountant"], []],
    ["un administrateur de module", ["cash_admin"], []],
    ["un rôle sur mesure", [], ["treasury.manage_accounts"]],
    ["un membre sans rôle", [], []],
  ])("n'annonce pas %s comme administrateur de la société", (_name, roles, permissions) => {
    mocks.rpc.mockResolvedValue({ data: { roles, permissions }, error: null });
    showTopNav({ roles, permissions });
    expect(screen.queryByText("Admin", { exact: true })).not.toBeInTheDocument();
  });

  it("annonce Admin uniquement pour le rôle admin confirmé par le serveur", async () => {
    mocks.rpc.mockResolvedValue({ data: { roles: ["viewer", "admin"], permissions: [] }, error: null });
    showTopNav();
    expect(await screen.findByText("Admin", { exact: true })).toBeInTheDocument();
  });

  it("n'annonce pas Admin pendant le chargement des droits", () => {
    mocks.rpc.mockReturnValue(new Promise(() => {}));
    showTopNav();
    expect(screen.queryByText("Admin", { exact: true })).not.toBeInTheDocument();
  });

  it("retire le badge si la vérification des droits échoue, même avec un ancien accès admin en cache", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Accès refusé" } });
    const client = showTopNav({ roles: ["admin"], permissions: [] }, true);
    await waitFor(() => expect(client.getQueryState(accessKey)?.status).toBe("error"));
    expect(screen.queryByText("Admin", { exact: true })).not.toBeInTheDocument();
  });
});
