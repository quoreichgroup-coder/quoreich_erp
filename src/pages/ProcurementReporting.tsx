import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ExportButtons } from "@/components/ExportButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { deliveryPerformance, engagedOrders, ordersByMonth, spendBy, type ReportGR, type ReportPO } from "@/lib/procurement-reporting";

/*
 * Approvisionnement → Rapports : dépenses engagées (commandes approuvées et suivantes), par fournisseur et
 * par catégorie de fournisseur, commandes par mois, délai de livraison et ponctualité. Toutes les pages
 * de commandes et de réceptions sont lues ; rien n'est inventé (une période sans donnée reste vide).
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const tip = { fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 };

async function allPages<T>(build: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function useProcurementReportData() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["procurement-report", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async () => {
      const db = supabase as any;
      const [pos, grs] = await Promise.all([
        allPages<any>((f) => db.from("purchase_orders").select("id, po_number, order_date, expected_date, total, status, supplier:suppliers(name, category)")
          .eq("tenant_id", tenantId).order("order_date").range(f, f + 999)),
        allPages<ReportGR>((f) => db.from("goods_receipts").select("po_id, receipt_date, status").eq("tenant_id", tenantId).range(f, f + 999)),
      ]);
      return {
        pos: pos.map((p): ReportPO => ({ id: p.id, po_number: p.po_number, order_date: p.order_date, expected_date: p.expected_date, total: Number(p.total ?? 0),
          status: p.status, supplier: p.supplier?.name ?? "", category: p.supplier?.category ?? null })),
        grs,
      };
    },
  });
}

export default function ProcurementReporting() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const q = useProcurementReportData();
  const r = useMemo(() => {
    if (!q.data) return null;
    const engaged = engagedOrders(q.data.pos, year);
    return {
      engaged,
      bySupplier: spendBy(engaged, "supplier"),
      byCategory: spendBy(engaged, "category"),
      byMonth: ordersByMonth(engaged, year).map((m) => ({ ...m, label: MOIS[Number(m.month.slice(5)) - 1] })),
      perf: deliveryPerformance(engaged, q.data.grs),
    };
  }, [q.data, year]);
  const total = r?.engaged.reduce((s, p) => s + p.total, 0) ?? 0;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Approvisionnement", href: "/procurement" }, { label: "Rapports" }]} />
      <GuidanceBanner title="Rapports d'approvisionnement" description="Dépenses engagées par fournisseur et par catégorie, commandes par mois, délai de livraison et ponctualité, calculés sur les commandes et réceptions de la société." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-foreground">Approvisionnement — Rapports</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="proc-year" className="text-xs text-muted-foreground">Exercice</label>
          <Input id="proc-year" className="h-8 w-24 text-xs" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </div>
      </div>

      {q.isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
        : q.isError ? <p className="text-xs text-destructive" role="alert">{(q.error as Error).message}</p>
        : r && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="procurement-report-kpis">
              {[["Dépenses engagées", `${fmt(total)} XOF`], ["Commandes engagées", String(r.engaged.length)],
                ["Délai moyen de livraison", r.perf.averageLead == null ? "—" : `${fmt(r.perf.averageLead)} j`],
                ["Livrées à la date promise", r.perf.onTimeRate == null ? "—" : `${fmt(r.perf.onTimeRate)} %`]].map(([l, v]) => (
                <div key={l} className="bg-card border border-border rounded-lg p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className="text-lg font-semibold">{v}</div></div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-border">
                <CardHeader className="p-4 pb-2 flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Commandes engagées par mois</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={r.byMonth}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(v: number) => `${fmt(v)} XOF`} contentStyle={tip} /><Bar dataKey="amount" name="Montant" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card className="border-border">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Délai moyen de livraison (jours, par mois de réception)</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  {r.perf.byMonth.length === 0 ? <p className="text-xs text-muted-foreground py-10 text-center">Aucune réception validée pour les commandes de l'exercice.</p> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={r.perf.byMonth}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={tip} /><Line type="monotone" dataKey="days" name="Délai (j)" stroke="hsl(var(--chart-2))" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {([["Dépenses par fournisseur", "supplier", r.bySupplier, "Fournisseur"], ["Dépenses par catégorie de fournisseur", "category", r.byCategory, "Catégorie"]] as const).map(([title, key, rows, head]) => (
              <Card key={key} className="border-border">
                <CardHeader className="p-4 pb-2 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm">{title}</CardTitle>
                  <ExportButtons label={title} rows={rows.map((x) => ({ libelle: x.label, commandes: x.orders, montant: x.amount, part: x.pct }))}
                    columns={[{ key: "libelle", header: head }, { key: "commandes", header: "Commandes" }, { key: "montant", header: "Montant engagé" }, { key: "part", header: "Part (%)" }]}
                    filename={`depenses-${key === "supplier" ? "fournisseurs" : "categories"}-${year}`} />
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs" data-testid={`procurement-spend-${key}`}>
                    <thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">{head}</th><th className="text-right">Commandes</th><th className="text-right">Montant engagé</th><th className="text-right pr-3">Part</th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Aucune commande engagée sur l'exercice.</td></tr>}
                      {rows.map((x) => <tr key={x.label} className="border-t border-border/50"><td className="px-3 py-1.5">{x.label}</td><td className="text-right tabular-nums">{x.orders}</td>
                        <td className="text-right tabular-nums">{fmt(x.amount)}</td><td className="text-right tabular-nums pr-3">{fmt(x.pct)} %</td></tr>)}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}

            <Card className="border-border">
              <CardHeader className="p-4 pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Performance de livraison par fournisseur</CardTitle>
                <ExportButtons label="Performance fournisseurs" rows={r.perf.bySupplier.map((x) => ({ fournisseur: x.supplier, receptions: x.received, delai: x.averageLead, ponctualite: x.onTimeRate ?? "" }))}
                  columns={[{ key: "fournisseur", header: "Fournisseur" }, { key: "receptions", header: "Commandes reçues" }, { key: "delai", header: "Délai moyen (j)" }, { key: "ponctualite", header: "À l'heure (%)" }]}
                  filename={`performance-fournisseurs-${year}`} />
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/30 text-muted-foreground"><th className="px-3 py-2 text-left">Fournisseur</th><th className="text-right">Commandes reçues</th><th className="text-right">Délai moyen</th><th className="text-right pr-3">À la date promise</th></tr></thead>
                  <tbody>
                    {r.perf.bySupplier.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Aucune réception validée.</td></tr>}
                    {r.perf.bySupplier.map((x) => <tr key={x.supplier} className="border-t border-border/50"><td className="px-3 py-1.5">{x.supplier}</td><td className="text-right tabular-nums">{x.received}</td>
                      <td className="text-right tabular-nums">{fmt(x.averageLead)} j</td><td className="text-right tabular-nums pr-3">{x.onTimeRate == null ? "date non promise" : `${fmt(x.onTimeRate)} %`}</td></tr>)}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
    </PageShell>
  );
}
