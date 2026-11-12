import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ codes: null as unknown, canEdit: true, create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/use-tax-codes", () => ({
  useTaxCodes: () => mocks.codes,
  useCreateTaxCode: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateTaxCode: () => ({ mutate: mocks.update, isPending: false }),
}));
vi.mock("@/hooks/use-accounting-setup", () => ({ useAccountingSetup: () => ({ data: { canEdit: mocks.canEdit } }) }));

import { TaxCodesPanel } from "../TaxCodesPanel";

const loaded = (data: unknown[]) => ({ isLoading: false, isError: false, data, refetch: vi.fn() });
beforeEach(() => { mocks.create.mockReset(); mocks.update.mockReset(); mocks.canEdit = true; });
afterEach(cleanup);

describe("TaxCodesPanel", () => {
  it("l'administrateur crée un code ; code en double et taux invalide bloqués", () => {
    mocks.codes = loaded([{ id: "t", code: "EXO", name: "Exonéré", rate: 0, active: true }]);
    render(<TaxCodesPanel />);
    fireEvent.change(screen.getByPlaceholderText("TVA18"), { target: { value: "exo" } });
    expect(screen.getByText("Ce code existe déjà.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("TVA18"), { target: { value: "tva18" } });
    fireEvent.change(screen.getByPlaceholderText("TVA 18 %"), { target: { value: "TVA 18 %" } });
    fireEvent.change(screen.getByPlaceholderText("18"), { target: { value: "18,555" } });
    expect(screen.getByTestId("btn-create-tax-code")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("18"), { target: { value: "18" } });
    fireEvent.click(screen.getByTestId("btn-create-tax-code"));
    expect(mocks.create).toHaveBeenCalledWith({ code: "TVA18", name: "TVA 18 %", rate: 18 }, expect.anything());
  });

  it("affiche taux et compte ; désactiver ne touche ni le code ni le taux", () => {
    mocks.codes = loaded([{ id: "t18", code: "TVA18", name: "TVA 18 %", rate: 18, active: true, accountCode: "4431", glAccountId: "a" }]);
    render(<TaxCodesPanel />);
    expect(screen.getByTestId("tax-code-TVA18")).toHaveTextContent("18,00 %");
    expect(screen.getByTestId("tax-code-TVA18")).toHaveTextContent("4431");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver" }));
    expect(mocks.update).toHaveBeenCalledWith({ id: "t18", name: "TVA 18 %", active: false, glAccountId: "a" });
  });

  it("hors administrateur : consultation seule ; liste vide annoncée", () => {
    mocks.canEdit = false;
    mocks.codes = loaded([]);
    render(<TaxCodesPanel />);
    expect(screen.getByTestId("tax-codes-empty")).toBeInTheDocument();
    expect(screen.getByTestId("tax-codes-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("new-tax-code-form")).toBeNull();
  });
});
