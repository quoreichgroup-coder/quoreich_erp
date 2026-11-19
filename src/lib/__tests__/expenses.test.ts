import { describe, expect, it } from "vitest";
import { policyIssues, splitTtc, sumBy } from "@/lib/expenses";

describe("notes de frais", () => {
  it("TVA comprise dans le TTC, comme la base (59 000 à 18 % → 50 000 HT + 9 000)", () => {
    expect(splitTtc(59000, 18)).toEqual({ net: 50000, tax: 9000 });
    expect(splitTtc(1000, null)).toEqual({ net: 1000, tax: 0 });
    expect(splitTtc(100, 18).tax).toBe(15.25);
  });

  it("règles : catégorie, justificatif (catégorie puis paramètre général), plafonds, délai", () => {
    const cats = [
      { id: "c1", name: "Déplacements", receipt_required_above: 10000, max_amount_per_line: 500000, is_active: true },
      { id: "c2", name: "Repas", receipt_required_above: null, max_amount_per_line: null, is_active: true },
    ];
    const settings = { receipt_required_above: 5000, max_report_amount: 700000, late_submission_days: 30 };
    const issues = policyIssues([
      { expense_date: "2041-03-01", category_id: "c1", amount: 600000, receipt_ref: "" },
      { expense_date: "2041-03-01", category_id: "c2", amount: 6000, receipt_ref: null },
      { expense_date: "2041-01-01", category_id: null, amount: 1000, receipt_ref: null },
    ], cats, settings, "2041-03-10");
    expect(issues).toEqual([
      "ligne 1 : justificatif exigé à partir de 10000",
      "ligne 1 : dépasse le plafond de la catégorie Déplacements (500000)",
      "ligne 2 : justificatif exigé à partir de 5000",
      "ligne 3 : catégorie manquante",
    ]);
    expect(policyIssues([{ expense_date: "2041-03-01", category_id: "c2", amount: 800000, receipt_ref: "F1" }], cats, settings, "2041-03-10"))
      .toContain("total 800000 au-delà du plafond par note (700000)");
    expect(policyIssues([{ expense_date: "2041-01-01", category_id: "c2", amount: 10, receipt_ref: null }], cats, settings, "2041-03-10"))
      .toEqual(["ligne 1 : au-delà du délai de 30 jours"]);
    expect(policyIssues([], cats, null, "2041-03-10")).toEqual(["Une note sans dépense ne se soumet pas"]);
  });

  it("totaux par clé, du plus grand au plus petit", () => {
    expect(sumBy([{ c: "A", m: 10 }, { c: "B", m: 30 }, { c: "A", m: 5 }], (r) => r.c, (r) => r.m))
      .toEqual([{ label: "B", amount: 30, count: 1 }, { label: "A", amount: 15, count: 2 }]);
  });
});
