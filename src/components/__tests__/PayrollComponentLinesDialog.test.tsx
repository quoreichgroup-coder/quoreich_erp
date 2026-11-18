import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayrollComponentLinesDialog } from "../PayrollComponentLinesDialog";

const mocks = vi.hoisted(() => ({
  company: { data: { name: "Entreprise A" } as { name: string } | undefined, isLoading: false, isError: false },
  csv: vi.fn(), doc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-hr-data", () => ({
  useHrCompanyContext: () => mocks.company,
  usePayrollComponentLines: () => ({ isLoading: false, isError: false, data: [
    { code_snapshot: "HIDDEN", label_snapshot: "Interne", kind: "earning", amount: 100, calculation_base: 100, rate_snapshot: null, source_type: "employee_assignment", definition_snapshot: { printable: false } },
    { code_snapshot: "LAST", label_snapshot: "Prime", kind: "earning", amount: 200, calculation_base: 200, rate_snapshot: null, source_type: "employee_assignment", definition_snapshot: { printable: true } },
    { code_snapshot: "FIRST", label_snapshot: "Salaire", kind: "earning", amount: 1000, calculation_base: 1000, rate_snapshot: null, source_type: "base_salary", definition_snapshot: {} },
  ] }),
}));
vi.mock("@/lib/csv-export", () => ({ exportToCSV: mocks.csv }));
// Bulletin en PDF et en Excel : même pièce (identité, salarié, rubriques, totaux, signatures).
vi.mock("@/components/DocumentDetail", () => ({ exportDocument: mocks.doc }));

function show(canExport = true) {
  render(<PayrollComponentLinesDialog open onOpenChange={vi.fn()} canExport={canExport}
    runId="run-1" run={{ period: "2026-11", pay_date: "2026-11-30", payroll_currency_code: "XAF" }}
    employee={{ id: "employee-1", name: "Awa Diallo · MAT-42", gross: 1300, deductions: 100, taxes: 50, net: 1150, employerCharges: 200 }} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.company = { data: { name: "Entreprise A" }, isLoading: false, isError: false };
});

describe("bulletin individuel", () => {
  it("respecte la visibilité et l'ordre figés des rubriques dans les trois exports", async () => {
    show();
    expect(screen.queryByText("Interne")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(mocks.doc).toHaveBeenCalledTimes(2));
    const csvRows = mocks.csv.mock.calls[0][0];
    expect(csvRows.filter((r: { code: string }) => ["FIRST", "LAST", "HIDDEN"].includes(r.code)).map((r: { code: string }) => r.code)).toEqual(["LAST", "FIRST"]);
    expect(csvRows).toContainEqual(expect.objectContaining({ label: "Awa Diallo · MAT-42" }));
    expect(csvRows).toContainEqual(expect.objectContaining({ code: "NET_A_PAYER", amount: 1150 }));
    expect(mocks.doc.mock.calls.map((c) => c[0])).toEqual(["xlsx", "pdf"]);
    for (const [, d] of mocks.doc.mock.calls) {
      expect(d.rows.map((r: string[]) => r[0]).filter((c: string) => ["FIRST", "LAST", "HIDDEN"].includes(c))).toEqual(["LAST", "FIRST"]);
      expect(d.header).toContainEqual(["Salarié", "Awa Diallo · MAT-42"]);
      expect(d.footer).toContainEqual(["Net à payer", expect.stringContaining("1"), true]);
      expect(d.currency).toBe("XAF");
    }
  });
  it("attend l'identité de l'employeur avant d'autoriser les documents", () => {
    mocks.company = { data: undefined, isLoading: true, isError: false };
    show();
    for (const name of ["CSV", "Excel", "PDF"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  });
  it("réserve les téléchargements au droit d'export", () => {
    show(false);
    for (const name of ["CSV", "Excel", "PDF"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});


