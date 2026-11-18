import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useHrCompanyContext, usePayrollComponentLines } from "@/hooks/use-hr-data";
import { exportToCSV } from "@/lib/csv-export";
import { exportToXLSX } from "@/lib/xlsx";
import { exportToPDF } from "@/lib/pdf-export";
import { toast } from "sonner";
import { bulletinLines } from "@/lib/payroll-bulletin-lines";

type Row = { code: string; label: string; type: string; base: number | string; rate: number | string | null; amount: number | string; source: string };
const columns = [
  { key: "code" as const, header: "Code" }, { key: "label" as const, header: "Rubrique" },
  { key: "type" as const, header: "Nature" }, { key: "base" as const, header: "Base" },
  { key: "rate" as const, header: "Taux" }, { key: "amount" as const, header: "Montant" },
  { key: "source" as const, header: "Origine" },
];

export function PayrollComponentLinesDialog({ runId, run, employee, open, onOpenChange, canExport }: {
  runId: string; run: { period: string; pay_date: string; payroll_currency_code: string | null };
  employee: { id: string; name: string; gross: number; deductions: number; taxes: number; net: number; employerCharges: number } | null;
  open: boolean; onOpenChange: (open: boolean) => void; canExport: boolean;
}) {
  const query = usePayrollComponentLines(open && employee ? runId : null, employee?.id ?? null);
  const company = useHrCompanyContext();
  const rows: Row[] = bulletinLines(query.data ?? []).map((line) => ({
    code: line.code_snapshot, label: line.label_snapshot,
    type: line.kind === "earning" ? "Gain" : line.kind === "deduction" ? "Retenue" : "Charge employeur",
    base: Number(line.calculation_base), rate: line.rate_snapshot == null ? null : Number(line.rate_snapshot),
    amount: Number(line.amount), source: line.source_type === "base_salary" ? "Salaire de base" : line.source_type === "employee_assignment" ? "Affectation périodique" : "Variable approuvée",
  }));
  const file = `bulletin-${employee?.id.slice(0, 8)}-${runId.slice(0, 8)}`;
  const currency = run.payroll_currency_code || "Devise non enregistrée";
  const employer = company.data?.legal_name || company.data?.name || "Identité employeur non renseignée";
  const employerDetails = [company.data?.address, company.data?.phone, company.data?.email,
    company.data?.rccm ? `RCCM ${company.data.rccm}` : null,
    company.data?.tax_id ? `N° fiscal ${company.data.tax_id}` : null].filter(Boolean).join(" · ");
  const money = (value: number) => `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
  const summary = employee ? `Brut ${money(employee.gross)} · Retenues ${money(employee.deductions)} · Impôt ${money(employee.taxes)} · Net à payer ${money(employee.net)} · Charges employeur ${money(employee.employerCharges)}` : "";
  const exportRows: Row[] = employee ? [
    { code: "SALARIE", label: employee.name, type: "Identité du salarié", base: "", rate: null, amount: "", source: employee.id },
    { code: "SOCIÉTÉ", label: employer, type: employerDetails, base: "", rate: null, amount: "", source: "Identité employeur" },
    { code: "PÉRIODE", label: run.period, type: `Paiement prévu le ${run.pay_date}`, base: "", rate: null, amount: "", source: currency },
    ...[
      ["TOTAL_BRUT", "Brut", employee.gross], ["TOTAL_RETENUES", "Retenues salariales", employee.deductions],
      ["TOTAL_IMPOT", "Impôt", employee.taxes], ["NET_A_PAYER", "Net à payer", employee.net],
      ["CHARGES_EMPLOYEUR", "Charges employeur", employee.employerCharges],
    ].map(([code, label, amount]) => ({ code: String(code), label: String(label), type: "Total cycle salarié", base: "", rate: null, amount: Number(amount), source: currency })),
    ...rows,
  ] : rows;
  const exportDisabled = query.isLoading || query.isError || company.isLoading || company.isError
    || !company.data || !employee || !run.payroll_currency_code || !rows.length;
  const pdf = async () => {
    try { await exportToPDF({ filename: file, title: `Bulletin de paie · ${employee?.name}`, subtitle: `${employer}${employerDetails ? ` · ${employerDetails}` : ""} · Période ${run.period} · Paiement prévu le ${run.pay_date} · Devise ${currency} · ${summary}`, columns, rows, orientation: "portrait" }, { throwOnError: true }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Échec de l’export PDF."); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl">
    <DialogHeader><DialogTitle>Bulletin de paie · {employee?.name}</DialogTitle><DialogDescription>{employer}{employerDetails ? ` · ${employerDetails}` : ""} · Période {run.period} · Paiement prévu le {run.pay_date} · Devise : {currency}</DialogDescription></DialogHeader>
    {company.isError && <p role="alert" className="text-xs text-amber-700">Identité de la société indisponible ; le bulletin n'affichera que les informations de période et de devise.</p>}
    {employee && <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
      {[['Brut', employee.gross], ['Retenues', employee.deductions], ['Impôt', employee.taxes], ['Net à payer', employee.net], ['Charges employeur', employee.employerCharges]].map(([label, amount]) =>
        <div key={String(label)} className="rounded border p-2"><div className="text-[10px] uppercase text-muted-foreground">{String(label)}</div><div className="font-semibold">{money(Number(amount))}</div></div>)}
    </div>}
    {query.isError && <div role="alert" className="text-xs text-destructive">Détail non disponible{query.error instanceof Error ? ` : ${query.error.message}` : "."} L’export est bloqué.</div>}
    {query.isLoading ? <p className="py-6 text-center text-xs text-muted-foreground">Chargement…</p> : <>
      {canExport && <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={exportDisabled} onClick={() => exportToCSV(exportRows, columns, `${file}.csv`)}>CSV</Button><Button size="sm" variant="outline" disabled={exportDisabled} onClick={() => exportToXLSX(exportRows, columns, file, "Bulletin")}>Excel</Button><Button size="sm" variant="outline" disabled={exportDisabled} onClick={() => void pdf()}>PDF</Button></div>}
      <div className="max-h-[55vh] overflow-auto rounded border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted"><tr>{columns.map((col) => <th key={col.key} className="p-2">{col.header}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.code}-${i}`} className="border-t"><td className="p-2 font-mono">{row.code}</td><td className="p-2">{row.label}</td><td className="p-2">{row.type}</td><td className="p-2 text-right">{typeof row.base === "number" ? row.base.toLocaleString("fr-FR") : row.base}</td><td className="p-2 text-right">{row.rate == null ? "—" : typeof row.rate === "number" ? `${row.rate}%` : row.rate}</td><td className="p-2 text-right font-semibold">{typeof row.amount === "number" ? row.amount.toLocaleString("fr-FR") : row.amount}</td><td className="p-2">{row.source}</td></tr>)}{!rows.length && <tr><td colSpan={7} className="p-5 text-center text-muted-foreground">Aucun détail de paie conservé pour cette ligne.</td></tr>}</tbody></table></div>
    </>}
  </DialogContent></Dialog>;
}
