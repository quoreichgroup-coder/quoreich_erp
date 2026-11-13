import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Authorizations } from "@/lib/authorizations";

const mocks = vi.hoisted(() => ({
  view: null as unknown,
  create: vi.fn(), update: vi.fn(), setPerms: vi.fn(), remove: vi.fn(), assign: vi.fn(), revoke: vi.fn(),
}));
const m = (fn: unknown) => ({ mutate: fn, isPending: false });
vi.mock("@/hooks/use-authorizations", () => ({
  useAuthorizations: () => mocks.view,
  useAuthorizationAudit: () => ({ isLoading: false, isError: false, data: [
    { at: "2026-11-13T08:00:00Z", actor: "Awa", action: "role_assigned", roleName: "Caissier", targetUser: "Zoé" },
  ] }),
  useCreateRole: () => m(mocks.create),
  useUpdateRole: () => m(mocks.update),
  useSetRolePermissions: () => m(mocks.setPerms),
  useDeleteRole: () => m(mocks.remove),
  useAssignRole: () => m(mocks.assign),
  useRevokeRole: () => m(mocks.revoke),
}));

import { AuthorizationsPanel } from "../AuthorizationsPanel";

const base = (over: Partial<Authorizations> = {}): Authorizations => ({
  canManage: true,
  catalog: [
    { code: "treasury.match", module: "treasury", action: "match", label: "Rapprocher des opérations" },
    { code: "treasury.export", module: "treasury", action: "export", label: "Exporter la trésorerie" },
  ],
  roles: [
    { id: "r-cai", name: "Caissier", system: false, needsReview: false, permissions: ["treasury.match"], memberCount: 1 },
    { id: "r-old", name: "Ancien rôle", system: false, needsReview: true, permissions: [], memberCount: 0 },
    { id: "r-adm", name: "Administrateur", code: "admin", system: true, needsReview: false, permissions: ["treasury.match", "treasury.export"], memberCount: 1 },
  ],
  users: [
    { id: "u-awa", fullName: "Awa", roleIds: ["r-adm"] },
    { id: "u-zoe", fullName: "Zoé", roleIds: ["r-cai"] },
  ],
  ...over,
});
const loaded = (data: Authorizations) => ({ isLoading: false, isError: false, data, refetch: vi.fn() });

beforeEach(() => Object.values(mocks).forEach((f) => (f as any)?.mockReset?.()));
afterEach(cleanup);

describe("AuthorizationsPanel", () => {
  it("rôle sur mesure : cocher un droit puis enregistrer la liste complète ; suppression bloquée s'il est affecté", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    expect(screen.getByTestId("btn-delete-role")).toBeDisabled();
    fireEvent.click(screen.getByTestId("perm-treasury.export"));
    fireEvent.click(screen.getByTestId("btn-save-permissions"));
    expect(mocks.setPerms).toHaveBeenCalledWith({ id: "r-cai", permissions: ["treasury.match", "treasury.export"], current: ["treasury.match"] });
  });

  it("rôle système : droits en lecture seule, ni renommage ni suppression", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    fireEvent.click(screen.getByTestId("role-item-admin"));
    expect(screen.getByTestId("perm-treasury.export")).toBeDisabled();
    expect(screen.queryByTestId("btn-delete-role")).toBeNull();
    expect(screen.getByText(/Créez un rôle sur mesure en le copiant/)).toBeInTheDocument();
  });

  it("rôle à revoir : annoncé sans effet, activable", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    fireEvent.click(screen.getByTestId("role-item-Ancien rôle"));
    expect(screen.getByTestId("role-needs-review")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-activate-role"));
    expect(mocks.update).toHaveBeenCalledWith({ id: "r-old", name: "Ancien rôle", description: "", active: true });
  });

  it("utilisateurs : le dernier administrateur ne peut pas être retiré ; un rôle à revoir n'est pas proposé", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    fireEvent.click(screen.getByTestId("authz-tab-users"));
    expect(screen.getByRole("button", { name: "Retirer Administrateur à Awa" })).toBeDisabled();
    const select = screen.getByRole("combobox", { name: "Affecter un rôle à Zoé" });
    expect(within(select).queryByText("Ancien rôle")).toBeNull();
    fireEvent.change(select, { target: { value: "r-adm" } });
    expect(mocks.assign).toHaveBeenCalledWith({ userId: "u-zoe", roleId: "r-adm" });
    fireEvent.click(screen.getByRole("button", { name: "Retirer Caissier à Zoé" }));
    expect(mocks.revoke).toHaveBeenCalledWith({ userId: "u-zoe", roleId: "r-cai" });
  });

  it("créer un rôle en copiant un rôle existant ; nom déjà pris bloqué", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    fireEvent.change(screen.getByPlaceholderText("Caissier"), { target: { value: "caissier" } });
    expect(screen.getByText("Un rôle porte déjà ce nom.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Caissier"), { target: { value: "Caissier Ouaga" } });
    fireEvent.change(document.getElementById("new-role-copy")!, { target: { value: "r-cai" } });
    fireEvent.click(screen.getByTestId("btn-create-role"));
    expect(mocks.create).toHaveBeenCalledWith({ name: "Caissier Ouaga", description: "", copyFromRoleId: "r-cai" }, expect.anything());
  });

  it("hors administrateur : consultation seule, pas de journal, rien de modifiable", () => {
    mocks.view = loaded(base({ canManage: false }));
    render(<AuthorizationsPanel />);
    expect(screen.getByTestId("authorizations-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("authz-tab-audit")).toBeNull();
    expect(screen.queryByTestId("new-role-form")).toBeNull();
    expect(screen.getByTestId("perm-treasury.match")).toBeDisabled();
  });

  it("journal : changements datés, auteur et détail", () => {
    mocks.view = loaded(base());
    render(<AuthorizationsPanel />);
    fireEvent.click(screen.getByTestId("authz-tab-audit"));
    expect(screen.getByTestId("audit-tab")).toHaveTextContent("Rôle affecté");
    expect(screen.getByTestId("audit-tab")).toHaveTextContent("Caissier → Zoé");
  });
});
