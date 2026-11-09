import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BarChart3, FileText, Clock, Download, Calendar, Layers, Trash2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useAPAging, useAPInvoices, useSuppliers } from "@/hooks/use-ap-data";
import { useReportTemplates, useSaveReportTemplate, useDeleteReportTemplate } from "@/hooks/use-ar-data";

const tabs = [
  { id: "aging", label: "Balance âgée", icon: Clock },
  { id: "supplier", label: "Performance fournisseurs", icon: BarChart3 },
  { id: "category", label: "Analyse par poste", icon: Layers },
  { id: "forecast", label: "Prévision paiements", icon: Calendar },
  { id: "templates", label: "Modèles sauvegardés", icon: FileText },
];

const fmtM = (n: number) => (n / 1_000_000).toFixed(1) + "M";
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");
const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function APReporting() {
  const [activeTab, setActiveTab] = useState("aging");

  const { data: aging = [] } = useAPAging();
  const { data: invoices = [] } = useAPInvoices();
  const { data: suppliers = [] } = useSuppliers();
  const { data: templates = [] } = useReportTemplates("ap");
  const saveTemplate = useSaveReportTemplate();
  const deleteTemplate = useDeleteReportTemplate();

  const agingData = useMemo(() => {
    const sums = aging.reduce((a: any, r: any) => {
      a.b1 += Number(r.bucket_0_30 || 0);
      a.b2 += Number(r.bucket_31_60 || 0);
      a.b3 += Number(r.bucket_61_90 || 0);
      a.b4 += Number(r.bucket_90_plus || 0);
      return a;
    }, { b1: 0, b2: 0, b3: 0, b4: 0 });
    return [
      { bucket: "0-30j", amount: sums.b1 },
      { bucket: "31-60j", amount: sums.b2 },
      { bucket: "61-90j", amount: sums.b3 },
      { bucket: "90+j", amount: sums.b4 },
    ];
  }, [aging]);

  const supplierStats = useMemo(() => {
    const map = new Map<string, any>();
    (invoices as any[]).forEach((inv) => {
      const sid = inv.supplier_id;
      if (!sid) return;
      const e = map.get(sid) || { supplier: inv.supplier?.name ?? "—", total: 0, invoices: 0, paidOnTime: 0, paidLate: 0, totalDays: 0, paidCount: 0 };
      e.total += Number(inv.total || 0);
      e.invoices += 1;
      const paid = Number(inv.amount_paid || 0) >= Number(inv.total || 0);
      if (paid) {
        e.paidCount += 1;
        const days = Math.round((new Date().getTime() - new Date(inv.invoice_date).getTime()) / 86400000);
        e.totalDays += days;
        if (days <= (inv.supplier?.payment_terms || 30)) e.paidOnTime += 1;
        else e.paidLate += 1;
      }
      map.set(sid, e);
    });
    return Array.from(map.values())
      .map((e) => ({
        ...e,
        avgDays: e.paidCount > 0 ? Math.round(e.totalDays / e.paidCount) : 0,
        onTimeRate: e.paidCount > 0 ? Math.round((e.paidOnTime / e.paidCount) * 100) : 0,
        status: e.onTimeRate < 70 ? "overdue" : e.onTimeRate < 90 ? "warning" : "good",
      }))
      .sort((a, b) => b.total - a.total);
  }, [invoices]);

  const forecastData = useMemo(() => {
    const buckets: Record<string, number> = {};
    (invoices as any[])
      .filter((i) => Number(i.amount_paid || 0) < Number(i.total || 0))
      .forEach((i) => {
        const d = new Date(i.due_date);
        const key = `S${Math.ceil(d.getDate() / 7)} ${d.toLocaleString("fr-FR", { month: "short" })}`;
        buckets[key] = (buckets[key] || 0) + (Number(i.total) - Number(i.amount_paid));
      });
    let cum = 0;
    return Object.entries(buckets).map(([week, amount]) => {
      cum += amount;
      return { week, amount, cumulative: cum };
    });
  }, [invoices]);

  const handleSaveTemplate = () => {
    const name = window.prompt("Nom du modèle ?");
    if (!name) return;
    saveTemplate.mutate({ module: "ap", name, data_source: activeTab, columns: [] as any, filters: {} as any, group_by: null });
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Comptes Fournisseurs", href: "/payables" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Reporting AP" description="Balance âgée, performance fournisseurs, analyse par poste, prévision de paiements — données live depuis la base." />

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "aging" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Distribution de la balance âgée</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Répartition par tranche</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={agingData} dataKey="amount" nameKey="bucket" cx="50%" cy="50%" outerRadius={90}
                  label={({ bucket, percent }) => `${bucket} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {agingData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="lg:col-span-2 bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30">
                {["Fournisseur", "0-30j", "31-60j", "61-90j", "90+j", "Total dû", "Jours retard"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {aging.map((r: any) => (
                  <tr key={r.supplier_id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{r.supplier_name}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmt(r.bucket_0_30)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmt(r.bucket_31_60)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmt(r.bucket_61_90)}</td>
                    <td className="px-3 py-2 font-mono text-right text-destructive">{fmt(r.bucket_90_plus)}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold">{fmt(r.total_outstanding)}</td>
                    <td className="px-3 py-2 text-center">{r.days_overdue}</td>
                  </tr>
                ))}
                {aging.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Aucune dette ouverte</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "supplier" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Performance fournisseurs</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Download className="w-3 h-3" />Export</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Fournisseur", "Total à payer (XOF)", "Factures", "Délai moyen", "% à temps", "Statut"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {supplierStats.map((s: any, i) => (
                <tr key={i} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{s.supplier}</td>
                  <td className="px-3 py-2 font-mono text-right">{fmt(s.total)}</td>
                  <td className="px-3 py-2 text-center">{s.invoices}</td>
                  <td className="px-3 py-2 text-center">{s.avgDays}j</td>
                  <td className="px-3 py-2 w-28">
                    <div className="flex items-center gap-2">
                      <Progress value={s.onTimeRate} className={cn("h-1.5", s.onTimeRate < 70 ? "[&>div]:bg-destructive" : s.onTimeRate < 90 ? "[&>div]:bg-amber-500" : "")} />
                      <span className={cn("text-[10px] tabular-nums", s.onTimeRate < 70 ? "text-destructive" : "")}>{s.onTimeRate}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={s.status === "overdue" ? "error" : s.status === "warning" ? "warning" : "success"} label={s.status} /></td>
                </tr>
              ))}
              {supplierStats.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Aucun fournisseur</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "category" && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-xs text-muted-foreground">
          La catégorisation par poste nécessite la liaison facture → compte GL. Configurez les comptes par défaut dans <span className="text-primary">Paramètres → Imputation GL</span>.
        </div>
      )}

      {activeTab === "forecast" && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Prévision de paiements (factures ouvertes par échéance)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="amount" name="Hebdo" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cumulative" name="Cumulé" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} opacity={0.3} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeTab === "templates" && (
        <div className="bg-card border border-border rounded-lg">
          <div className="p-3 border-b border-border flex justify-between">
            <h3 className="text-sm font-semibold text-foreground">Modèles sauvegardés</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSaveTemplate} disabled={saveTemplate.isPending}>+ Nouveau modèle</Button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Nom", "Source", "Créé le", "Statut", "Actions"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {templates.map((t: any) => (
                <tr key={t.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t.data_source}</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(t.created_at).toLocaleDateString("fr-FR")}</td>
                  <td className="px-3 py-2"><StatusBadge status={t.status === "active" ? "success" : "info"} label={t.status} /></td>
                  <td className="px-3 py-2 flex gap-1">
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setActiveTab(t.data_source)}><Eye className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={() => deleteTemplate.mutate(t.id)}><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-6">Aucun modèle</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
