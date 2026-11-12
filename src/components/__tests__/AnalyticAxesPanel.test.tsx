import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalyticsSetup } from "@/lib/analytics-setup";

const mocks = vi.hoisted(() => ({
  setup: null as unknown,
  createAxis: vi.fn(), updateAxis: vi.fn(), createValue: vi.fn(), updateValue: vi.fn(), setRule: vi.fn(), deleteRule: vi.fn(),
}));

const m = (fn: unknown) => ({ mutate: fn, isPending: false });
vi.mock("@/hooks/use-analytics-setup", () => ({
  useAnalyticsSetup: () => mocks.setup,
  useCreateAnalyticAxis: () => m(mocks.createAxis),
  useUpdateAnalyticAxis: () => m(mocks.updateAxis),
  useCreateAnalyticValue: () => m(mocks.createValue),
  useUpdateAnalyticValue: () => m(mocks.updateValue),
  useSetAnalyticRule: () => m(mocks.setRule),
  useDeleteAnalyticRule: () => m(mocks.deleteRule),
}));

import { AnalyticAxesPanel } from "../AnalyticAxesPanel";

const loaded = (data: AnalyticsSetup) => ({ isLoading: false, isError: false, data, refetch: vi.fn() });

const dept = {
  id: "dept", code: "DEPT", name: "Département", sortOrder: 1, active: true,
  values: [
    { id: "com", code: "COM", name: "Commercial", active: true },
    { id: "com-est", code: "COM-EST", name: "Commercial Est", parentId: "com", active: true },
    { id: "anc", code: "ANC", name: "Ancien", active: false, validTo: "2025-12-31" },
  ],
  rules: [{ accountPrefix: "7", requirement: "required" as const }, { accountPrefix: "4", requirement: "forbidden" as const }],
};

beforeEach(() => Object.values(mocks).forEach((f) => typeof f === "function" && (f as any).mockReset?.()));
afterEach(cleanup);

describe("AnalyticAxesPanel", () => {
  it("aucun axe : l'administrateur peut en créer un, le code est mis en majuscules et contrôlé", () => {
    mocks.setup = loaded({ canManageAxes: true, canManageValues: true, axes: [] });
    render(<AnalyticAxesPanel />);
    expect(screen.getByTestId("analytics-empty")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("DEPT"), { target: { value: "1dept" } });
    expect(screen.getByTestId("btn-create-axis")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("DEPT"), { target: { value: "dept" } });
    fireEvent.change(screen.getByPlaceholderText("Département"), { target: { value: "Département" } });
    fireEvent.click(screen.getByTestId("btn-create-axis"));
    expect(mocks.createAxis).toHaveBeenCalledWith({ code: "DEPT", name: "Département", sortOrder: 1 }, expect.anything());
  });

  it("affiche les sections en arbre, leur validité et leur état", () => {
    mocks.setup = loaded({ canManageAxes: true, canManageValues: true, axes: [dept] });
    render(<AnalyticAxesPanel />);
    const rows = within(screen.getByTestId("axis-detail-DEPT")).getAllByTestId(/value-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["value-row-ANC", "value-row-COM", "value-row-COM-EST"]);
    expect(screen.getByTestId("value-row-COM-EST")).toHaveTextContent("└ COM-EST");
    expect(screen.getByTestId("value-row-ANC")).toHaveTextContent("… → 2025-12-31");
    expect(screen.getByTestId("value-row-ANC")).toHaveTextContent("Inactive");
  });

  it("le comptable ajoute une section sous un parent, mais ne crée ni axe ni règle", () => {
    mocks.setup = loaded({ canManageAxes: false, canManageValues: true, axes: [dept] });
    render(<AnalyticAxesPanel />);
    expect(screen.queryByTestId("btn-create-axis")).toBeNull();
    expect(screen.queryByTestId("new-rule-form")).toBeNull();
    expect(screen.queryByTestId("btn-toggle-axis")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("COM"), { target: { value: "COM-OUEST" } });
    fireEvent.change(screen.getByPlaceholderText("Commercial"), { target: { value: "Commercial Ouest" } });
    fireEvent.change(document.getElementById("new-value-parent")!, { target: { value: "com" } });
    fireEvent.click(screen.getByTestId("btn-create-value"));
    expect(mocks.createValue).toHaveBeenCalledWith(
      { axisId: "dept", code: "COM-OUEST", name: "Commercial Ouest", parentId: "com", validFrom: "", validTo: "" }, expect.anything());
  });

  it("refuse des dates de validité inversées avant tout envoi", () => {
    mocks.setup = loaded({ canManageAxes: true, canManageValues: true, axes: [dept] });
    render(<AnalyticAxesPanel />);
    fireEvent.change(screen.getByPlaceholderText("COM"), { target: { value: "T" } });
    fireEvent.change(screen.getByPlaceholderText("Commercial"), { target: { value: "Test" } });
    fireEvent.change(document.getElementById("new-value-from")!, { target: { value: "2030-02-01" } });
    fireEvent.change(document.getElementById("new-value-to")!, { target: { value: "2030-01-01" } });
    expect(screen.getByTestId("btn-create-value")).toBeDisabled();
    expect(screen.getByText("La date de début doit précéder la date de fin.")).toBeInTheDocument();
  });

  it("l'administrateur pose et retire une règle", () => {
    mocks.setup = loaded({ canManageAxes: true, canManageValues: true, axes: [dept] });
    render(<AnalyticAxesPanel />);
    fireEvent.change(document.getElementById("new-rule-prefix")!, { target: { value: "6a" } });
    fireEvent.change(document.getElementById("new-rule-requirement")!, { target: { value: "forbidden" } });
    fireEvent.click(screen.getByTestId("btn-set-rule"));
    expect(mocks.setRule).toHaveBeenCalledWith({ axisId: "dept", prefix: "6", requirement: "forbidden" }, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Retirer la règle 4" }));
    expect(mocks.deleteRule).toHaveBeenCalledWith({ axisId: "dept", prefix: "4" });
  });

  it("l'aperçu applique la règle au préfixe le plus long", () => {
    mocks.setup = loaded({ canManageAxes: false, canManageValues: false, axes: [dept] });
    render(<AnalyticAxesPanel />);
    expect(screen.getByTestId("preview-DEPT")).toHaveTextContent("Obligatoire");
    fireEvent.change(document.getElementById("preview-account")!, { target: { value: "411" } });
    expect(screen.getByTestId("preview-DEPT")).toHaveTextContent("Interdit");
    fireEvent.change(document.getElementById("preview-account")!, { target: { value: "601" } });
    expect(screen.getByTestId("preview-DEPT")).toHaveTextContent("Facultatif");
  });

  it("erreur de lecture : message et reprise manuelle", () => {
    const refetch = vi.fn();
    mocks.setup = { isLoading: false, isError: true, error: new Error("relation absente"), data: undefined, refetch };
    render(<AnalyticAxesPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("relation absente");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refetch).toHaveBeenCalled();
  });
});
