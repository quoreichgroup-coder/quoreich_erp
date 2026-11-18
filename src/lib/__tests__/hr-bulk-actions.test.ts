import { describe, expect, it } from "vitest";
import {
  formatBulkActionOptions,
  getConfiguredBulkActions,
  parseBulkActionOptions,
} from "@/lib/hr-bulk-actions";

describe("configurable HR bulk actions", () => {
  it("parses configured value and label pairs", () => {
    expect(parseBulkActionOptions("active | Active\ninactive | Inactive")).toEqual({
      options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }],
      errors: [],
    });
  });

  it("rejects empty labels, duplicate values, and overlong option lists", () => {
    expect(parseBulkActionOptions("empty |\nactive | Actif\nactive | Inactif").errors).toEqual([
      "Ligne 1 : valeur et libellé sont obligatoires",
      "Ligne 3 : valeur déjà utilisée",
    ]);
    expect(parseBulkActionOptions(Array.from({ length: 201 }, (_, i) => `${i} | Valeur ${i}`).join("\n")).errors)
      .toContain("La limite de 200 valeurs est dépassée");
  });

  it("offers only active movement types with complete configured actions", () => {
    const actions = getConfiguredBulkActions([
      { id: "1", kind: "movement_type", code: "transfer", label: "Transfert", active: true, bulk_action_field: "department", bulk_action_options: [{ value: "Ops", label: "Opérations" }] },
      { id: "2", kind: "movement_type", code: "empty", label: "Non configuré", active: true, bulk_action_field: "status", bulk_action_options: [] },
      { id: "3", kind: "movement_type", code: "disabled", label: "Inactif", active: false, bulk_action_field: "status", bulk_action_options: [{ value: "off", label: "Inactif" }] },
      { id: "4", kind: "reason_code", code: "move", label: "Motif", active: true, bulk_action_field: null, bulk_action_options: [] },
    ]);

    expect(actions.map(({ code, field }) => ({ code, field }))).toEqual([{ code: "transfer", field: "department" }]);
    expect(formatBulkActionOptions(actions[0].options)).toBe("Ops | Opérations");
  });
});
