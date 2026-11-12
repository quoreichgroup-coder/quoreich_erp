import { describe, expect, it } from "vitest";
import { buildAnalyticsSetup, requiredAxisIds, requirementsFor, usableValues, valueTree, type AnalyticValue } from "../analytics-setup";

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

describe("analytique — sections proposées et axes obligatoires", () => {
  const setup = buildAnalyticsSetup({
    canManageAxes: true, canManageValues: true,
    axes: [{ id: "dept", code: "DEPT", name: "Département", sort_order: 1, is_active: true }],
    values: [
      { id: "ok", axis_id: "dept", code: "OK", name: "Active", parent_id: null, valid_from: null, valid_to: null, is_active: true },
      { id: "off", axis_id: "dept", code: "OFF", name: "Inactive", parent_id: null, valid_from: null, valid_to: null, is_active: false },
      { id: "fut", axis_id: "dept", code: "FUT", name: "Future", parent_id: null, valid_from: "2031-01-01", valid_to: null, is_active: true },
      { id: "old", axis_id: "dept", code: "OLD", name: "Échue", parent_id: null, valid_from: null, valid_to: "2029-12-31", is_active: true },
    ],
    rules: [{ axis_id: "dept", account_prefix: "7", requirement: "required" }],
  });

  it("ne propose que les sections actives et valides à la date, bornes incluses", () => {
    expect(usableValues(setup.axes[0], "2030-06-01").map((v) => v.code)).toEqual(["OK"]);
    expect(usableValues(setup.axes[0], "2031-01-01").map((v) => v.code)).toEqual(["FUT", "OK"]);
    expect(usableValues(setup.axes[0], "2029-12-31").map((v) => v.code)).toEqual(["OK", "OLD"]);
  });

  it("déduit les axes obligatoires du compte de ventes ; rien sans compte ni paramétrage", () => {
    expect([...requiredAxisIds(setup, "701")]).toEqual(["dept"]);
    expect(requiredAxisIds(setup, "4000").size).toBe(0);
    expect(requiredAxisIds(setup, undefined).size).toBe(0);
    expect(requiredAxisIds(undefined, "701").size).toBe(0);
  });
});
