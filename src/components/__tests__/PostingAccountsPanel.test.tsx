import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AccountingSetup } from "@/lib/accounting-setup";

const mocks = vi.hoisted(() => ({
  setup: null as unknown,
  apply: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@/hooks/use-accounting-setup", () => ({
  useAccountingSetup: () => mocks.setup,
  useAccountingFrameworks: () => ({ data: [{ code: "SYSCOHADA_REVISE", name: "SYSCOHADA révisé", scope: "OHADA", version: "2017", validated: false }] }),
  useGlAccountOptions: () => ({
    data: [
      { id: "acc-411", code: "411", name: "Clients", accountType: "asset", active: true },
      { id: "acc-706", code: "706", name: "Services vendus", accountType: "revenue", active: true },
      { id: "acc-701", code: "701", name: "Ventes de marchandises", accountType: "revenue", active: false },
    ],
  }),
  useApplyAccountingFramework: () => ({ mutate: mocks.apply, isPending: false }),
  useAssignPostingAccount: () => ({ mutate: mocks.assign, isPending: false }),
}));

import { PostingAccountsPanel } from "../PostingAccountsPanel";

function loaded(data: AccountingSetup) {
  return { isLoading: false, isError: false, data, refetch: vi.fn() };
}

const role = (code: string, module: string, label: string, extra: Partial<AccountingSetup["roles"][number]> = {}) => ({
  roleCode: code, label, module, description: `${label} — description`, ready: false, ...extra,
});

beforeEach(() => {
  mocks.apply.mockReset();
  mocks.assign.mockReset();
});
afterEach(cleanup);

describe("PostingAccountsPanel", () => {
  it("société vierge, administrateur : signale les rôles manquants et applique le référentiel choisi", () => {
    mocks.setup = loaded({
      canEdit: true, complete: false,
      roles: [role("AR_RECEIVABLE", "AR", "Compte clients"), role("BANK", "TRE", "Banque")],
    });
    render(<PostingAccountsPanel />);

    expect(screen.getByTestId("posting-accounts-missing")).toHaveTextContent("2 rôle(s) à paramétrer : Compte clients, Banque");
    fireEvent.click(screen.getByTestId("btn-apply-framework"));
    expect(mocks.apply).toHaveBeenCalledWith("SYSCOHADA_REVISE");
  });

  it("change le compte d'un rôle ; les comptes inactifs ne sont pas proposés", () => {
    mocks.setup = loaded({
      canEdit: true, complete: true,
      framework: { code: "SYSCOHADA_REVISE", name: "SYSCOHADA révisé", scope: "OHADA", version: "2017", validated: false },
      roles: [role("SALES_REVENUE", "AR", "Ventes", { glAccountId: "acc-706", accountCode: "706", accountName: "Services vendus", ready: true, suggestedAccountCode: "701" })],
    });
    render(<PostingAccountsPanel />);

    expect(screen.getByTestId("posting-accounts-complete")).toBeInTheDocument();
    expect(screen.getByTestId("posting-accounts-framework")).toHaveTextContent("expert-comptable local");
    const select = screen.getByLabelText("Compte pour Ventes") as HTMLSelectElement;
    expect(within(select).queryByText(/701 Ventes de marchandises/)).toBeNull();
    fireEvent.change(select, { target: { value: "acc-411" } });
    expect(mocks.assign).toHaveBeenCalledWith({ role: "SALES_REVENUE", glAccountId: "acc-411" });
  });

  it("compte actuel devenu inactif : reste visible, marqué inactif, et le rôle n'est pas prêt", () => {
    mocks.setup = loaded({
      canEdit: true, complete: false,
      roles: [role("SALES_REVENUE", "AR", "Ventes", { glAccountId: "acc-701", accountCode: "701", accountName: "Ventes de marchandises", ready: false })],
    });
    render(<PostingAccountsPanel />);
    expect(screen.getByLabelText("Compte pour Ventes")).toHaveDisplayValue("701 Ventes de marchandises (inactif)");
    expect(within(screen.getByTestId("posting-role-SALES_REVENUE")).getByText("À paramétrer")).toBeInTheDocument();
  });

  it("hors administrateur : consultation seule, aucun bouton ni sélecteur actif", () => {
    mocks.setup = loaded({ canEdit: false, complete: false, roles: [role("BANK", "TRE", "Banque")] });
    render(<PostingAccountsPanel />);
    expect(screen.queryByTestId("btn-apply-framework")).toBeNull();
    expect(screen.getByLabelText("Compte pour Banque")).toBeDisabled();
    expect(screen.getByTestId("posting-accounts-readonly")).toBeInTheDocument();
  });

  it("filtre par module (réglages AR) : les rôles fournisseurs ne sont ni affichés ni comptés", () => {
    mocks.setup = loaded({
      canEdit: true, complete: false,
      roles: [role("AR_RECEIVABLE", "AR", "Compte clients"), role("AP_PAYABLE", "AP", "Compte fournisseurs")],
    });
    render(<PostingAccountsPanel modules={["AR", "TRE"]} />);
    expect(screen.queryByTestId("posting-role-AP_PAYABLE")).toBeNull();
    expect(screen.getByTestId("posting-accounts-missing")).toHaveTextContent("1 rôle(s) à paramétrer : Compte clients.");
  });

  it("aucun rôle lu : n'annonce jamais un paramétrage complet", () => {
    mocks.setup = loaded({ canEdit: true, complete: false, roles: [] });
    render(<PostingAccountsPanel />);
    expect(screen.getByTestId("posting-accounts-no-roles")).toBeInTheDocument();
    expect(screen.queryByTestId("posting-accounts-complete")).toBeNull();
  });

  it("erreur de lecture : message visible et reprise manuelle", () => {
    const refetch = vi.fn();
    mocks.setup = { isLoading: false, isError: true, error: new Error("permission denied"), data: undefined, refetch };
    render(<PostingAccountsPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refetch).toHaveBeenCalled();
  });
});
