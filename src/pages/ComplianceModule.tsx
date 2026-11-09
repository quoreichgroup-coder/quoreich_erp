import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertTriangle, FileText, Clock, Download, Plus, Lock } from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useComplianceFrameworks, useComplianceControls, useComplianceTestLogs, useMyComplianceRoles } from "@/hooks/use-compliance-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/compliance-roles";

export default function ComplianceModule() {
  const { data: frameworks = [], isLoading: loadingFw } = useComplianceFrameworks();
  const { data: controls = [], isLoading: loadingCtl } = useComplianceControls();
  const { data: testLogs = [] } = useComplianceTestLogs();
  const perms = useMyComplianceRoles();
  const canCreate = canDo(perms, "create_control");
  const canExport = canDo(perms, "export");

  const isLoading = loadingFw || loadingCtl;

  const effective = controls.filter((c: any) => c.status === "compliant").length;
  const total = controls.length;
  const nonCompliant = controls.filter((c: any) => c.status === "non_compliant").length;
  const notTested = controls.filter((c: any) => c.status === "not_tested").length;

  // Map controls for table with framework name
  const controlRows = useMemo(() => controls.map((c: any) => ({
    id: c.control_code,
    name: c.title,
    framework: c.framework?.name || "—",
    category: c.category || "—",
    status: c.status,
    lastTest: c.last_tested_at ? new Date(c.last_tested_at).toLocaleDateString("fr-FR") : "—",
    owner: c.owner || "—",
    riskLevel: c.risk_level || "medium",
  })), [controls]);

  const controlsTable = useTableFeatures({
    data: controlRows,
    pageSize: 10,
    searchableKeys: ["name", "id", "owner"],
    filterConfigs: [
      { key: "framework", label: "Framework", options: [...new Set(controlRows.map(c => c.framework))] },
      { key: "status", label: "Status", options: ["compliant", "non_compliant", "not_tested", "needs_review"] },
    ],
  });

  const testLogRows = useMemo(() => testLogs.map((t: any) => ({
    id: t.id.slice(0, 8),
    control: (t.control as any)?.control_code || "—",
    controlTitle: (t.control as any)?.title || "—",
    framework: (t.control as any)?.framework?.name || "—",
    result: t.result,
    tester: t.tester,
    testDate: t.test_date,
    findings: t.findings,
    notes: t.notes || "—",
  })), [testLogs]);

  const logsTable = useTableFeatures({
    data: testLogRows,
    pageSize: 10,
    searchableKeys: ["control", "controlTitle", "tester"],
    filterConfigs: [
      { key: "result", label: "Result", options: [...new Set(testLogRows.map(t => t.result))] },
    ],
  });

  if (isLoading) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance" }]} />
        <div className="grid grid-cols-4 gap-3 mb-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Compliance", href: "/compliance" }]} />
      <GuidanceBanner title="Compliance & Internal Controls" description="Monitor SOX/IFRS compliance, internal controls effectiveness, and test logs." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Compliance</h1>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={!canCreate} aria-label={actionTooltip(perms, "create_control", "Créer un contrôle")} title={actionTooltip(perms, "create_control", "Créer un contrôle")}>
            {canCreate ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}New Control
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!canExport} aria-label={actionTooltip(perms, "export", "Exporter")} title={actionTooltip(perms, "export", "Exporter")}>
            {canExport ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}Export Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Shield className="w-3.5 h-3.5" />Control Effectiveness</div>
          <div className="text-xl font-bold text-foreground">{total > 0 ? Math.round((effective / total) * 100) : 0}%</div>
          <Progress value={total > 0 ? (effective / total) * 100 : 0} className="mt-2 h-1.5" />
          <div className="text-[11px] text-muted-foreground mt-1">{effective}/{total} compliant</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Non-Compliant</div>
          <div className={`text-xl font-bold ${nonCompliant > 0 ? "text-destructive" : "text-foreground"}`}>{nonCompliant}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{notTested} not tested</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><FileText className="w-3.5 h-3.5" />Frameworks</div>
          <div className="text-xl font-bold text-foreground">{frameworks.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{frameworks.map((f: any) => f.name).join(", ") || "None"}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Clock className="w-3.5 h-3.5" />Test Logs</div>
          <div className="text-xl font-bold text-foreground">{testLogs.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">total tests recorded</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="controls">
        <TabsList className="mb-4">
          <TabsTrigger value="controls" className="gap-1.5"><Shield className="w-3.5 h-3.5" />Internal Controls</TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><FileText className="w-3.5 h-3.5" />Test Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="controls">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={controlsTable.search} onSearch={controlsTable.setSearch} filters={controlsTable.filters} onFilter={controlsTable.setFilter} onClear={controlsTable.clearFilters} filterConfigs={controlsTable.filterConfigs} activeCount={controlsTable.activeFilterCount} searchPlaceholder="Rechercher un contrôle…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Code" sortKey="id" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Control Name" sortKey="name" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Framework" sortKey="framework" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Category" sortKey="category" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Status" sortKey="status" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Last Test" sortKey="lastTest" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                  <SortableHead label="Owner" sortKey="owner" sort={controlsTable.sort} onSort={controlsTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {controlsTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No controls. Click "New Control" to start.</TableCell></TableRow>
                ) : controlsTable.pagedData.map((c: any) => (
                  <TableRow key={c.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{c.id}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.framework}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{c.category}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${c.status === "compliant" ? "bg-success/15 text-success border-success/20" : c.status === "non_compliant" ? "bg-destructive/15 text-destructive border-destructive/20" : c.status === "needs_review" ? "bg-amber-500/15 text-amber-700 border-amber-500/20" : ""}`} variant={c.status === "not_tested" ? "secondary" : "outline"}>
                        {c.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">{c.lastTest}</TableCell>
                    <TableCell className="text-muted-foreground">{maskAmount(perms, c.owner)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={controlsTable.page} totalPages={controlsTable.totalPages} totalItems={controlsTable.totalItems} pageSize={controlsTable.pageSize} onPageChange={controlsTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={logsTable.search} onSearch={logsTable.setSearch} filters={logsTable.filters} onFilter={logsTable.setFilter} onClear={logsTable.clearFilters} filterConfigs={logsTable.filterConfigs} activeCount={logsTable.activeFilterCount} searchPlaceholder="Rechercher un test…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Control" sortKey="control" sort={logsTable.sort} onSort={logsTable.toggleSort} />
                  <SortableHead label="Title" sortKey="controlTitle" sort={logsTable.sort} onSort={logsTable.toggleSort} />
                  <SortableHead label="Result" sortKey="result" sort={logsTable.sort} onSort={logsTable.toggleSort} />
                  <SortableHead label="Tester" sortKey="tester" sort={logsTable.sort} onSort={logsTable.toggleSort} />
                  <SortableHead label="Date" sortKey="testDate" sort={logsTable.sort} onSort={logsTable.toggleSort} />
                  <SortableHead label="Findings" sortKey="findings" sort={logsTable.sort} onSort={logsTable.toggleSort} className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No test logs recorded.</TableCell></TableRow>
                ) : logsTable.pagedData.map((t: any) => (
                  <TableRow key={t.id} className="text-xs">
                    <TableCell className="font-mono text-primary">{t.control}</TableCell>
                    <TableCell className="font-medium">{t.controlTitle}</TableCell>
                    <TableCell>
                      <Badge variant={t.result === "pass" ? "default" : t.result === "fail" ? "destructive" : "outline"} className="text-[10px] capitalize">{t.result}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{maskAmount(perms, t.tester)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{t.testDate}</TableCell>
                    <TableCell className="text-right font-mono">{maskAmount(perms, t.findings)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={logsTable.page} totalPages={logsTable.totalPages} totalItems={logsTable.totalItems} pageSize={logsTable.pageSize} onPageChange={logsTable.setPage} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
