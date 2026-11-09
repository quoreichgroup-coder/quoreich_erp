// Generates a mini-report PDF for a treasury period close from a history row.
import { exportToPDF, type PdfColumn } from "./pdf-export";
import type { TreasuryCloseHistoryRow } from "@/hooks/use-treasury-close";

type ReportRow = { label: string; value: string };

export function exportTreasuryCloseReport(row: TreasuryCloseHistoryRow): void {
  const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
  const closedAt = row.closed_at ? new Date(row.closed_at).toLocaleString("fr-FR") : "—";

  const rows: ReportRow[] = [
    { label: "Période",                value: row.period },
    { label: "Statut",                 value: row.status },
    { label: "Solde total (XOF)",      value: fmt(Number(row.total_balance ?? 0)) },
    { label: "Nombre de comptes",      value: String(row.accounts_count ?? 0) },
    { label: "Rapprochements inclus",  value: String(row.reconciliations_count ?? 0) },
    { label: "Clôturée le",            value: closedAt },
    { label: "Clôturée par",           value: row.closed_by_name ?? row.closed_by ?? "—" },
    { label: "Message d'erreur",       value: row.error_message ?? "—" },
  ];

  const columns: PdfColumn<ReportRow>[] = [
    { key: "label", header: "Champ" },
    { key: "value", header: "Valeur" },
  ];

  exportToPDF<ReportRow>({
    filename: `treasury-close-${row.period}.pdf`,
    title: `Clôture Trésorerie — ${row.period}`,
    subtitle: `Statut : ${row.status} · Généré depuis l'historique des clôtures`,
    columns,
    rows,
    orientation: "portrait",
  });
}

/**
 * Defensive wrapper: never lets a PDF generation crash bubble up to the
 * caller. The history table stays mounted and interactive; the `onError`
 * callback can surface a toast. Returns `true` on success.
 */
export function safeExportTreasuryCloseReport(
  row: TreasuryCloseHistoryRow,
  onError: (err: Error) => void,
  impl: (r: TreasuryCloseHistoryRow) => void = exportTreasuryCloseReport,
): boolean {
  try {
    impl(row);
    return true;
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)));
    return false;
  }
}
