import { describe, expect, it } from "vitest";
import { autoAllocate, checkAllocations, openItems } from "../settlement";

const base = { invoice_date: "2026-10-01", amount_paid: 0, status: "sent" };
const factures = [
  { ...base, id: "a", invoice_number: "F-2", due_date: "2026-11-30", total: 500, customer_id: "c1" },
  { ...base, id: "b", invoice_number: "F-1", due_date: "2026-10-31", total: 1000, customer_id: "c1", amount_paid: 400 },
  { ...base, id: "c", invoice_number: "F-3", due_date: "2026-09-30", total: 700, customer_id: "c2" },
  { ...base, id: "d", invoice_number: "F-4", due_date: "2026-09-01", total: 300, customer_id: "c1", status: "paid", amount_paid: 300 },
  { ...base, id: "e", invoice_number: "F-5", due_date: "2026-09-01", total: 300, customer_id: "c1", status: "draft" },
];

describe("règlements par tiers", () => {
  it("ne montre que les pièces ouvertes du tiers choisi, plus ancienne échéance d'abord", () => {
    expect(openItems("ar", factures, "c1").map((i) => [i.invoice_number, i.outstanding])).toEqual([["F-1", 600], ["F-2", 500]]);
    expect(openItems("ar", factures, "c2").map((i) => i.invoice_number)).toEqual(["F-3"]);
    expect(openItems("ar", factures, "")).toEqual([]);
  });

  it("côté fournisseur, une facture non approuvée n'est pas proposée", () => {
    const ap = [
      { ...base, id: "x", invoice_number: "FF-1", due_date: "2026-10-01", total: 100, supplier_id: "s1", status: "open", approval_status: "pending" },
      { ...base, id: "y", invoice_number: "FF-2", due_date: "2026-10-02", total: 100, supplier_id: "s1", status: "open", approval_status: "approved" },
    ];
    expect(openItems("ap", ap, "s1").map((i) => i.invoice_number)).toEqual(["FF-2"]);
  });

  it("répartit sur la plus ancienne échéance d'abord et contrôle la saisie", () => {
    const items = openItems("ar", factures, "c1");
    const auto = autoAllocate(800, items);
    expect(auto).toEqual({ b: 600, a: 200 });
    expect(checkAllocations(items, auto, 800).error).toBeNull();
    expect(checkAllocations(items, { b: 700 }, 700).error).toMatch(/au-delà du restant/);
    expect(checkAllocations(items, { b: 100 }, 150).error).toMatch(/différent du total imputé/);
    expect(checkAllocations(items, {}, 0).error).toMatch(/au moins une facture/);
  });
});
