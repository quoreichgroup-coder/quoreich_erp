import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentFooter, emptyDocLine, lineAmount, type DraftDocLine } from "@/lib/document-lines";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Zone « lignes » et « pied » d'une pièce d'achat : grille libellé / quantité / prix / montant,
 * puis pied calculé (nombre de lignes, quantité, total) en lecture seule.
 */
export function DocumentLinesEditor({ lines, onChange, priceLabel = "Prix unitaire" }: {
  lines: DraftDocLine[];
  onChange: (lines: DraftDocLine[]) => void;
  priceLabel?: string;
}) {
  const set = (i: number, patch: Partial<DraftDocLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const footer = documentFooter(lines);
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left p-2">Libellé</th>
            <th className="text-right p-2 w-20">Quantité</th>
            <th className="text-right p-2 w-32">{priceLabel}</th>
            <th className="text-right p-2 w-32">Montant</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-1.5"><Input aria-label={`Libellé ligne ${i + 1}`} className="h-8 text-xs" value={l.description}
                onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td className="p-1.5"><Input aria-label={`Quantité ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right"
                value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
              <td className="p-1.5"><Input aria-label={`${priceLabel} ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right"
                value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
              <td className="p-2 text-right tabular-nums">{fmt(lineAmount(l))}</td>
              <td className="p-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" aria-label={`Retirer la ligne ${i + 1}`}
                  disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/20">
          <tr className="border-t border-border">
            <td className="p-2">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid="btn-add-doc-line"
                onClick={() => onChange([...lines, emptyDocLine()])}>
                <Plus className="w-3 h-3" /> Ajouter une ligne
              </Button>
            </td>
            <td className="p-2 text-right tabular-nums text-muted-foreground" data-testid="doc-footer-quantity">{fmt(footer.totalQuantity)}</td>
            <td className="p-2 text-right font-medium">Total ({footer.lineCount} ligne{footer.lineCount > 1 ? "s" : ""})</td>
            <td className="p-2 text-right tabular-nums font-semibold" data-testid="doc-footer-total">{fmt(footer.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
