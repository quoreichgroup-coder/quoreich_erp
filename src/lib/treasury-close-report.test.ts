import { describe, it, expect, vi } from "vitest";
import { safeExportTreasuryCloseReport } from "./treasury-close-report";
import type { TreasuryCloseHistoryRow } from "@/hooks/use-treasury-close";

const row: TreasuryCloseHistoryRow = {
  id: "r1",
  period: "2025-04",
  status: "completed",
  total_balance: 1000,
  accounts_count: 2,
  reconciliations_count: 1,
  error_message: null,
  closed_by: "u1",
  closed_at: "2025-04-30T18:00:00Z",
  closed_by_name: "Tester",
};

describe("safeExportTreasuryCloseReport", () => {
  it("renvoie true et appelle l'impl quand la génération réussit", async () => {
    const impl = vi.fn();
    const onError = vi.fn();
    await expect(safeExportTreasuryCloseReport(row, onError, impl)).resolves.toBe(true);
    expect(impl).toHaveBeenCalledWith(row);
    expect(onError).not.toHaveBeenCalled();
  });

  it("attrape les erreurs, prévient via onError et ne propage rien", async () => {
    const onError = vi.fn();
    const impl = vi.fn(() => { throw new Error("jsPDF boom"); });
    await expect(safeExportTreasuryCloseReport(row, onError, impl)).resolves.toBe(false);
    await expect(safeExportTreasuryCloseReport(row, onError, impl)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/jsPDF boom/);
  });

  it("normalise les valeurs jetées non-Error en Error", async () => {
    const onError = vi.fn();
    await safeExportTreasuryCloseReport(row, onError, () => { throw "string-failure"; });
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe("string-failure");
  });

  it("une promesse rejetée (jsPDF chargé à la demande) arrive aussi à onError, sans rejet non géré", async () => {
    const onError = vi.fn();
    const impl = vi.fn(() => Promise.reject(new Error("synthetic Blob failure")));
    await expect(safeExportTreasuryCloseReport(row, onError, impl)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("synthetic Blob failure");
  });
});
