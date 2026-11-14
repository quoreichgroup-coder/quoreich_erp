import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyLine, invoiceTotals, type DraftLine, type TaxCode } from "@/lib/invoice-lines";

/*
 * Lignes d'une pièce commerciale (facture client, devis, commande) : libellé, quantité, prix,
 * remise, code TVA, HT de la ligne ; et pied HT / TVA / TTC. Le calcul affiché est celui de la base
 * (compute_ar_invoice_line, V21 ; lignes de vente, V43) : la base recalcule et fait foi.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR");

export function CommercialLinesEditor({
  lines, onChange, taxCodes, testId = "invoice-lines", linePrefix = "invoice-line",
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  taxCodes: TaxCode[];
  testId?: string;
  linePrefix?: string;
}) {
  const active = taxCodes.filter((t) => t.active);
  const { amounts } = invoiceTotals(lines, taxCodes);
  const setLine = (i: number, patch: Partial<DraftLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Libellé</th>
              <th className="py-1.5 pr-2 font-medium text-right w-20">Qté</th>
              <th className="py-1.5 pr-2 font-medium text-right w-28">Prix unitaire</th>
              <th className="py-1.5 pr-2 font-medium text-right w-20">Remise %</th>
              <th className="py-1.5 pr-2 font-medium w-32">TVA</th>
              <th className="py-1.5 pr-2 font-medium text-right w-28">HT</th>
              <th className="w-8"><span className="sr-only">Retirer</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border/50" data-testid={`${linePrefix}-${i + 1}`}>
                <td className="py-1 pr-2"><Input aria-label={`Libellé ligne ${i + 1}`} className="h-8 text-xs" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={`Quantité ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={`Prix unitaire ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={`Remise ligne ${i + 1}`} inputMode="decimal" placeholder="0" className="h-8 text-xs text-right" value={l.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} /></td>
                <td className="py-1 pr-2">
                  <select aria-label={`Code TVA ligne ${i + 1}`} className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={l.taxCodeId} onChange={(e) => setLine(i, { taxCodeId: e.target.value })}>
                    <option value="">Sans TVA</option>
                    {active.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.rate} %</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{amounts[i]?.valid ? fmt(amounts[i].net) : "—"}</td>
                <td className="py-1 text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`Retirer la ligne ${i + 1}`}
                    disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, k) => k !== i))}>×</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="btn-add-line"
        onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.taxCodeId ?? "")])}>
        <Plus className="w-3 h-3" /> Ajouter une ligne
      </Button>
      {active.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun code TVA actif : créez-en dans Paramètres → Codes TVA pour appliquer de la TVA.</p>
      )}
    </div>
  );
}

export function CommercialTotals({ lines, taxCodes, testId }: { lines: DraftLine[]; taxCodes: TaxCode[]; testId?: string }) {
  const { subtotal, tax, total } = invoiceTotals(lines, taxCodes);
  return (
    <div className="bg-muted/30 rounded p-3 text-xs" data-testid={testId}>
      <div className="flex justify-between"><span>Sous-total HT</span><span className="tabular-nums">{fmt(subtotal)} XOF</span></div>
      <div className="flex justify-between"><span>TVA</span><span className="tabular-nums">{fmt(tax)} XOF</span></div>
      <div className="flex justify-between font-medium border-t border-border mt-1.5 pt-1.5"><span>Total TTC</span><span className="tabular-nums">{fmt(total)} XOF</span></div>
    </div>
  );
}

/** Lignes saisies → charge utile des fonctions de vente (V43). */
export function toSalesLines(lines: DraftLine[]) {
  const n = (s: string) => Number(String(s).replace(",", "."));
  return lines.map((l) => ({
    description: l.description.trim(),
    quantity: n(l.quantity),
    unit_price: n(l.unitPrice),
    discount_pct: l.discountPct === "" ? 0 : n(l.discountPct),
    tax_code_id: l.taxCodeId || null,
  }));
}
