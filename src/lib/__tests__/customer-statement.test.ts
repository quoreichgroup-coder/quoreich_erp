import { describe, expect, it } from "vitest";
import { customerStatement } from "@/lib/customer-statement";

describe("relevé de compte client", () => {
  const mvts = [
    { date: "2026-01-10", piece: "INV-1", label: "Facture", debit: 100000, credit: 0 },
    { date: "2026-02-05", piece: "ENC-1", label: "Encaissement", debit: 0, credit: 40000 },
    { date: "2026-02-05", piece: "INV-2", label: "Facture", debit: 50000, credit: 0 },
    { date: "2026-03-01", piece: "AV-1", label: "Avoir", debit: 0, credit: 10000 },
    { date: "2026-03-02", piece: "ANN-1", label: "Annulation d'encaissement", debit: 40000, credit: 0 },
  ];

  it("solde d'ouverture à la veille de la période, puis solde progressif", () => {
    const st = customerStatement(mvts, "2026-02-01", "2026-03-31");
    expect(st.opening).toBe(100000);
    expect(st.rows.map((r) => [r.piece, r.balance])).toEqual([
      ["INV-2", 150000], ["ENC-1", 110000], ["AV-1", 100000], ["ANN-1", 140000],
    ]);
    expect([st.debit, st.credit, st.closing]).toEqual([90000, 50000, 140000]);
  });

  it("le même jour, la facture précède l'encaissement", () => {
    const st = customerStatement(mvts, "2026-01-01", "2026-12-31");
    expect(st.rows.slice(1, 3).map((r) => r.piece)).toEqual(["INV-2", "ENC-1"]);
    expect(st.closing).toBe(140000);
  });
});
