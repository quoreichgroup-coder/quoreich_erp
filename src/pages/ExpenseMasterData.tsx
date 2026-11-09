import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tag, Car, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMyExpenseRoles } from "@/hooks/use-expense-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/expense-roles";

const fmt = (n: number) => n.toLocaleString("fr-FR");

const categories = [
  { id: "CAT-01", name: "Travel — Flights", glAccount: "6100", maxPerTrip: 2000000, requiresReceipt: true, active: true },
  { id: "CAT-02", name: "Travel — Hotels", glAccount: "6100", maxPerTrip: 500000, requiresReceipt: true, active: true },
  { id: "CAT-03", name: "Meals — Client", glAccount: "6150", maxPerMeal: 75000, requiresReceipt: true, active: true },
  { id: "CAT-04", name: "Meals — Team", glAccount: "6150", maxPerMeal: 50000, requiresReceipt: true, active: true },
  { id: "CAT-05", name: "Transport — Taxi", glAccount: "6120", maxPerTrip: 25000, requiresReceipt: false, active: true },
  { id: "CAT-06", name: "Office Supplies", glAccount: "6200", maxPerTrip: 200000, requiresReceipt: true, active: true },
  { id: "CAT-07", name: "Training & Certifications", glAccount: "6300", maxPerTrip: 1500000, requiresReceipt: true, active: true },
];

const perDiemRates = [
  { destination: "Abidjan (local)", rate: 25000, currency: "XOF", meals: 15000, transport: 10000 },
  { destination: "Dakar", rate: 75000, currency: "XOF", meals: 35000, transport: 15000 },
  { destination: "Paris", rate: 150000, currency: "XOF", meals: 65000, transport: 25000 },
  { destination: "Lagos", rate: 85000, currency: "XOF", meals: 40000, transport: 20000 },
];

const policyRules = [
  { rule: "Receipt required for amounts > 10,000 XOF", category: "All", action: "Block if missing", severity: "Critical" },
  { rule: "Manager approval required for expenses > 100,000 XOF", category: "All", action: "Route to manager", severity: "Warning" },
  { rule: "Travel expenses require pre-approval", category: "Travel", action: "Block if no pre-approval", severity: "Critical" },
  { rule: "Meal expenses max 4 per week", category: "Meals", action: "Flag excess", severity: "Warning" },
  { rule: "Training budget per employee: 3M XOF/year", category: "Training", action: "Alert if exceeded", severity: "Info" },
];

export default function ExpenseMasterData() {
  const perms = useMyExpenseRoles();
  const canManage = canDo(perms, "manage_settings");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses", href: "/expenses" }, { label: "Master Data" }]} />
      <GuidanceBanner title="Expense Master Data" description="Expense categories, per diem rates, mileage rates, and policy rules configuration." />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Expense Master Data</h1>
        <Button size="sm" disabled={!canManage}
          aria-label={actionTooltip(perms, "manage_settings", "Configurer")}
          title={actionTooltip(perms, "manage_settings", "Configurer")}>
          {canManage ? null : <Lock className="w-3.5 h-3.5 mr-1.5" />}Configurer
        </Button>
      </div>

      <Tabs defaultValue="categories">
        <TabsList className="mb-4">
          <TabsTrigger value="categories" className="gap-1.5"><Tag className="w-3.5 h-3.5" />Categories</TabsTrigger>
          <TabsTrigger value="perdiem" className="gap-1.5"><Car className="w-3.5 h-3.5" />Per Diem Rates</TabsTrigger>
          <TabsTrigger value="policies" className="gap-1.5"><FileText className="w-3.5 h-3.5" />Policy Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="categories">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              {["ID", "Category", "GL Account", "Max Amount", "Receipt Required", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </TableRow></TableHeader>
            <TableBody>{categories.map(c => (
              <TableRow key={c.id} className="text-xs">
                <TableCell className="font-mono text-primary">{c.id}</TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{c.glAccount}</TableCell>
                <TableCell className="text-right font-mono">{maskAmount(perms, c.maxPerTrip || c.maxPerMeal)}</TableCell>
                <TableCell>{c.requiresReceipt ? <span className="text-success font-medium">Yes</span> : <span className="text-muted-foreground">No</span>}</TableCell>
                <TableCell><Badge className="text-[10px] bg-success/15 text-success border-success/20" variant="outline">Active</Badge></TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="perdiem">
          <Card className="border-border"><CardContent className="p-0">
            <Table><TableHeader><TableRow className="bg-muted/30">
              {["Destination", "Daily Rate (XOF)", "Meals Allowance", "Transport Allowance"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </TableRow></TableHeader>
            <TableBody>{perDiemRates.map(p => (
              <TableRow key={p.destination} className="text-xs">
                <TableCell className="font-medium">{p.destination}</TableCell>
                <TableCell className="text-right font-mono font-medium">{fmt(p.rate)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{fmt(p.meals)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{fmt(p.transport)}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="policies">
          <Card className="border-border"><CardContent className="p-4 space-y-2.5">
            {policyRules.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border text-xs">
                <Badge variant={r.severity === "Critical" ? "destructive" : r.severity === "Warning" ? "secondary" : "outline"} className="text-[10px]">{r.severity}</Badge>
                <div className="flex-1">
                  <div className="font-medium">{r.rule}</div>
                  <div className="text-[10px] text-muted-foreground">Category: {r.category} · Action: {r.action}</div>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
