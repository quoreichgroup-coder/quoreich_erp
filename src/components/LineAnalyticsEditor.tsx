import { useState } from "react";
import { useAnalyticsSetup } from "@/hooks/use-analytics-setup";
import { usableValues } from "@/lib/analytics-setup";
import type { LineAnalytics } from "@/hooks/use-document-analytics";

/*
 * Ventilation analytique par ligne (V78) : pour chaque ligne de la pièce, une section par axe, ou « comme
 * l'en-tête ». Les lignes portent leurs sections dans `analytics` (les éditeurs de lignes conservent les champs
 * qu'ils ne connaissent pas). Rien ne s'affiche si la société n'a pas d'axe actif.
 */
type WithAnalytics = { description: string; analytics?: LineAnalytics };

export function LineAnalyticsEditor<L extends WithAnalytics>({ lines, onChange, date, idPrefix, disabled = false }: {
  lines: L[]; onChange: (lines: L[]) => void; date: string; idPrefix: string; disabled?: boolean;
}) {
  const { data } = useAnalyticsSetup();
  const axes = (data?.axes ?? []).filter((a) => a.active);
  const used = lines.some((l) => l.analytics && Object.values(l.analytics).some(Boolean));
  const [open, setOpen] = useState(used);
  if (axes.length === 0) return null;
  const set = (i: number, axis: string, value: string) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, analytics: { ...(l.analytics ?? {}), [axis]: value } } : l)));
  return (
    <div className="space-y-2 text-xs" data-testid={`${idPrefix}-line-analytics`}>
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={open || used} disabled={disabled || used} onChange={(e) => setOpen(e.target.checked)} />
        <span className="font-medium text-foreground">Ventiler les sections analytiques par ligne</span>
        <span className="text-muted-foreground">(sinon chaque ligne prend les sections de l'en-tête)</span>
      </label>
      {(open || used) && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-1.5">Ligne</th>
              {axes.map((a) => <th key={a.id} className="text-left p-1.5">{a.name}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-1.5 whitespace-nowrap">{i + 1}. {l.description || "—"}</td>
                  {axes.map((a) => {
                    const current = l.analytics?.[a.id] ?? "";
                    return (
                      <td key={a.id} className="p-1">
                        <select aria-label={`${a.name} ligne ${i + 1}`} value={current} disabled={disabled}
                          className="w-full h-7 px-1.5 rounded-md border border-input bg-background text-xs"
                          onChange={(e) => set(i, a.id, e.target.value)}>
                          <option value="">Comme l'en-tête</option>
                          {usableValues(a, date).map((v) => <option key={v.id} value={v.id}>{v.code} {v.name}</option>)}
                        </select>
                      </td>);
                  })}
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
