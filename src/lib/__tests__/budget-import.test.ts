import { describe, expect, it } from "vitest";
import { budgetImportRows, detectBudgetColumns, normalizePeriod, parseAmount } from "@/lib/budget-import";

describe("budget-import", () => {
  it("reconnaît les en-têtes usuels, quel que soit l'ordre et les accents", () => {
    expect(detectBudgetColumns(["Montant budgété", "Periode", "N° compte", "Centre de coût", "Remarque"]))
      .toEqual({ amount: "Montant budgété", period: "Periode", account: "N° compte", section: "Centre de coût", comment: "Remarque" });
  });

  it("lit les montants à la française et à l'anglaise", () => {
    expect(parseAmount("1 500 000")).toBe(1500000);
    expect(parseAmount("2 500,50")).toBe(2500.5);
    expect(parseAmount("1.250.000,75")).toBe(1250000.75);
    expect(parseAmount("1,250,000.75")).toBe(1250000.75);
    expect(parseAmount("12000 FCFA")).toBe(12000);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("normalise les périodes", () => {
    expect(normalizePeriod("", "2041")).toBe("2041");
    expect(normalizePeriod("Année 2041", "2041")).toBe("2041");
    expect(normalizePeriod("2041-3", "2041")).toBe("2041-03");
    expect(normalizePeriod("03/2041", "2041")).toBe("2041-03");
    expect(normalizePeriod("15/03/2041", "2041")).toBe("2041-03");
    expect(normalizePeriod("Mars 2041", "2041")).toBe("2041-03");
    expect(normalizePeriod("févr.", "2041")).toBe("2041-02");
    expect(normalizePeriod("51136", "2041")).toBe("2040-01");
    expect(normalizePeriod("T1", "2041")).toBe("T1");
  });

  it("prépare les lignes : montant vide ignoré, montant illisible transmis pour être signalé", () => {
    const headers = ["Compte", "Intitulé", "Section", "Période", "Montant", "Commentaire"];
    const r = budgetImportRows([
      { Compte: "60", Intitulé: "Achats", Section: "", Période: "2041", Montant: "100 000", Commentaire: "" },
      { Compte: "601", Intitulé: "Achats stockés", Section: "PROD", Période: "mars", Montant: "", Commentaire: "" },
      { Compte: "604", Intitulé: "Études", Section: "CF/ADM", Période: "04/2041", Montant: "beaucoup", Commentaire: "à voir" },
    ], headers, "2041", true);
    expect(r.missing).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, account: "60", section: "", period: "2041", amount: 100000, comment: "" },
      { line: 4, account: "604", section: "CF/ADM", period: "2041-04", amount: "beaucoup", comment: "à voir" },
    ]);
    expect(budgetImportRows([], ["Compte"], "2041", false).missing).toEqual(["Montant"]);
    expect(budgetImportRows([{ Compte: "60", Montant: "5" }], ["Compte", "Montant"], "2041", false).rows[0]).not.toHaveProperty("period");
  });
});
