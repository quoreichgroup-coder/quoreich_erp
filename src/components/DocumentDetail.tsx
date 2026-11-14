import { isValidElement, type ReactNode } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCSV } from "@/lib/csv-export";
import { printDocumentPDF, type CompanyIdentity } from "@/lib/document-pdf";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId } from "@/hooks/use-tenant";
import { isApiEnabled } from "@/api/client";

export type DetailColumn = { label: string; align?: "left" | "right" };

/**
 * Lecture d'une pièce en trois zones (SAP / Sage) : en-tête (champs), lignes (grille), pied
 * (totaux calculés). Utilisé par les vues de détail des commandes, réceptions, demandes et
 * factures. L'édition officielle imprimée (modèles PDF archivés) relève du Lot 6.
 */
/** Nom de fichier à partir du titre d'une pièce : « Devis QT-2026-0001 » → « devis-qt-2026-0001 ». */
export function documentFileName(title: string): string {
  return title.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** Texte d'une cellule pour l'export (les cellules sont des chaînes ou des nombres ; le reste est ignoré). */
function texte(v: ReactNode): string {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(texte).join("");
  if (isValidElement(v)) return texte((v.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Export de la pièce affichée : CSV (lignes, puis en-tête et pied en lignes de libellé) et PDF
 * imprimable (en-tête en sous-titre, lignes, pied). L'édition officielle (modèles versionnés,
 * archivage) reste au Lot 6 ; ceci imprime exactement ce que l'écran montre.
 */
function exporter(kind: "csv" | "pdf", title: string, fileName: string, header: [string, ReactNode][],
  columns: DetailColumn[], rows: ReactNode[][], footer: [string, ReactNode, boolean?][]) {
  const keys = columns.map((_, i) => `c${i}`);
  const data: Record<string, string>[] = rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, texte(r[i])])));
  const extra = (pairs: [string, ReactNode][]) => pairs.map(([l, v]) => {
    const row: Record<string, string> = Object.fromEntries(keys.map((k) => [k, ""]));
    row[keys[0]] = l;
    row[keys[keys.length - 1]] = texte(v);
    return row;
  });
  if (kind === "csv") {
    exportToCSV([...extra(header), ...data, ...extra(footer.map(([l, v]) => [l, v]))],
      keys.map((k, i) => ({ key: k, header: columns[i].label })), fileName);
    return;
  }
  void (async () => {
    void printDocumentPDF({
      title, fileName, company: await companyIdentity(),
      header: header.map(([l, v]) => [l, texte(v)]),
      columns,
      rows: rows.map((r) => columns.map((_, i) => texte(r[i]))),
      footer: footer.map(([l, v, strong]) => [l, texte(v), strong]),
    });
  })();
}

/** Identité légale de la société (V47) pour l'en-tête imprimé ; sans elle, mentions « à renseigner ». */
async function companyIdentity(): Promise<CompanyIdentity | null> {
  if (isApiEnabled()) return null;
  try {
    const tenantId = await fetchTenantId();
    const { data } = await (supabase as any).from("tenants")
      .select("name, legal_name, address, phone, email, rccm, tax_id, tax_regime, tax_office, bank_details").eq("id", tenantId).single();
    return (data as CompanyIdentity) ?? null;
  } catch {
    return null;
  }
}

export function DocumentDetail({ header, columns, rows, footer, emptyLines = "Aucune ligne.", title, fileName }: {
  header: [string, ReactNode][];
  columns: DetailColumn[];
  rows: ReactNode[][];
  footer: [string, ReactNode, boolean?][];
  emptyLines?: string;
  /** Avec un titre et un nom de fichier : boutons « Exporter » (CSV) et « Imprimer » (PDF). */
  title?: string;
  fileName?: string;
}) {
  return (
    <div className="space-y-4" data-testid="document-detail">
      {title && fileName && (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-document-csv"
            onClick={() => exporter("csv", title, fileName, header, columns, rows, footer)}>
            <Download className="w-3 h-3" /> Exporter
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="btn-document-pdf"
            onClick={() => exporter("pdf", title, fileName, header, columns, rows, footer)}>
            <Printer className="w-3 h-3" /> Imprimer
          </Button>
        </div>
      )}
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
