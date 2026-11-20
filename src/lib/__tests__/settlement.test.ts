import { describe, expect, it } from "vitest";
import { autoAllocate, checkAllocations, itemCurrencies, openItems } from "../settlement";

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

describe("règlement en devise (V124)", () => {
  const ap = { invoice_date: "2031-03-01", status: "open", approval_status: "approved", supplier_id: "s1", due_date: "2031-04-30" };
  const pieces = [
    { ...ap, id: "u", invoice_number: "FU-1", total: 305305, amount_paid: 122000, currency: "USD", exchange_rate: 610, fx_total: 500.5 },
    { ...ap, id: "x", invoice_number: "FX-1", total: 5000, amount_paid: 0 },
  ];
  it("donne le restant dû et le total dans la devise de la pièce, et sépare les devises", () => {
    const items = openItems("ap", pieces, "s1");
    const usd = items.find((i) => i.id === "u")!;
    expect(usd).toMatchObject({ docCurrency: "USD", docTotal: 500.5, outstanding: 300.5 });
    expect(items.find((i) => i.id === "x")).toMatchObject({ docCurrency: null, docTotal: 5000, outstanding: 5000 });
    expect(itemCurrencies(items)).toEqual(["USD", null]);
  });
  it("impute en devise sur une facture en devise", () => {
    const items = openItems("ap", pieces, "s1").filter((i) => i.docCurrency === "USD");
    const r = checkAllocations(items, { u: 300.5 }, 300.5);
    expect(r.error).toBeNull();
    expect(r.allocations).toEqual([{ invoice_id: "u", fx_amount: 300.5 }]);
    expect(checkAllocations(items, { u: 300.51 }, 300.51).error).toMatch(/au-delà du restant/);
  });
});
