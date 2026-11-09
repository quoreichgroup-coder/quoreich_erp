import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type QuoteExportLine = {
  description: string | null;
  quantity: number | string;
  unit_price: number | string;
  total: number | string;
};

export type QuoteExportData = {
  quote_number: string;
  quote_date: string;
  valid_until: string | null;
  status: string;
  customer_name: string;
  currency: string;
  total: number;
  lines: QuoteExportLine[];
  opportunity_name?: string | null;
  so_number?: string | null;
};

export type QuotePerms = {
  canExport: boolean;
  canViewSensitive: boolean;
};

const MASK = "•••";

function fmtMoney(v: number | string, perms: QuotePerms) {
  if (!perms.canViewSensitive) return MASK;
  const n = Number(v ?? 0);
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export function buildQuotePreviewRows(q: QuoteExportData, perms: QuotePerms) {
  return q.lines.map((l) => ({
    description: l.description ?? "",
    quantity: String(l.quantity ?? 0),
    unit_price: fmtMoney(l.unit_price, perms),
    total: fmtMoney(l.total, perms),
  }));
}

export function exportQuoteCsv(q: QuoteExportData, perms: QuotePerms): string {
  if (!perms.canExport) throw new Error("export_forbidden");
  const header = ["Description", "Quantité", "Prix unitaire", "Total"];
  const rows = buildQuotePreviewRows(q, perms).map((r) => [r.description, r.quantity, r.unit_price, r.total]);
  const meta = [
    [`Devis`, q.quote_number],
    [`Client`, q.customer_name],
    [`Date`, q.quote_date],
    [`Validité`, q.valid_until ?? ""],
    [`Statut`, q.status],
    [`Devise`, q.currency],
    [`Total`, fmtMoney(q.total, perms)],
  ];
  const all = [...meta.map((m) => m.join(";")), "", header.join(";"), ...rows.map((r) => r.join(";"))];
  const csv = all.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `devis_${q.quote_number}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return csv;
}

export function exportQuotePdf(q: QuoteExportData, perms: QuotePerms): void {
  if (!perms.canExport) throw new Error("export_forbidden");
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Devis ${q.quote_number}`, 14, 18);
  doc.setFontSize(10);
  doc.text(`Client : ${q.customer_name}`, 14, 26);
  doc.text(`Date : ${q.quote_date}  ·  Validité : ${q.valid_until ?? "—"}`, 14, 32);
  doc.text(`Statut : ${q.status}  ·  Devise : ${q.currency}`, 14, 38);
  if (q.opportunity_name) doc.text(`Opportunité : ${q.opportunity_name}`, 14, 44);
  if (q.so_number) doc.text(`Bon de commande : ${q.so_number}`, 14, 50);

  autoTable(doc, {
    startY: 58,
    head: [["Description", "Qté", "PU", "Total"]],
    body: buildQuotePreviewRows(q, perms).map((r) => [r.description, r.quantity, r.unit_price, r.total]),
    styles: { fontSize: 9 },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
  doc.setFontSize(11);
  doc.text(`Total : ${fmtMoney(q.total, perms)} ${q.currency}`, 14, finalY + 10);

  if (!perms.canViewSensitive) {
    doc.setFontSize(8);
    doc.setTextColor(180, 100, 0);
    doc.text("Montants masqués — permission view_sensitive requise.", 14, finalY + 18);
  }

  doc.save(`devis_${q.quote_number}.pdf`);
}
