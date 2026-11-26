import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Authorizations } from "@/lib/authorizations";

const mocks = vi.hoisted(() => ({ canManage: true, assignmentCase: false, save: vi.fn() }));
const fixture = (): Authorizations => ({
  canManage: mocks.canManage,
  catalog: [{ code: "assets.depreciate", module: "assets", action: "depreciate", label: "Calculer les amortissements" }],
  roles: [
    { id: "comptable", code: "accountant", name: "Comptable", system: true, needsReview: false, permissions: ["assets.depreciate"], memberCount: 1 },
    { id: "admin", code: "admin", name: "Administrateur", system: true, needsReview: false, permissions: ["assets.depreciate"], memberCount: 1 },
  ],
  users: [],
});
function mutation() { return { mutate: vi.fn(), isPending: false }; }
vi.mock("@/hooks/use-authorizations", () => ({
  useAuthorizations: () => ({ isLoading: false, data: fixture() }),
  useAuthorizationAudit: () => ({ data: [], isLoading: false }),
  useCreateRole: mutation, useUpdateRole: mutation, useDeleteRole: mutation, useAssignRole: mutation, useRevokeRole: mutation,
  useSetRolePermissions: () => ({ mutate: mocks.save, isPending: false }),
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/hooks/use-rbac-data", () => ({
  useTenantProfiles: () => ({ data: mocks.assignmentCase ? [{ id: "u-awa", full_name: "Awa" }] : [] }),
}));
vi.mock("@/hooks/use-project-data", () => ({
  useTenantProjectRoles: () => ({ data: new Map([["u-awa", ["project_planner"]]]) }), useProjectRoleAudit: () => ({ data: [] }),
  useAssignProjectRole: mutation, useMyProjectRoles: () => ({}),
}));
vi.mock("@/hooks/use-expense-data", () => ({
  useTenantExpenseRoles: () => ({ data: new Map([["u-awa", ["expense_clerk"]]]) }), useExpenseRoleAudit: () => ({ data: [] }),
  useAssignExpenseRole: mutation, useMyExpenseRoles: () => ({}),
}));
vi.mock("@/hooks/use-fixed-assets-data", () => ({
  useTenantFixedAssetRoles: () => ({ data: new Map() }), useFixedAssetRoleAudit: () => ({ data: [] }),
  useAssignFixedAssetRole: mutation, useMyFixedAssetRoles: () => ({}),
}));
vi.mock("@/hooks/use-crm-data", () => ({
  useTenantCrmRoles: () => ({ data: new Map([["u-awa", ["crm_manager"]]]) }), useAssignCrmRole: mutation,
  useMyCrmRoles: () => ({ canManageSettings: mocks.canManage }),
}));

import { MemoryRouter } from "react-router-dom";
import { ProjectRolesPanel } from "../ProjectRolesPanel";
import { ExpenseRolesPanel } from "../ExpenseRolesPanel";
import { FixedAssetsRolesPanel } from "../FixedAssetsRolesPanel";
import CrmSettings from "@/pages/CrmSettings";

beforeEach(() => { mocks.canManage = true; mocks.assignmentCase = false; mocks.save.mockReset(); });
afterEach(cleanup);

describe.each([
  ["Projets", ProjectRolesPanel], ["Notes de frais", ExpenseRolesPanel],
  ["Immobilisations", FixedAssetsRolesPanel], ["CRM", CrmSettings],
] as const)("rôles du module %s", (_name, Editor) => {
  it("personnalise les droits du Comptable existant sans copier le rôle", () => {
    render(<MemoryRouter><Editor /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("role-item-accountant"));
    fireEvent.click(screen.getByTestId("perm-assets.depreciate"));
    fireEvent.click(screen.getByTestId("btn-save-permissions"));
    expect(mocks.save).toHaveBeenCalledWith({ id: "comptable", permissions: [], current: ["assets.depreciate"] });
    expect(screen.queryByTestId("authz-tab-users")).toBeNull();
    expect(screen.queryByTestId("authz-tab-invitations")).toBeNull();
  });

  it("protège le rôle Administrateur et la consultation des non-administrateurs", () => {
    const { unmount } = render(<MemoryRouter><Editor /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("role-item-admin"));
    expect(screen.getByTestId("perm-assets.depreciate")).toBeDisabled();
    expect(screen.queryByTestId("btn-save-permissions")).toBeNull();
    unmount();
    mocks.canManage = false;
    render(<MemoryRouter><Editor /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("role-item-accountant"));
    expect(screen.getByTestId("perm-assets.depreciate")).toBeDisabled();
    expect(screen.getByTestId("authorizations-readonly")).toBeInTheDocument();
  });
});

describe("affectations des modules : séparation des rôles conservée", () => {
  it.each([
    ["Projets", ProjectRolesPanel, /Contrôleur.*bloqué SoD/],
    ["Notes de frais", ExpenseRolesPanel, /Approbateur.*bloqué SoD/],
  ] as const)("%s conserve l'option incompatible désactivée", (_name, Panel, conflictLabel) => {
    mocks.assignmentCase = true;
    render(<MemoryRouter><Panel /></MemoryRouter>);
    expect(screen.getByRole("option", { name: conflictLabel })).toBeDisabled();
    expect(screen.queryByTestId("authz-tab-users")).toBeNull();
  });

  it("CRM conserve le refus d'attribuer Agent à un utilisateur déjà Manager", () => {
    render(<MemoryRouter><CrmSettings /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("UUID…"), { target: { value: "u-awa" } });
    expect(screen.getByText(/Conflit SoD/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attribuer" })).toBeDisabled();
    expect(screen.queryByTestId("authz-tab-users")).toBeNull();
  });
});
