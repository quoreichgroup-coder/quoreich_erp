import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const spendByCategory = [
  { category: "IT Hardware", amount: 214000, pct: 42 },
  { category: "IT Network", amount: 89000, pct: 18 },
  { category: "Telecom", amount: 65000, pct: 13 },
  { category: "Facilities", amount: 40500, pct: 8 },
  { category: "Logistics", amount: 64000, pct: 13 },
  { category: "Other", amount: 32200, pct: 6 },
];

const avgLeadTime = [
  { month: "Jan", days: 18 }, { month: "Feb", days: 15 }, { month: "Mar", days: 22 },
  { month: "Apr", days: 17 }, { month: "May", days: 14 }, { month: "Jun", days: 19 },
];

const topSuppliers = [
  { supplier: "Dell Technologies", value: 250000 },
  { supplier: "Cisco Systems", value: 180000 },
  { supplier: "Orange Business", value: 120000 },
  { supplier: "Total Energies", value: 45000 },
  { supplier: "Société Générale", value: 35000 },
];

const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--muted-foreground))"];
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function ProcurementReporting() {
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Reporting" }]} />
      <GuidanceBanner title="Procurement Reporting" description="Top suppliers, spend by category, average lead times, and export." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Procurement Reporting</h1>
        <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" />Export PDF</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Spend by Category</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={spendByCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" outerRadius={100} label={({ category, pct }) => `${category} (${pct}%)`} labelLine={{ stroke: "hsl(var(--muted-foreground))" }}>
                  {spendByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `${fmt(v)} XOF K`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Average Lead Time (days)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={avgLeadTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Line type="monotone" dataKey="days" name="Lead Time" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--chart-1))" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border lg:col-span-2">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Top Suppliers by Contract Value</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topSuppliers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="supplier" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={130} />
                <Tooltip formatter={(v: number) => `${fmt(v)} XOF K`} contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                <Bar dataKey="value" name="Contract Value" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
