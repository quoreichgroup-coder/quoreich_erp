import { describe, expect, it } from "vitest";
import { deliveryPerformance, engagedOrders, ordersByMonth, spendBy, type ReportPO } from "@/lib/procurement-reporting";

const po = (id: string, supplier: string, total: number, order_date: string, extra: Partial<ReportPO> = {}): ReportPO =>
  ({ id, po_number: `PO-${id}`, supplier, category: null, total, order_date, expected_date: null, status: "ordered", ...extra });

describe("rapports d'approvisionnement", () => {
  const pos = [
    po("1", "Dell", 600, "2041-01-10", { category: "Informatique", expected_date: "2041-01-20" }),
    po("2", "Dell", 400, "2041-02-05", { category: "Informatique", expected_date: "2041-02-08" }),
    po("3", "Orange", 1000, "2041-02-15", { category: " " }),
    po("4", "Brouillon", 9999, "2041-03-01", { status: "draft" }),
    po("5", "Ancien", 50, "2040-12-31"),
  ];

  it("dépenses engagées de l'exercice : commandes approuvées et suivantes seulement", () => {
    const e = engagedOrders(pos, "2041");
    expect(e.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(spendBy(e, "supplier")).toEqual([
      { label: "Dell", amount: 1000, orders: 2, pct: 50 }, { label: "Orange", amount: 1000, orders: 1, pct: 50 }]);
    expect(spendBy(e, "category").map((r) => r.label)).toEqual(["Informatique", "Sans catégorie"]);
    const m = ordersByMonth(e, "2041");
    expect(m).toHaveLength(12);
    expect(m[1]).toEqual({ month: "2041-02", amount: 1400, orders: 2 });
  });

  it("délai jusqu'à la première réception validée, ponctualité contre la date promise", () => {
    const perf = deliveryPerformance(engagedOrders(pos, "2041"), [
      { po_id: "1", receipt_date: "2041-01-18", status: "completed" },
      { po_id: "1", receipt_date: "2041-01-25", status: "completed" },
      { po_id: "2", receipt_date: "2041-02-12", status: "completed" },
      { po_id: "3", receipt_date: "2041-02-16", status: "pending" },
    ]);
    expect(perf.received).toBe(2);
    expect(perf.averageLead).toBe(7.5); // 8 et 7 jours
    expect(perf.onTimeRate).toBe(50);   // la 1 à l'heure, la 2 en retard
    expect(perf.bySupplier).toEqual([{ supplier: "Dell", received: 2, averageLead: 7.5, onTimeRate: 50 }]);
    expect(deliveryPerformance([], []).averageLead).toBeNull();
  });
});
