import { describe, expect, it } from "vitest";
import {
  blockedReason, cellStatus, closingSequence, endAfterMonths, periodLabel, suggestNextFiscalYear, yearProgress,
  type FiscalModule, type FiscalPeriod, type FiscalYear, type PeriodLock,
} from "../fiscal-calendar";

const modules: FiscalModule[] = [
  { code: "SALES", label: "Ventes", sort_order: 10, is_ledger: false },
  { code: "AR", label: "Comptes clients", sort_order: 40, is_ledger: false },
  { code: "GL", label: "Grand livre", sort_order: 90, is_ledger: true },
];
const lock = (period: string, module: string, status: "open" | "closed" = "closed"): PeriodLock =>
  ({ period, module, status, closed_at: null, reason: null });
const year = (code: string, start: string, end: string): FiscalYear => ({ id: code, code, start_date: start, end_date: end, status: "open" });

describe("calendrier fiscal (logique pure)", () => {
  it("propose l'année civile en cours sans exercice, puis 12 mois à la suite du dernier — y compris décalé", () => {
    expect(suggestNextFiscalYear([], new Date("2026-11-13"))).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(suggestNextFiscalYear([year("2026", "2026-01-01", "2026-12-31")])).toEqual({ start: "2027-01-01", end: "2027-12-31" });
    expect(suggestNextFiscalYear([year("2025-2026", "2025-07-01", "2026-06-30")])).toEqual({ start: "2026-07-01", end: "2027-06-30" });
  });

  it("calcule la fin d'un exercice de N mois (premier exercice de 1 à 18 mois)", () => {
    expect(endAfterMonths("2026-01-01", 12)).toBe("2026-12-31");
    expect(endAfterMonths("2025-07-01", 18)).toBe("2026-12-31");
    expect(endAfterMonths("2024-02-01", 1)).toBe("2024-02-29");
  });

  it("une case sans ligne au registre est ouverte", () => {
    expect(cellStatus([], "2026-10", "AR")).toBe("open");
    expect(cellStatus([lock("2026-10", "AR")], "2026-10", "AR")).toBe("closed");
    expect(cellStatus([lock("2026-10", "AR", "open")], "2026-10", "AR")).toBe("open");
  });

  it("annonce l'ordre de clôture que la base impose", () => {
    expect(blockedReason([lock("2026-10", "SALES")], modules, "2026-10", "GL", "closed")).toBe("Clôturez d'abord : Comptes clients");
    expect(blockedReason([lock("2026-10", "SALES"), lock("2026-10", "AR")], modules, "2026-10", "GL", "closed")).toBeNull();
    expect(blockedReason([lock("2026-10", "AR"), lock("2026-10", "GL")], modules, "2026-10", "AR", "open")).toBe("Rouvrez d'abord le Grand livre");
    expect(blockedReason([lock("2026-10", "GL")], modules, "2026-10", "GL", "open")).toBeNull();
  });

  it("séquence de clôture : modules opérationnels dans l'ordre, Grand livre en dernier", () => {
    expect(closingSequence([lock("2026-10", "SALES")], modules, "2026-10").map((m) => m.code)).toEqual(["AR", "GL"]);
    const shuffled = [modules[2], modules[1], modules[0]];
    expect(closingSequence([], shuffled, "2026-10").map((m) => m.code)).toEqual(["SALES", "AR", "GL"]);
  });

  it("avancement d'un exercice et libellés de période", () => {
    const periods: FiscalPeriod[] = [
      { id: "p1", fiscal_year_id: "y", period_no: 1, code: "2026-01", start_date: "2026-01-01", end_date: "2026-01-31" },
      { id: "p2", fiscal_year_id: "y", period_no: 2, code: "2026-02", start_date: "2026-02-01", end_date: "2026-02-28" },
    ];
    expect(yearProgress(periods, [lock("2026-01", "SALES"), lock("2026-01", "AR"), lock("2026-03", "GL")], modules))
      .toEqual({ closed: 2, total: 6 });
    expect(periodLabel("2026-03")).toBe("mars 2026");
  });
});
