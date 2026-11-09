import { describe, it, expect } from "vitest";
import {
  PERIOD_RE,
  isValidPeriod,
  currentPeriod,
  closeMessage,
  closeInventoryPeriod,
  createCloseStore,
  type CloseContext,
} from "@/lib/inventory-close";

const TENANT = "tenant-a";
const USER = "user-1";
const allowed: CloseContext = { tenantId: TENANT, userId: USER, hasClosePerm: true };

describe("inventory-close period validation", () => {
  it("accepts YYYY-MM with month 01-12", () => {
    expect(isValidPeriod("2026-01")).toBe(true);
    expect(isValidPeriod("2026-12")).toBe(true);
    expect(PERIOD_RE.test("1999-07")).toBe(true);
  });
  it("rejects malformed periods", () => {
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-01", "2026/01", "", "2026-1a", "20260-01"]) {
      expect(isValidPeriod(bad)).toBe(false);
    }
  });
  it("currentPeriod is zero-padded", () => {
    expect(currentPeriod(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    expect(currentPeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});

describe("close_inventory_period — permission gating", () => {
  it("rejects when tenant is missing", () => {
    const store = createCloseStore();
    const r = closeInventoryPeriod(store, { ...allowed, tenantId: null }, "2026-06");
    expect(r.status).toBe("no_tenant");
    expect(store.closes).toHaveLength(0);
    expect(store.locks).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });
  it("rejects when user lacks the close permission", () => {
    const store = createCloseStore();
    const r = closeInventoryPeriod(store, { ...allowed, hasClosePerm: false }, "2026-06");
    expect(r.status).toBe("forbidden");
    expect(r.message).toMatch(/Contrôleur Stock/);
    expect(store.closes).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });
  it("rejects an invalid period without touching the store", () => {
    const store = createCloseStore();
    const r = closeInventoryPeriod(store, allowed, "2026-13");
    expect(r.status).toBe("invalid_period");
    expect(r.message).toContain("2026-13");
    expect(store.closes).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });
});

describe("close_inventory_period — idempotence & lock", () => {
  it("creates one close, one lock and one audit row on first call", () => {
    const store = createCloseStore();
    const r = closeInventoryPeriod(store, allowed, "2026-06");
    expect(r.status).toBe("ok");
    expect(r.created).toBe(true);
    expect(store.closes).toHaveLength(1);
    expect(store.locks).toHaveLength(1);
    expect(store.locks[0]).toMatchObject({ tenant_id: TENANT, period: "2026-06", module: "inventory", locked_by: USER });
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({ action: "period_close", comment: "2026-06" });
  });

  it("is idempotent — repeated calls do not duplicate closes or locks", () => {
    const store = createCloseStore();
    closeInventoryPeriod(store, allowed, "2026-06");
    const second = closeInventoryPeriod(store, allowed, "2026-06");
    const third  = closeInventoryPeriod(store, allowed, "2026-06");
    expect(second.status).toBe("idempotent");
    expect(third.status).toBe("idempotent");
    expect(second.created).toBe(false);
    expect(store.closes).toHaveLength(1);
    expect(store.locks).toHaveLength(1);
    // still writes audit rows so retries are traceable
    expect(store.audit.map((a) => a.action)).toEqual([
      "period_close", "period_close_idempotent", "period_close_idempotent",
    ]);
  });

  it("isolates closes by tenant", () => {
    const store = createCloseStore();
    closeInventoryPeriod(store, allowed, "2026-06");
    const other = closeInventoryPeriod(store, { ...allowed, tenantId: "tenant-b" }, "2026-06");
    expect(other.status).toBe("ok");
    expect(store.closes).toHaveLength(2);
    expect(store.locks).toHaveLength(2);
  });

  it("allows distinct periods for the same tenant", () => {
    const store = createCloseStore();
    closeInventoryPeriod(store, allowed, "2026-05");
    closeInventoryPeriod(store, allowed, "2026-06");
    expect(store.closes.map((c) => c.period).sort()).toEqual(["2026-05", "2026-06"]);
  });

  it("never writes audit when the call is rejected by permission/period", () => {
    const store = createCloseStore();
    closeInventoryPeriod(store, { ...allowed, hasClosePerm: false }, "2026-06");
    closeInventoryPeriod(store, allowed, "bad");
    expect(store.audit).toHaveLength(0);
  });
});

describe("closeMessage copy", () => {
  it("returns French copy for every status", () => {
    for (const s of ["ok", "idempotent", "forbidden", "invalid_period", "no_tenant"] as const) {
      const m = closeMessage(s, "2026-06");
      expect(m.length).toBeGreaterThan(5);
    }
  });
});
