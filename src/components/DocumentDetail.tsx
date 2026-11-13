import type { ReactNode } from "react";

export type DetailColumn = { label: string; align?: "left" | "right" };

/**
 * Lecture d'une pièce en trois zones (SAP / Sage) : en-tête (champs), lignes (grille), pied
 * (totaux calculés). Utilisé par les vues de détail des commandes, réceptions, demandes et
 * factures. L'édition officielle imprimée (modèles PDF archivés) relève du Lot 6.
 */
export function DocumentDetail({ header, columns, rows, footer, emptyLines = "Aucune ligne." }: {
  header: [string, ReactNode][];
  columns: DetailColumn[];
  rows: ReactNode[][];
  footer: [string, ReactNode, boolean?][];
  emptyLines?: string;
}) {
  return (
    <div className="space-y-4" data-testid="document-detail">
      <section aria-label="En-tête" className="grid grid-cols-2 gap-x-6 gap-y-2">
        {header.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-sm text-foreground">{value ?? "—"}</p>
          </div>
        ))}
      </section>

      <section aria-label="Lignes" className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>{columns.map((c) => <th key={c.label} className={`p-2 ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-4 text-center text-muted-foreground">{emptyLines}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((cell, j) => (
                  <td key={j} className={`p-2 ${columns[j]?.align === "right" ? "text-right tabular-nums" : ""}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Pied" className="ml-auto w-full max-w-xs space-y-1 text-xs">
        {footer.map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between ${strong ? "font-semibold border-t border-border pt-1" : ""}`}>
            <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
