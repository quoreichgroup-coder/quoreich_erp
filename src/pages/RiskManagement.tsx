import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Shield, Activity, Download, BarChart3, Plus, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useRiskRegister, useRiskKpis, useMyRiskRoles } from "@/hooks/use-risk-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/risk-roles";

export default function RiskManagement() {
  const { risks, open, critical, high, mitigated } = useRiskKpis();
  const { isLoading } = useRiskRegister();
  const perms = useMyRiskRoles();
  const canCreate = canDo(perms, "create_risk");
  const canExport = canDo(perms, "export");

  const avgScore = risks.length > 0 ? Math.round(risks.reduce((s, r) => s + (Number(r.risk_score) || (r.likelihood * r.impact)), 0) / risks.length) : 0;

  // Map risk data for table
  const riskRows = useMemo(() => risks.map(r => ({
    id: r.risk_code,
    name: r.title,
    category: r.category,
    likelihood: r.likelihood,
    impact: r.impact,
    score: Number(r.risk_score) || (r.likelihood * r.impact),
    status: r.status,
    owner: r.owner || "—",
  })), [risks]);

  // Risk by category for chart
  const riskByCategory = useMemo(() => {
    const map = new Map<string, { count: number; totalScore: number }>();
    risks.forEach(r => {
      const score = Number(r.risk_score) || (r.likelihood * r.impact);
      const e = map.get(r.category) || { count: 0, totalScore: 0 };
      e.count++;
      e.totalScore += score;
      map.set(r.category, e);
    });
    return Array.from(map.entries()).map(([category, v]) => ({ category, count: v.count, avgScore: Math.round(v.totalScore / v.count) }));
  }, [risks]);

  // Radar data
  const radarData = useMemo(() => {
    const categories = [...new Set(risks.map(r => r.category))];
    return categories.map(cat => {
      const catRisks = risks.filter(r => r.category === cat);
      const avg = catRisks.length > 0 ? Math.round(catRisks.reduce((s, r) => s + (Number(r.risk_score) || (r.likelihood * r.impact)), 0) / catRisks.length) : 0;
      return { dimension: cat, value: avg };
    });
  }, [risks]);

  const risksTable = useTableFeatures({
    data: riskRows,
    pageSize: 10,
    searchableKeys: ["name", "id", "owner"],
    initialSort: { key: "score", direction: "desc" },
    filterConfigs: [
      { key: "category", label: "Category", options: [...new Set(riskRows.map(r => r.category))] },
      { key: "status", label: "Status", options: [...new Set(riskRows.map(r => r.status))] },
    ],
  });

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management" }]} />
        <div className="grid grid-cols-4 gap-3 mb-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Risk Management", href: "/risk" }]} />
      <GuidanceBanner title="Risk Management" description="Monitor financial and operational risks, track risk scores, and manage mitigation strategies." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Risk Management</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={actionTooltip(perms, "create_risk", "Nouveau risque")} title={actionTooltip(perms, "create_risk", "Nouveau risque")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Risk
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={actionTooltip(perms, "export", "Exporter")} title={actionTooltip(perms, "export", "Exporter")}>
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Activity className="w-3.5 h-3.5" />Overall Risk Score</div>
          <div className={`text-xl font-bold ${avgScore > 15 ? "text-destructive" : avgScore > 9 ? "text-amber-600" : "text-success"}`}>{avgScore}</div>
          <Progress value={Math.min(avgScore * 4, 100)} className="mt-2 h-1.5" />
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Total Risks</div>
          <div className="text-xl font-bold text-foreground">{risks.length}</div>
          <div className="text-[11px] text-destructive mt-1">{critical.length} critical</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Shield className="w-3.5 h-3.5" />Mitigated</div>
          <div className="text-xl font-bold text-foreground">{mitigated}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Open</div>
          <div className={`text-xl font-bold ${open.length > 0 ? "text-destructive" : "text-foreground"}`}>{open.length}</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="register">
        <TabsList className="mb-4">
          <TabsTrigger value="register" className="gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Risk Register</TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Risk Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="register">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={risksTable.search} onSearch={risksTable.setSearch} filters={risksTable.filters} onFilter={risksTable.setFilter} onClear={risksTable.clearFilters} filterConfigs={risksTable.filterConfigs} activeCount={risksTable.activeFilterCount} searchPlaceholder="Rechercher un risque…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Code" sortKey="id" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="Risk" sortKey="name" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="Category" sortKey="category" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="L" sortKey="likelihood" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="I" sortKey="impact" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="Score" sortKey="score" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="Status" sortKey="status" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                  <SortableHead label="Owner" sortKey="owner" sort={risksTable.sort} onSort={risksTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {risksTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No risks registered.</TableCell></TableRow>
                ) : risksTable.pagedData.map((r: any) => (
                  <TableRow key={r.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{r.id}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.category}</Badge></TableCell>
                    <TableCell className="text-center">{r.likelihood}</TableCell>
                    <TableCell className="text-center">{r.impact}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(r.score * 4, 100)} className="h-1.5 w-12" />
                        <span className={`font-mono font-medium ${r.score >= 16 ? "text-destructive" : r.score >= 9 ? "text-amber-600" : "text-success"}`}>{r.score}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${r.status === "open" ? "bg-destructive/15 text-destructive border-destructive/20" : r.status === "mitigated" ? "bg-success/15 text-success border-success/20" : ""}`} variant={r.status === "accepted" ? "secondary" : "outline"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{maskAmount(perms, r.owner)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={risksTable.page} totalPages={risksTable.totalPages} totalItems={risksTable.totalItems} pageSize={risksTable.pageSize} onPageChange={risksTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="analysis">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Risk Radar</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                {radarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Radar name="Risk Score" dataKey="value" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.2} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-12">No data</div>
                )}
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Risk by Category</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                {riskByCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={riskByCategory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      <Bar dataKey="avgScore" name="Avg Score" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="count" name="Count" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-12">No data</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
