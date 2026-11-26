import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProcurementControlSettings } from "@/components/ProcurementControlSettings";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), canEdit: true }));
vi.mock("@/hooks/use-procurement-data", () => ({
  useProcurementSettings: () => ({ data: settings }),
  useUpdateProcurementSettings: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("@/hooks/use-my-access", () => ({
  useMyAccess: () => ({ data: { permissions: mocks.canEdit ? ["procurement.settings"] : [] } }),
}));
let settings: Record<string, unknown>;
beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.canEdit = true;
  settings = { id: "settings", service_acceptance_second_person: true };
});

it("loads and saves the service acceptance rule", () => {
  render(<ProcurementControlSettings />);
  const control = screen.getByRole("switch", { name: "Service fait attesté par une autre personne" });
  expect(control).toBeChecked();
  fireEvent.click(control);
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ service_acceptance_second_person: false }));
});

it("requires procurement settings permission to change the rule", () => {
  mocks.canEdit = false;
  render(<ProcurementControlSettings />);
  expect(screen.getByRole("switch", { name: "Service fait attesté par une autre personne" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
});
