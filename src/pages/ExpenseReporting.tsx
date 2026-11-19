import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useExpenseCategories, useExpenseReports } from "@/hooks/use-expenses";
import { sumBy } from "@/lib/expenses";

/*
 * Notes de frais → Rapports : dépenses approuvées (approuvées, comptabilisées, remboursées) de l'exercice
 * par catégorie, par salarié et par mois, HT / TVA / TTC ; reste à rembourser.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export default function ExpenseReporting() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data: reports = [], isLoading } = useExpenseReports();
  const { data: categories = [] } = useExpenseCategories();
  const r = useMemo(() => {
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const kept = reports.filter((x) => ["approved", "posted", "paid"].includes(x.status));
    const lines = kept.flatMap((x) => x.lines.filter((l) => l.expense_date.startsWith(year)).map((l) => ({ ...l, who: x.employee ? `${x.employee.last_name} ${x.employee.first_name}` : "—" })));
    return {
      byCategory: sumBy(lines, (l) => (l.category_id && catName.get(l.category_id)) || l.category || "", (l) => l.amount),
      byEmployee: sumBy(lines, (l) => l.who, (l) => l.amount),
      byMonth: MOIS.map((m, i) => { const k = `${year}-${String(i + 1).padStart(2, "0")}`; const l = lines.filter((x) => x.expense_date.startsWith(k));
        return { label: m, amount: l.reduce((s, x) => s + x.amount, 0), count: l.length }; }),
      ht: lines.reduce((s, l) => s + (l.net_amount ?? 0), 0), tva: lines.reduce((s, l) => s + (l.tax_amount ?? 0), 0), ttc: lines.reduce((s, l) => s + l.amount, 0),
      toPay: kept.filter((x) => x.status !== "paid").reduce((s, x) => s + x.total, 0),
    };
  }, [reports, categories, year]);
  const table = (title: string, rows: { label: string; amount: number; count: number }[], head: string, file: string) => (
    <Card className="border-border">
      <CardHeader className="p-4 pb-2 flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">{title}</CardTitle>
        <ExportButtons label={title} rows={rows.map((x) => ({ libelle: x.label, depenses: x.count, ttc: x.amount }))}
          columns={[{ key: "libelle", header: head }, { key: "depenses", header: "Dépenses" }, { key: "ttc", header: "Montant TTC" }]} filename={`${file}-${year}`} /></CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs"><thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">{head}</th><th className="text-right">Dépenses</th><th className="text-right pr-3">TTC</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">Aucune dépense approuvée.</td></tr>
            : rows.map((x) => <tr key={x.label} className="border-t border-border/50"><td className="px-3 py-1.5">{x.label}</td><td className="text-right tabular-nums">{x.count}</td><td className="text-right tabular-nums pr-3">{fmt(x.amount)}</td></tr>)}</tbody></table>
      </CardContent>
    </Card>
  );
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais", href: "/expenses" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports des notes de frais" description="Dépenses approuvées de l'exercice par catégorie, par salarié et par mois ; montants HT, TVA récupérable et TTC." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Notes de frais — Rapports</h1>
        <div className="flex items-center gap-2"><label htmlFor="exp-year" className="text-xs text-muted-foreground">Exercice</label>
          <Input id="exp-year" className="h-8 w-24 text-xs" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="expense-report-kpis">
            {[["Total HT", r.ht], ["TVA récupérable", r.tva], ["Total TTC", r.ttc], ["Reste à rembourser", r.toPay]].map(([l, v]) => (
              <div key={l as string} className="bg-card border border-border rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className="text-lg font-semibold">{fmt(v as number)}</div></div>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            {table("Par catégorie", r.byCategory, "Catégorie", "frais-par-categorie")}
            {table("Par salarié", r.byEmployee, "Salarié", "frais-par-salarie")}
          </div>
          {table("Par mois", r.byMonth.filter((m) => m.count > 0), "Mois", "frais-par-mois")}
        </>
      )}
    </PageShell>
  );
}
