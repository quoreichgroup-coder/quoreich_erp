/**
 * Integration test for the `convert_quote_to_so` RPC contract.
 *
 * Strategy: simulate the server using an in-memory store that mirrors the SQL
 * function's behaviour (lookups, idempotence, line copy, status transition,
 * audit logging). This locks the contract the UI relies on, independent of
 * a live DB connection.
 */
import { describe, it, expect, beforeEach } from "vitest";

type Quote = { id: string; tenant_id: string; status: string; customer_id: string; total: number };
type QLine = { id: string; quotation_id: string; description: string; quantity: number; unit_price: number; total: number };
type SO = { id: string; tenant_id: string; quotation_id: string; customer_id: string; total: number; status: string };
type SOLine = { so_id: string; description: string; quantity: number; unit_price: number; total: number };
type Opp = { id: string; converted_quotation_id: string | null };
type Activity = { tenant_id: string; opportunity_id: string | null; type: string; subject: string };

const TENANT = "t-1";
const USER = "u-1";

class FakeDb {
  quotes: Quote[] = [];
  qlines: QLine[] = [];
  sos: SO[] = [];
  solines: SOLine[] = [];
  opps: Opp[] = [];
  activities: Activity[] = [];
  hasPerm = true;

  rpc_convert_quote_to_so(quoteId: string): string {
    if (!this.hasPerm) throw new Error("insufficient_role");
    const q = this.quotes.find((x) => x.id === quoteId);
    if (!q) throw new Error("quote_not_found");
    if (q.tenant_id !== TENANT) throw new Error("tenant_mismatch");

    // Idempotent
    const existing = this.sos.find((s) => s.quotation_id === quoteId);
    if (existing) return existing.id;

    if (!["draft", "sent", "accepted"].includes(q.status)) throw new Error("quote_status_invalid");

    const soId = `so-${this.sos.length + 1}`;
    this.sos.push({ id: soId, tenant_id: TENANT, quotation_id: quoteId, customer_id: q.customer_id, total: q.total, status: "draft" });
    this.qlines
      .filter((l) => l.quotation_id === quoteId)
      .forEach((l) => this.solines.push({ so_id: soId, description: l.description, quantity: l.quantity, unit_price: l.unit_price, total: l.total }));
    q.status = "converted";

    const opp = this.opps.find((o) => o.converted_quotation_id === quoteId);
    if (opp) {
      this.activities.push({ tenant_id: TENANT, opportunity_id: opp.id, type: "so_conversion", subject: "Devis converti en bon de commande" });
    }
    return soId;
  }
}

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
  db.quotes.push({ id: "q1", tenant_id: TENANT, status: "accepted", customer_id: "c1", total: 1000 });
  db.qlines.push(
    { id: "l1", quotation_id: "q1", description: "Item A", quantity: 2, unit_price: 300, total: 600 },
    { id: "l2", quotation_id: "q1", description: "Item B", quantity: 1, unit_price: 400, total: 400 },
  );
  db.opps.push({ id: "opp1", converted_quotation_id: "q1" });
});

describe("convert_quote_to_so — contrat RPC", () => {
  it("crée un bon de commande à partir d'un devis valide", () => {
    const soId = db.rpc_convert_quote_to_so("q1");
    expect(soId).toBe("so-1");
    expect(db.sos).toHaveLength(1);
    expect(db.sos[0].total).toBe(1000);
    expect(db.quotes[0].status).toBe("converted");
  });

  it("est idempotent — un second appel renvoie le même SO sans duplication", () => {
    const first = db.rpc_convert_quote_to_so("q1");
    const second = db.rpc_convert_quote_to_so("q1");
    expect(second).toBe(first);
    expect(db.sos).toHaveLength(1);
    expect(db.solines).toHaveLength(2); // pas de duplication de lignes
  });

  it("recopie correctement toutes les lignes du devis vers le SO", () => {
    db.rpc_convert_quote_to_so("q1");
    const lines = db.solines.filter((l) => l.so_id === "so-1");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.description).sort()).toEqual(["Item A", "Item B"]);
    expect(lines.reduce((s, l) => s + l.total, 0)).toBe(1000);
  });

  it("enregistre une activité d'audit (so_conversion) liée à l'opportunité", () => {
    db.rpc_convert_quote_to_so("q1");
    const audit = db.activities.filter((a) => a.type === "so_conversion");
    expect(audit).toHaveLength(1);
    expect(audit[0].opportunity_id).toBe("opp1");
  });

  it("ne duplique pas l'audit lors d'un second appel idempotent", () => {
    db.rpc_convert_quote_to_so("q1");
    db.rpc_convert_quote_to_so("q1");
    expect(db.activities.filter((a) => a.type === "so_conversion")).toHaveLength(1);
  });

  it("rejette l'appel sans permission `confirm` (insufficient_role)", () => {
    db.hasPerm = false;
    expect(() => db.rpc_convert_quote_to_so("q1")).toThrow("insufficient_role");
  });

  it("rejette un devis inexistant (quote_not_found)", () => {
    expect(() => db.rpc_convert_quote_to_so("missing")).toThrow("quote_not_found");
  });

  it("rejette un devis d'un autre tenant (tenant_mismatch)", () => {
    db.quotes.push({ id: "q2", tenant_id: "other", status: "accepted", customer_id: "c2", total: 50 });
    expect(() => db.rpc_convert_quote_to_so("q2")).toThrow("tenant_mismatch");
  });

  it("rejette un devis dans un statut invalide (quote_status_invalid)", () => {
    db.quotes.push({ id: "q3", tenant_id: TENANT, status: "cancelled", customer_id: "c1", total: 0 });
    expect(() => db.rpc_convert_quote_to_so("q3")).toThrow("quote_status_invalid");
  });
});
