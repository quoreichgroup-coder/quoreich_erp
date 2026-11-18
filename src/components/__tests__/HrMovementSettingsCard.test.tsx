import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HrMovementSettingsCard } from "@/components/HrMovementSettingsCard";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), mutate: vi.fn() }));
vi.mock("@/hooks/use-hr-data", () => ({
  useHrMovementReferences: () => ({ isLoading: false, isError: false, data: [] }),
  useSaveHrMovementReference: () => ({ mutateAsync: mocks.mutateAsync, mutate: mocks.mutate, isPending: false }),
}));

describe("HrMovementSettingsCard", () => {
  beforeEach(() => { mocks.mutateAsync.mockReset().mockResolvedValue({ id: "movement" }); mocks.mutate.mockReset(); });

  it("persists a movement action from configured values", async () => {
    render(<HrMovementSettingsCard canManage />);
    fireEvent.change(screen.getByLabelText("Référentiel"), { target: { value: "movement_type" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "transfer" } });
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Transfert" } });
    fireEvent.change(screen.getByLabelText("Champ modifiable en masse"), { target: { value: "department" } });
    fireEvent.change(screen.getByLabelText("Valeurs autorisées (une par ligne : valeur | libellé)"), { target: { value: "finance | Finance\noperations | Opérations" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      kind: "movement_type", code: "transfer", bulk_action_field: "department",
      bulk_action_options: [{ value: "finance", label: "Finance" }, { value: "operations", label: "Opérations" }],
    }));
  });

  it("refuses an action whose configured values are invalid", () => {
    render(<HrMovementSettingsCard canManage />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "transfer" } });
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Transfert" } });
    fireEvent.change(screen.getByLabelText("Champ modifiable en masse"), { target: { value: "department" } });
    fireEvent.change(screen.getByLabelText("Valeurs autorisées (une par ligne : valeur | libellé)"), { target: { value: "finance | Finance\nfinance | Autre" } });
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
