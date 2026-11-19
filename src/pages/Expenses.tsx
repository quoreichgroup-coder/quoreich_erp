import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useExpenseCategories, useExpenseReports } from "@/hooks/use-expenses";
import { EXPENSE_STATUS, sumBy } from "@/lib/expenses";

/* Notes de frais → Tableau de bord : notes en cours par étape et dépenses de l'année par catégorie, sur les notes visibles de l'utilisateur. */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const tip = { fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

export default function Expenses() {
  const { data: reports = [], isLoading } = useExpenseReports();
  const { data: categories = [] } = useExpenseCategories();
  const year = String(new Date().getFullYear());
  const byStatus = (s: string) => reports.filter((r) => r.status === s);
  const stage = [["submitted", "En approbation"], ["approved", "À comptabiliser"], ["posted", "À rembourser"], ["rejected", "Rejetées (à corriger)"]] as const;
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const lines = reports.filter((r) => ["approved", "posted", "paid"].includes(r.status)).flatMap((r) => r.lines.filter((l) => l.expense_date.startsWith(year)));
  const byCategory = sumBy(lines, (l) => (l.category_id && catName.get(l.category_id)) || l.category || "", (l) => l.amount);
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais" }]} />
      <GuidanceBanner title="Notes de frais" description="Notes en cours à chaque étape et dépenses approuvées de l'année, par catégorie." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Notes de frais — Tableau de bord</h1>
        <Button asChild size="sm"><Link to="/expenses/transactions">Saisir ou suivre les notes</Link></Button>
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="expense-kpis">
            {stage.map(([s, l]) => {
              const list = byStatus(s);
              return (
                <Link key={s} to={`/expenses/transactions?tab=${s === "submitted" ? "approvals" : s === "rejected" ? "reports" : "posting"}`} className="bg-card border border-border rounded-lg p-3 hover:bg-muted/30">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
                  <div className="text-lg font-semibold">{list.length}</div>
                  <div className="text-[11px] text-muted-foreground">{fmt(list.reduce((t, r) => t + r.total, 0))} XOF</div>
                </Link>
              );
            })}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Dépenses approuvées {year} par catégorie</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                {byCategory.length === 0 ? <p className="text-xs text-muted-foreground py-10 text-center">Aucune dépense approuvée cette année.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={byCategory} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" /><YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={tip} /><Bar dataKey="amount" name="TTC" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Dernières notes</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-1">
                {reports.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs border-b border-border/50 py-1">
                    <span className="font-mono">{r.report_number}</span><span className="flex-1 truncate">{r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : ""} · {r.purpose}</span>
                    <span className="tabular-nums">{fmt(r.total)}</span><StatusBadge status={EXPENSE_STATUS[r.status][0]} label={EXPENSE_STATUS[r.status][1]} />
                  </div>
                ))}
                {reports.length === 0 && <p className="text-xs text-muted-foreground">Aucune note de frais.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
