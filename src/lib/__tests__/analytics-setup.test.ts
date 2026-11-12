import { describe, expect, it } from "vitest";
import { buildAnalyticsSetup, requirementsFor, valueTree, type AnalyticValue } from "../analytics-setup";

const v = (id: string, code: string, parentId?: string): AnalyticValue => ({ id, code, name: code, parentId, active: true });

describe("analytique — arbre des sections", () => {
  it("place chaque enfant sous son parent, avec sa profondeur, dans l'ordre des codes", () => {
    const tree = valueTree([v("c", "COM-EST", "a"), v("b", "PROD"), v("a", "COM"), v("d", "COM-EST-1", "c")]);
    expect(tree.map((t) => `${t.depth}:${t.value.code}`)).toEqual(["0:COM", "1:COM-EST", "2:COM-EST-1", "0:PROD"]);
  });

  it("une section dont le parent est invisible remonte à la racine au lieu de disparaître", () => {
    expect(valueTree([v("x", "ORPHELIN", "absent")]).map((t) => t.depth)).toEqual([0]);
  });
});

describe("analytique — ce qu'exige un compte", () => {
  const setup = buildAnalyticsSetup({
    canManageAxes: true, canManageValues: true,
    axes: [
      { id: "cc", code: "CC", name: "Centre de coûts", sort_order: 2, is_active: true },
      { id: "dept", code: "DEPT", name: "Département", sort_order: 1, is_active: true },
      { id: "old", code: "OLD", name: "Ancien axe", sort_order: 3, is_active: false },
    ],
    values: [],
    rules: [
      { axis_id: "dept", account_prefix: "7", requirement: "required" },
      { axis_id: "dept", account_prefix: "709", requirement: "forbidden" },
      { axis_id: "old", account_prefix: "7", requirement: "required" },
    ],
  });

  it("trie les axes comme l'API et applique la règle au préfixe le plus long", () => {
    expect(setup.axes.map((a) => a.code)).toEqual(["DEPT", "CC", "OLD"]);
    expect(requirementsFor(setup, "701").map((r) => `${r.axis.code}=${r.requirement}`)).toEqual(["DEPT=required", "CC=optional"]);
    expect(requirementsFor(setup, "7091")[0]).toMatchObject({ requirement: "forbidden", rule: { accountPrefix: "709" } });
    expect(requirementsFor(setup, "411")[0].requirement).toBe("optional");
  });

  it("un axe inactif n'est ni contrôlé ni proposé", () => {
    expect(requirementsFor(setup, "701").some((r) => r.axis.code === "OLD")).toBe(false);
  });

  it("un compte vide ne déclenche aucune règle", () => {
    expect(requirementsFor(setup, "  ").every((r) => r.requirement === "optional")).toBe(true);
  });
});
