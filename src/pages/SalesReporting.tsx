import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Download, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSalesReportingData, useMySalesRoles } from "@/hooks/use-sales-data";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";
import { SALES_ROLE_HINTS } from "@/lib/sales-roles";
import { SalesEmptyState } from "@/components/SalesEmptyState";

const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

const EXPORT_HINT_ID = "sales-reporting-export-hint";

export default function SalesReporting() {
  const { data: perms } = useMySalesRoles();
  const allowed = perms?.isAdmin || (perms?.roles?.length ?? 0) > 0;

  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(ninetyAgo);
  const [to, setTo] = useState(today);

  const {
    isLoading,
    salesByCustomer,
    conversionFunnel,
    monthlyRevenue,
    quotations,
    orders,
    arInvoices,
    backlogOrders,
    backlogValue,
    grossMargin,
    grossMarginPct,
  } = useSalesReportingData({ from, to });

  const hasAnyData =
    quotations.length > 0 || orders.length > 0 || arInvoices.length > 0;


  const totalRevenue = arInvoices.reduce((s, i) => s + Number(i.total), 0);
  const paidRevenue = arInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + Number(i.total), 0);

  if (!allowed) {
    return (
      <PageShell>
        <Breadcrumb
          items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Reporting" }]}
        />
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Accès restreint</p>
              <p className="text-xs text-muted-foreground mt-1">
                Le module Reporting Ventes nécessite un rôle Sales (rep, manager ou controller).
                Demandez à un administrateur de vous l'attribuer dans <strong>Settings → Users</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const handleExport = () => {
    if (!perms?.canExport) {
      toast.error("Export refusé — rôle Manager ou Controller requis");
      return;
    }
    if (salesByCustomer.length === 0) {
      toast.info("Aucune donnée à exporter pour la période");
      return;
    }
    exportToCSV(
      salesByCustomer,
      [
        { key: "customer", header: "Client" },
        { key: "orders", header: "Factures" },
        { key: "revenue", header: "CA (XOF)" },
      ],
      `sales-by-customer-${from}-${to}`
    );
  };


  return (
    <PageShell>
      <Breadcrumb
        items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Reporting" }]}
      />
      <GuidanceBanner
        title="Sales Reporting"
        description="CA par client/période, carnet de commandes, taux de conversion et marge brute — données live."
      />

      {/* Filters + export */}
      <Card className="border-border mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Période — Du</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Au</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 ml-auto"
            onClick={handleExport}
            disabled={!perms?.canExport || isLoading || salesByCustomer.length === 0}
            aria-label={
              !perms?.canExport
                ? `Export CSV désactivé — ${SALES_ROLE_HINTS.export}`
                : "Exporter le CA par client en CSV"
            }
            aria-describedby={!perms?.canExport ? EXPORT_HINT_ID : undefined}
            title={
              !perms?.canExport
                ? SALES_ROLE_HINTS.export
                : salesByCustomer.length === 0
                ? "Aucune donnée à exporter sur la période sélectionnée"
                : "Exporter le CA par client en CSV"
            }
          >
            {perms?.canExport ? (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Export CSV
          </Button>
          {!perms?.canExport && (
            <span id={EXPORT_HINT_ID} className="sr-only">
              {SALES_ROLE_HINTS.export}
            </span>
          )}
        </CardContent>
      </Card>

      <h1 className="text-lg font-semibold text-foreground mb-3">Sales Reports</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !hasAnyData ? (
        <SalesEmptyState
          className="mb-4"
          title="Aucun résultat pour les filtres appliqués"
          filterSummary={`Période ${from} → ${to} · Devis : ${quotations.length} · Commandes : ${orders.length} · Factures : ${arInvoices.length}`}
          hint="Élargissez la période ou créez un devis pour alimenter le reporting."
        />
      ) : null}



      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        {[
          { l: "Devis", v: quotations.length, sub: `${fmt(quotations.reduce((s, q) => s + Number(q.total), 0))} XOF` },
          { l: "Commandes", v: orders.length, sub: `${fmt(orders.reduce((s, o) => s + Number(o.total), 0))} XOF` },
          { l: "CA facturé", v: fmt(totalRevenue), sub: "XOF" },
          { l: "Encaissé", v: fmt(paidRevenue), sub: "XOF" },
          { l: "Carnet cdes", v: backlogOrders.length, sub: `${fmt(backlogValue)} XOF` },
          { l: "Marge brute", v: grossMarginPct === null ? "Coût non renseigné" : `${grossMarginPct.toFixed(1)}%`, sub: grossMargin === null ? "—" : `${fmt(grossMargin)} XOF` },
        ].map((k) => (
          <Card key={k.l} className="border-border">
            <CardContent className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {k.l}
              </p>
              <p className={k.l === "Marge brute" && grossMarginPct === null ? "text-sm font-semibold text-foreground" : "text-lg font-semibold text-foreground tabular-nums"}>{k.v}</p>
              <p className="text-[11px] text-muted-foreground">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Monthly Revenue */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">CA mensuel</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {monthlyRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
                Aucune donnée sur la période
              </div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
                      formatter={(v: number) => `${fmt(v)} XOF`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(220, 50%, 40%)" name="CA" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Customer */}
        <Card className="border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">CA par client (Top 10)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {salesByCustomer.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
                Aucune donnée de vente
              </div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesByCustomer} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                    <YAxis type="category" dataKey="customer" tick={{ fontSize: 10 }} width={100} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
                      formatter={(v: number) => `${fmt(v)} XOF`}
                    />
                    <Bar dataKey="revenue" fill="hsl(220, 50%, 40%)" radius={[0, 4, 4, 0]} name="CA" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      <Card className="border-border mb-4">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Quote-to-Cash — Funnel de conversion</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-2">
          {conversionFunnel.map((stage) => {
            const maxCount = conversionFunnel[0].count || 1;
            const pct = ((stage.count / maxCount) * 100).toFixed(0);
            return (
              <div key={stage.stage} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{stage.stage}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{stage.count}</span>
                    <span className="font-mono text-muted-foreground">{fmt(stage.value)} XOF</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {pct}%
                    </Badge>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Backlog table */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Carnet de commandes ({backlogOrders.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {backlogOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Aucune commande en cours
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["N°", "Date", "Client", "Statut", "Montant (XOF)"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backlogOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-primary">{o.so_number}</td>
                    <td className="px-3 py-2">{o.order_date}</td>
                    <td className="px-3 py-2">{o.customer?.name || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {o.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmt(Number(o.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
