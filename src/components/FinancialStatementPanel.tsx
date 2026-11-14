import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { cn } from "@/lib/utils";

/*
 * États financiers par rubriques (V63, lot PC-2) : compte de résultat (TA … XI) et bilan (AD … DZ)
 * SYSCOHADA, calculés par la base à partir de règles d'affectation en données (aucun numéro de compte
 * dans l'écran ni dans le code). Les exceptions d'affectation sont propres à la société.
 */
type Line = { line_code: string; label: string; line_order: number; kind: "detail" | "total"; amount: number };
const LAYOUTS: [string, string][] = [["CR_SYSCOHADA", "Compte de résultat SYSCOHADA"], ["BILAN_SYSCOHADA", "Bilan SYSCOHADA"]];
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const year = new Date().getFullYear();

export function FinancialStatementPanel() {
  const [layout, setLayout] = useState("CR_SYSCOHADA");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const isBalance = layout === "BILAN_SYSCOHADA";
  const { data: lines = [], isLoading, error } = useQuery({
    queryKey: ["financial-statement", layout, from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("financial_statement", { _layout: layout, _from: isBalance ? null : from, _to: to });
      if (error) throw error;
      return (data ?? []) as Line[];
    },
  });
  const title = `${LAYOUTS.find(([v]) => v === layout)?.[1]} — ${isBalance ? `au ${to}` : `du ${from} au ${to}`}`;
  const rows = lines.map((l) => ({ code: l.line_code, rubrique: l.label, montant: Number(l.amount) }));
  const cols: { key: "code" | "rubrique" | "montant"; header: string }[] = [{ key: "code", header: "Réf." }, { key: "rubrique", header: "Rubrique" }, { key: "montant", header: "Montant (XOF)" }];

  return (
    <section aria-label="États financiers SYSCOHADA" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg p-3">
        <div className="space-y-1"><Label className="text-xs" htmlFor="fs-layout">État</Label>
          <select id="fs-layout" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={layout} onChange={(e) => setLayout(e.target.value)}>
            {LAYOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        {!isBalance && <div className="space-y-1"><Label className="text-xs" htmlFor="fs-from">Du</Label>
          <Input id="fs-from" type="date" className="h-8 text-xs w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>}
        <div className="space-y-1"><Label className="text-xs" htmlFor="fs-to">{isBalance ? "Au" : "Au"}</Label>
          <Input id="fs-to" type="date" className="h-8 text-xs w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={rows.length === 0}
            onClick={() => exportToCSV(rows, cols, isBalance ? "bilan-syscohada" : "compte-de-resultat-syscohada")}>Exporter</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={rows.length === 0}
            onClick={() => exportToPDF({ filename: isBalance ? "bilan-syscohada" : "compte-de-resultat-syscohada", title, columns: cols, rows, orientation: "portrait" })}>Imprimer</Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Rubriques et affectations SYSCOHADA révisé en données (à valider par l'expert-comptable) ; écritures validées uniquement.</p>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="financial-statement">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2 w-16">Réf.</th><th className="text-left">Rubrique</th><th className="text-right pr-3">Montant (XOF)</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_code} data-testid="statement-line" className={cn("border-t border-border/50", l.kind === "total" && "bg-muted/20 font-semibold")}>
                  <td className="p-2 font-mono">{l.line_code}</td><td>{l.label}</td>
                  <td className={cn("text-right pr-3 tabular-nums", Number(l.amount) < 0 && "text-destructive")}>{fmt(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
