/**
 * Integration test for the `close_treasury_period` RPC contract.
 *
 * Simulates the server-side behaviour with an in-memory store mirroring the
 * SQL function (idempotence via SELECT-then-INSERT guarded by the
 * UNIQUE (tenant_id, period) constraint). Locks the contract that:
 *   - A second call for the same `_period` raises NO SQL error.
 *   - No new row is created in `treasury_period_closes`.
 *   - The existing row is returned unchanged.
 *   - An `period_close_idempotent` audit row is emitted on the retry.
 */
import { describe, it, expect, beforeEach } from "vitest";

type CloseRow = {
  id: string;
  tenant_id: string;
  period: string;
  status: "completed";
  closed_by: string;
  closed_at: string;
};
type AuditRow = { action: string; period: string; actor_id: string };

const TENANT = "t-1";
const USER = "u-1";

class FakeDb {
  closes: CloseRow[] = [];
  audit: AuditRow[] = [];
  seq = 0;

  rpc_close_treasury_period(period: string): { row: CloseRow; idempotent: boolean } {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("invalid period format");
    // SELECT-then-RETURN guarded by UNIQUE(tenant_id, period)
    const existing = this.closes.find((r) => r.tenant_id === TENANT && r.period === period);
    if (existing) {
      this.audit.push({ action: "period_close_idempotent", period, actor_id: USER });
      return { row: existing, idempotent: true };
    }
    const row: CloseRow = {
      id: `close-${++this.seq}`,
      tenant_id: TENANT,
      period,
      status: "completed",
      closed_by: USER,
      closed_at: new Date().toISOString(),
    };
    // Simulate UNIQUE constraint enforcement at insert time.
    if (this.closes.some((r) => r.tenant_id === row.tenant_id && r.period === row.period)) {
      throw new Error("23505: duplicate key");
    }
    this.closes.push(row);
    this.audit.push({ action: "period_close_completed", period, actor_id: USER });
    return { row, idempotent: false };
  }
}

describe("close_treasury_period — idempotence contract", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("second call for the same _period does NOT raise and reuses the existing row", () => {
    const first = db.rpc_close_treasury_period("2025-05");
    const second = (): ReturnType<FakeDb["rpc_close_treasury_period"]> =>
      db.rpc_close_treasury_period("2025-05");

    expect(second).not.toThrow();
    const r2 = second();
    expect(r2.idempotent).toBe(true);
    expect(r2.row.id).toBe(first.row.id);
  });

  it("second call reuses EXACTLY the same primary key without inserting a new row", () => {
    const first = db.rpc_close_treasury_period("2025-05");
    const beforeLen = db.closes.length;
    const second = db.rpc_close_treasury_period("2025-05");
    // Same primary key reused.
    expect(second.row.id).toBe(first.row.id);
    // Same object reference — no copy, no new row.
    expect(second.row).toBe(db.closes[0]);
    expect(db.closes).toHaveLength(beforeLen);
    // Immutable identity columns unchanged on retry.
    expect(second.row.tenant_id).toBe(first.row.tenant_id);
    expect(second.row.period).toBe(first.row.period);
    expect(second.row.closed_at).toBe(first.row.closed_at);
    expect(second.row.closed_by).toBe(first.row.closed_by);
  });

  it("does not create a new row on retry — closes table stays at length 1", () => {
    db.rpc_close_treasury_period("2025-05");
    db.rpc_close_treasury_period("2025-05");
    db.rpc_close_treasury_period("2025-05");
    expect(db.closes).toHaveLength(1);
  });

  it("emits period_close_idempotent on the retry and period_close_completed on the first", () => {
    db.rpc_close_treasury_period("2025-05");
    db.rpc_close_treasury_period("2025-05");
    expect(db.audit.map((a) => a.action)).toEqual([
      "period_close_completed",
      "period_close_idempotent",
    ]);
    expect(db.audit.every((a) => a.period === "2025-05" && a.actor_id === USER)).toBe(true);
  });

  it("different periods create independent rows", () => {
    db.rpc_close_treasury_period("2025-05");
    db.rpc_close_treasury_period("2025-06");
    expect(db.closes).toHaveLength(2);
  });
});
