import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingBag, FileText, Truck, CreditCard, TrendingUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuotations, useSalesOrders } from "@/hooks/use-sales-data";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function Sales() {
  const { data: quotes = [], isLoading: lq } = useQuotations();
  const { data: orders = [], isLoading: lo } = useSalesOrders();
  const { data: arInvoices = [], isLoading: li } = useQuery({
    queryKey: ["ar-invoices-for-sales-dash"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ar_invoices").select("total, amount_paid, status, invoice_date, customer:customers(name)").order("invoice_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const isLoading = lq || lo || li;

  const openQuotes = quotes.filter(q => q.status === "draft" || q.status === "sent");
  const pendingOrders = orders.filter(o => o.status === "draft" || o.status === "confirmed");
  const quotePipeline = openQuotes.reduce((s, q) => s + Number(q.total), 0);
  const orderPipeline = pendingOrders.reduce((s, o) => s + Number(o.total), 0);
  const totalRevenue = arInvoices.reduce((s, i: any) => s + Number(i.total), 0);
  const deliveredOrders = orders.filter(o => o.status === "delivered").length;
  const fulfillmentRate = orders.length > 0 ? Math.round((deliveredOrders / orders.length) * 100) : 0;
  const avgOrderValue = orders.length > 0 ? Math.round(orders.reduce((s, o) => s + Number(o.total), 0) / orders.length) : 0;

  const kpis = [
    { label: "Open Quotes", value: String(openQuotes.length), icon: FileText, color: "text-primary", change: `${fmt(quotePipeline)} XOF pipeline` },
    { label: "Pending Orders", value: String(pendingOrders.length), icon: ShoppingBag, color: "text-amber-600", change: `${fmt(orderPipeline)} XOF` },
    { label: "Total Revenue", value: fmt(totalRevenue), sub: "XOF", icon: TrendingUp, color: "text-success", change: `${arInvoices.length} invoices` },
    { label: "Fulfillment Rate", value: `${fulfillmentRate}%`, icon: Truck, color: "text-primary", change: `${deliveredOrders}/${orders.length} delivered` },
    { label: "Avg Order Value", value: fmt(avgOrderValue), sub: "XOF", icon: CreditCard, color: "text-success", change: `${orders.length} orders total` },
    { label: "Total Quotes", value: String(quotes.length), icon: Clock, color: "text-amber-600", change: `${quotes.filter(q => q.status === "accepted" || q.status === "converted").length} accepted` },
  ];

  // Revenue by month from AR invoices
  const revenueByMonth = useMemo(() => {
    const monthMap: Record<string, number> = {};
    for (const inv of arInvoices as any[]) {
      const d = new Date(inv.invoice_date);
      const key = d.toLocaleDateString("en", { month: "short", year: "2-digit" });
      monthMap[key] = (monthMap[key] || 0) + Number(inv.total);
    }
    return Object.entries(monthMap).map(([month, revenue]) => ({ month, revenue: Math.round(revenue / 1000) })).slice(-6);
  }, [arInvoices]);

  // Top customers
  const topCustomers = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number }> = {};
    for (const inv of arInvoices as any[]) {
      const name = inv.customer?.name || "Unknown";
      if (!map[name]) map[name] = { revenue: 0, orders: 0 };
      map[name].revenue += Number(inv.total);
      map[name].orders++;
    }
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d, avgValue: Math.round(d.revenue / d.orders) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [arInvoices]);

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance" }, { label: "Sales" }, { label: "Dashboard" }]} />
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Dashboard" }]} />
      <GuidanceBanner title="Sales Order Management" description="Quote-to-cash pipeline, order tracking, and revenue analytics from live data." />

      <h1 className="text-lg font-semibold text-foreground">Sales Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{k.label}</span>
              <k.icon className={cn("w-3.5 h-3.5", k.color)} />
            </div>
            <div className={cn("text-lg font-semibold tabular-nums", k.color)}>
              {k.value} {k.sub && <span className="text-[10px] font-normal text-muted-foreground">{k.sub}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{k.change}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Revenue Trend (K XOF)</h3>
          <div className="h-52">
            {revenueByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue (K XOF)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No revenue data yet</div>
            )}
          </div>
        </div>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Top Customers by Revenue</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-2.5">
            {topCustomers.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No customer data yet</div>
            ) : topCustomers.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{i + 1}</div>
                <div className="flex-1">
                  <div className="text-xs font-medium">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">{c.orders} invoices · avg {fmt(c.avgValue)} XOF</div>
                </div>
                <span className="text-xs font-mono font-medium">{fmt(c.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
