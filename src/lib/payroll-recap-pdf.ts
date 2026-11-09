import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PayrollLine, PayrollRun } from "@/hooks/use-hr-data";
import { canDo, maskAmount, type HrPerms } from "@/lib/hr-roles";
import { buildJournalPreview, type PayrollComputation } from "@/lib/payroll-engine";

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", approved: "Approuvé", posted: "Comptabilisé",
};

/**
 * Builds a recap PDF for a payroll run: KPI summary, draft→approved→posted
 * timeline, lines detail and the SYSCOHADA JE preview (with imbalance warning).
 * Strictly enforces has_hr_perm: requires `export`; masks amounts unless
 * the user has `view_sensitive`.
 */
export function exportPayrollRunRecapPDF(
  run: PayrollRun,
  lines: PayrollLine[],
  perms: HrPerms,
) {
  if (!canDo(perms, "export")) {
    throw new Error("Export verrouillé : rôle hr_approver / payroll_officer / hr_auditor requis.");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 32;
  let y = margin;

  // Title
  doc.setFontSize(14);
  doc.text(`Récapitulatif paie — ${run.period}`, margin, y);
  y += 16;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, margin, y);
  y += 18;

  // Timeline
  doc.setTextColor(0);
  doc.setFontSize(10);
  const steps: ("draft" | "approved" | "posted")[] = ["draft", "approved", "posted"];
  const current = run.status === "posted" ? 3 : run.status === "approved" ? 2 : 1;
  const timeline = steps
    .map((s, i) => `${i + 1 <= current ? "●" : "○"} ${STATUS_LABEL[s]}`)
    .join("   →   ");
  doc.text(timeline, margin, y);
  y += 18;

  // KPI table
  autoTable(doc, {
    startY: y,
    head: [["Indicateur", "Valeur"]],
    body: [
      ["Période", run.period],
      ["Date de paie", run.pay_date],
      ["Statut", STATUS_LABEL[run.status] ?? run.status],
      ["Effectif", String(run.employee_count)],
      ["Brut total", `${maskAmount(perms, +run.gross_total)} XOF`],
      ["Net total", `${maskAmount(perms, +run.net_total)} XOF`],
      ["Approuvé le", run.approved_at?.slice(0, 16).replace("T", " ") ?? "—"],
      ["Comptabilisé le", run.executed_at?.slice(0, 16).replace("T", " ") ?? "—"],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: margin, right: margin },
  });
  // @ts-expect-error autoTable mutates doc with lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 18;

  // Lines detail
  doc.setFontSize(11);
  doc.text(`Lignes de paie (${lines.length})`, margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [["Employé", "Brut", "CNPS", "IRPP", "Net"]],
    body: lines.map((l) => [
      l.employee_id.slice(0, 8),
      maskAmount(perms, +l.gross),
      maskAmount(perms, +l.deductions),
      maskAmount(perms, +l.taxes),
      maskAmount(perms, +l.net),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: margin, right: margin },
  });
  // @ts-expect-error autoTable mutates doc with lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 18;

  // JE preview
  const comps: PayrollComputation[] = lines.map((l) => ({
    gross: +l.gross, deductions: +l.deductions, taxes: +l.taxes, net: +l.net,
  }));
  const je = buildJournalPreview(comps);

  doc.setFontSize(11);
  doc.text("Écriture SYSCOHADA (aperçu)", margin, y);
  y += 8;
  if (!je.balanced) {
    doc.setTextColor(180, 30, 30);
    doc.setFontSize(9);
    doc.text(
      `⚠ Écriture déséquilibrée — Débit ${je.totalDebit.toLocaleString("fr-FR")} / Crédit ${je.totalCredit.toLocaleString("fr-FR")}`,
      margin, y,
    );
    doc.setTextColor(0);
    y += 12;
  }
  autoTable(doc, {
    startY: y,
    head: [["Compte", "Libellé", "Débit", "Crédit"]],
    body: [
      ...je.lines.map((l) => [
        l.account, l.label,
        l.debit ? maskAmount(perms, l.debit) : "",
        l.credit ? maskAmount(perms, l.credit) : "",
      ]),
      ["", "Totaux", maskAmount(perms, je.totalDebit), maskAmount(perms, je.totalCredit)],
    ],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  doc.save(`payroll-recap-${run.period}.pdf`);
}
