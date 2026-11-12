import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ setup: undefined as unknown, defaults: [] as unknown[], save: vi.fn() }));
vi.mock("@/hooks/use-analytics-setup", () => ({
  useAnalyticsSetup: () => ({ data: mocks.setup }),
  useCustomerAnalyticDefaults: () => ({ data: mocks.defaults }),
  useSetCustomerAnalyticDefault: () => ({ mutate: mocks.save, isPending: false }),
}));

import { AnalyticSelectors, CustomerAnalyticDefaults } from "../AnalyticSelectors";

const axis = (active = true) => ({
  id: "dept", code: "DEPT", name: "Département", sortOrder: 1, active, rules: [],
  values: [
    { id: "com", code: "COM", name: "Commercial", active: true },
    { id: "anc", code: "ANC", name: "Ancien", active: false },
    { id: "fut", code: "FUT", name: "Futur", active: true, validFrom: "2031-01-01" },
  ],
});

beforeEach(() => { mocks.save.mockReset(); mocks.defaults = []; });
afterEach(cleanup);

describe("AnalyticSelectors", () => {
  it("sans axe actif : ne rend rien", () => {
    mocks.setup = { canManageAxes: true, canManageValues: true, axes: [axis(false)] };
    const { container } = render(<AnalyticSelectors date="2030-01-01" value={{}} onChange={() => {}} idPrefix="t" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ne propose que les sections imputables à la date et signale l'axe obligatoire", () => {
    mocks.setup = { canManageAxes: true, canManageValues: true, axes: [axis()] };
    const onChange = vi.fn();
    render(<AnalyticSelectors date="2030-01-01" value={{}} onChange={onChange} required={new Set(["dept"])} idPrefix="t" />);
    const select = document.getElementById("t-axis-DEPT") as HTMLSelectElement;
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["— Aucune —", "COM Commercial"]);
    expect(screen.getByText("* obligatoire")).toBeInTheDocument();
    expect(select).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(select, { target: { value: "com" } });
    expect(onChange).toHaveBeenCalledWith("dept", "com");
  });

  it("une section déjà choisie devenue inutilisable reste visible et marquée", () => {
    mocks.setup = { canManageAxes: true, canManageValues: true, axes: [axis()] };
    render(<AnalyticSelectors date="2030-01-01" value={{ dept: "anc" }} onChange={() => {}} idPrefix="t" />);
    expect(document.getElementById("t-axis-DEPT")).toHaveDisplayValue("ANC Ancien (inutilisable)");
  });
});

describe("CustomerAnalyticDefaults", () => {
  it("affiche le défaut du client, l'enregistre au choix et le retire au vidage", () => {
    mocks.setup = { canManageAxes: false, canManageValues: true, axes: [axis()] };
    mocks.defaults = [{ axisId: "dept", valueId: "com" }];
    render(<CustomerAnalyticDefaults customerId="c1" />);
    const select = document.getElementById("customer-default-axis-DEPT") as HTMLSelectElement;
    expect(select).toHaveDisplayValue("COM Commercial");
    fireEvent.change(select, { target: { value: "" } });
    expect(mocks.save).toHaveBeenCalledWith({ customerId: "c1", axisId: "dept", valueId: undefined });
  });

  it("sans droit : consultation seule", () => {
    mocks.setup = { canManageAxes: false, canManageValues: false, axes: [axis()] };
    render(<CustomerAnalyticDefaults customerId="c1" />);
    expect(document.getElementById("customer-default-axis-DEPT")).toBeDisabled();
  });
});
