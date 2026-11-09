import { describe, it, expect } from "vitest";
import {
  closeTreasuryPeriod,
  createTreasuryCloseStore,
  isValidTreasuryPeriod,
  isPeriodInAllowedRange,
  periodDiffMonths,
  currentPeriod,
  type TreasuryCloseContext,
} from "./treasury-close";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2025-06-15T00:00:00Z");
const okCtx: TreasuryCloseContext = { tenantId: TENANT, userId: USER, hasClosePerm: true, now: NOW };

describe("treasury-close", () => {
  it("valide les formats de période AAAA-MM", () => {
    expect(isValidTreasuryPeriod("2025-01")).toBe(true);
    expect(isValidTreasuryPeriod("2025-13")).toBe(false);
    expect(isValidTreasuryPeriod("2025-1")).toBe(false);
    expect(isValidTreasuryPeriod("")).toBe(false);
    expect(currentPeriod(new Date("2025-03-15"))).toBe("2025-03");
  });

  it("refuse sans tenant, sans permission, ou format invalide", () => {
    const s = createTreasuryCloseStore();
    expect(closeTreasuryPeriod(s, { ...okCtx, tenantId: null }, "2025-01").status).toBe("no_tenant");
    expect(closeTreasuryPeriod(s, { ...okCtx, hasClosePerm: false }, "2025-01").status).toBe("forbidden");
    expect(closeTreasuryPeriod(s, okCtx, "2025-13").status).toBe("invalid_period");
    expect(s.closes).toHaveLength(0);
  });

  it("clôt une période, verrouille et audite", () => {
    const s = createTreasuryCloseStore();
    const r = closeTreasuryPeriod(s, okCtx, "2025-01");
    expect(r.status).toBe("ok");
    expect(r.created).toBe(true);
    expect(s.closes).toHaveLength(1);
    expect(s.locks).toHaveLength(1);
    expect(s.locks[0].module).toBe("treasury");
    expect(s.audit.map(a => a.action)).toEqual(["period_close_started", "period_close_completed"]);
  });

  it("est idempotent : seconde clôture ne crée rien mais audite", () => {
    const s = createTreasuryCloseStore();
    closeTreasuryPeriod(s, okCtx, "2025-01");
    const r2 = closeTreasuryPeriod(s, okCtx, "2025-01");
    expect(r2.status).toBe("idempotent");
    expect(r2.created).toBe(false);
    expect(s.closes).toHaveLength(1);
    expect(s.audit.filter(a => a.action === "period_close_idempotent")).toHaveLength(1);
  });

  it("refuse si un lock existant bloque la période", () => {
    const s = createTreasuryCloseStore({
      locks: [{ tenant_id: TENANT, period: "2025-02", module: "treasury", closed_by: "other" }],
    });
    const r = closeTreasuryPeriod(s, okCtx, "2025-02");
    expect(r.status).toBe("already_locked");
    expect(s.closes).toHaveLength(0);
    expect(s.audit.at(-1)?.action).toBe("period_close_failed");
  });

  it("refuse si des rapprochements bancaires sont encore en brouillon", () => {
    const s = createTreasuryCloseStore({
      recons: [
        { tenant_id: TENANT, period_end: "2025-01-31", status: "draft" },
        { tenant_id: TENANT, period_end: "2025-01-15", status: "validated" },
      ],
    });
    const r = closeTreasuryPeriod(s, okCtx, "2025-01");
    expect(r.status).toBe("unreconciled");
    expect(r.openDrafts).toBe(1);
    expect(s.closes).toHaveLength(0);
  });

  it("ne compte que les brouillons du même tenant et dans la période", () => {
    const s = createTreasuryCloseStore({
      recons: [
        { tenant_id: "other", period_end: "2025-01-31", status: "draft" },
        { tenant_id: TENANT, period_end: "2024-12-31", status: "draft" },
      ],
    });
    expect(closeTreasuryPeriod(s, okCtx, "2025-01").status).toBe("ok");
  });

  /* ---- Audit shape: actor_id + period_start + period_end always present ---- */

  it("l'audit inclut systématiquement period_start, period_end et actor_id (succès)", () => {
    const s = createTreasuryCloseStore();
    closeTreasuryPeriod(s, okCtx, "2025-04");
    const completed = s.audit.find(a => a.action === "period_close_completed");
    expect(completed).toBeDefined();
    expect(completed).toMatchObject({
      actor_id: USER,
      tenant_id: TENANT,
      period: "2025-04",
      period_start: "2025-04-01",
      period_end: "2025-04-30",
    });
  });

  it("l'audit period_close_failed transporte aussi actor_id + period_start/end", () => {
    const s = createTreasuryCloseStore({
      recons: [{ tenant_id: TENANT, period_end: "2025-02-28", status: "draft" }],
    });
    closeTreasuryPeriod(s, okCtx, "2025-02");
    const failed = s.audit.find(a => a.action === "period_close_failed");
    expect(failed).toMatchObject({
      actor_id: USER,
      period: "2025-02",
      period_start: "2025-02-01",
      period_end: "2025-02-28",
    });
  });

  /* ---- Plage autorisée ---- */

  it("isPeriodInAllowedRange — cas limites par défaut (24 mois passés, 1 futur)", () => {
    expect(isPeriodInAllowedRange("2025-06", NOW)).toBe(true);   // courant
    expect(isPeriodInAllowedRange("2025-07", NOW)).toBe(true);   // +1 mois (limite)
    expect(isPeriodInAllowedRange("2025-08", NOW)).toBe(false);  // +2 mois
    expect(isPeriodInAllowedRange("2023-06", NOW)).toBe(true);   // -24 mois (limite)
    expect(isPeriodInAllowedRange("2023-05", NOW)).toBe(false);  // -25 mois
    expect(isPeriodInAllowedRange("2025-13", NOW)).toBe(false);  // format invalide
    expect(periodDiffMonths("2025-07", NOW)).toBe(1);
    expect(periodDiffMonths("2025-05", NOW)).toBe(-1);
  });

  it("closeTreasuryPeriod rejette les périodes hors plage et trace l'audit", () => {
    const s = createTreasuryCloseStore();
    const r = closeTreasuryPeriod(s, okCtx, "2020-01"); // trop ancien
    expect(r.status).toBe("out_of_range");
    expect(s.closes).toHaveLength(0);
    expect(s.audit.at(-1)).toMatchObject({
      action: "period_close_failed",
      period: "2020-01",
      period_start: "2020-01-01",
      period_end: "2020-01-31",
      actor_id: USER,
    });
  });

  it("plage personnalisable via rangeOptions", () => {
    const s = createTreasuryCloseStore();
    const tight: TreasuryCloseContext = { ...okCtx, rangeOptions: { maxPastMonths: 1, maxFutureMonths: 0 } };
    expect(closeTreasuryPeriod(s, tight, "2025-04").status).toBe("out_of_range");
    expect(closeTreasuryPeriod(s, tight, "2025-05").status).toBe("ok");
  });
});
