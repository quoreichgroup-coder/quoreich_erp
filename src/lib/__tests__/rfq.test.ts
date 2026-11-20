import { describe, expect, it } from "vitest";
import { awardIssues, defaultChoices, needsReason, type RfqOffer } from "../rfq";

const o = (line: string, no: number, sup: string, base: number, lead: number | null = null, expired = false): RfqOffer =>
  ({ rfq_line_id: line, line_no: no, supplier_id: sup, supplier_name: sup, unit_price: base, currency: null, unit_price_base: base, amount_base: base, lead_time_days: lead, expired });

describe("comparatif des offres", () => {
  const offers = [o("l1", 1, "B", 380455, 30), o("l1", 1, "A", 390000, 3), o("l2", 2, "A", 95000, 3), o("l2", 2, "B", 98393, 30), o("l2", 2, "C", 90000, 5, true)];
  it("propose le moins-disant valable de chaque ligne (offre expirée écartée)", () => {
    const c = defaultChoices(offers, ["l1", "l2"]);
    expect(c.l1.supplier_id).toBe("B");
    expect(c.l2.supplier_id).toBe("A");
  });
  it("exige un motif hors moins-disant, signale offre expirée et ligne sans choix", () => {
    expect(needsReason(offers, { line_id: "l1", supplier_id: "A", reason: "" })).toBe(true);
    expect(needsReason(offers, { line_id: "l2", supplier_id: "A", reason: "" })).toBe(false);
    expect(awardIssues(offers, ["l1", "l2"], { l1: { line_id: "l1", supplier_id: "A", reason: " " }, l2: { line_id: "l2", supplier_id: "C", reason: "" } }))
      .toEqual(["Ligne 1 : motif requis (offre hors moins-disant)", "Ligne 2 : l'offre retenue a expiré"]);
    expect(awardIssues(offers, ["l1", "l2"], { l1: { line_id: "l1", supplier_id: "A", reason: "Délai" } })).toEqual(["Ligne 2 : aucune offre retenue"]);
  });
});
