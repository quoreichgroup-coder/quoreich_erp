import { describe, expect, it } from "vitest";
import { detectStatementColumns, missingStatementColumns, parseAmount, parseDate, readStatementLines, statementSummary } from "@/lib/bank-statement";

describe("relevé bancaire", () => {
  it("lit les montants au format français et bancaire", () => {
    expect(["1 234,50", "-1500", "1.234,50", "(250,00)", "1,234.50", "75-", "1\u202f000 XOF", ""].map(parseAmount)).toEqual([1234.5, -1500, 1234.5, -250, 1234.5, -75, 1000, 0]);
    expect(parseAmount("abc")).toBeNaN();
  });

  it("lit les dates jj/mm/aaaa, ISO et numéro de série Excel", () => {
    expect(["14/11/2026", "1-2-26", "2026-11-14", "46340", "31/02/2026", "x"].map(parseDate)).toEqual(["2026-11-14", "2026-02-01", "2026-11-14", "2026-11-14", null, null]);
  });

  it("reconnaît les colonnes Débit / Crédit et ignore les lignes de solde", () => {
    const m = detectStatementColumns(["Date opération", "Libellé", "Débit", "Crédit", "Réf."]);
    expect(m).toEqual({ date: "Date opération", label: "Libellé", debit: "Débit", credit: "Crédit", reference: "Réf." });
    expect(missingStatementColumns(m)).toEqual([]);
    const { lines, errors } = readStatementLines([
      { "Date opération": "", Libellé: "Solde au 01/11/2026", Débit: "", Crédit: "100 000", "Réf.": "" },
      { "Date opération": "03/11/2026", Libellé: "VIR RECU CLIENT", Débit: "", Crédit: "500 000", "Réf.": "VIR-1" },
      { "Date opération": "05/11/2026", Libellé: "FRAIS", Débit: "2 500", Crédit: "", "Réf.": "" },
      { "Date opération": "xx", Libellé: "?", Débit: "1", Crédit: "", "Réf.": "" },
    ], m);
    expect(lines).toEqual([{ date: "2026-11-03", label: "VIR RECU CLIENT", amount: 500000, reference: "VIR-1" }, { date: "2026-11-05", label: "FRAIS", amount: -2500, reference: "" }]);
    expect(errors).toEqual(["ligne 5 : date illisible (« xx »)"]);
    expect(statementSummary(lines)).toEqual({ from: "2026-11-03", to: "2026-11-05", total: 497500, count: 2 });
    expect(missingStatementColumns({ label: "Libellé" })).toEqual(["Date", "Montant (ou Débit / Crédit)"]);
  });
});
