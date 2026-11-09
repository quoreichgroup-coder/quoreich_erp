import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Blocks, Search, ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
  Clock, Key, Users, Activity, ArrowRight, BookOpen,
  ArrowDownLeft, ArrowUpRight, Wallet, Landmark, BarChart3, Settings,
  Target, Shield, FolderKanban, ShoppingCart, RefreshCw, FileText,
  Building2, Play, Zap, Bell, ChevronRight, GitBranch
} from "lucide-react";
import {
  type ModuleName, type ModuleStatus, type License,
  MODULE_METADATA, MODULE_DEPENDENCIES,
  checkLicense, checkDependencies, checkRemovalDependencies,
  getExpiringLicenses,
} from "@/lib/module-manager";
import { useLicenses, useTenantModules, useActivateModule, useDeactivateModule, toLicense, toModuleState } from "@/hooks/use-license-data";
import { useWorkflowRules, simulateWorkflowRules, type WorkflowRuleRow } from "@/hooks/use-workflow-data";
import { useERPAlerts, type ERPAlertRow } from "@/hooks/use-alerts-data";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen, ArrowDownLeft, ArrowUpRight, Wallet, Landmark,
  BarChart3, Settings, Target, Shield, FolderKanban, AlertTriangle, ShoppingCart,
};
function getIcon(iconName: string) { return ICON_MAP[iconName] || Blocks; }

function statusBadge(status: ModuleStatus) {
  switch (status) {
    case "active": return <Badge className="bg-success/15 text-success border-success/20 text-[10px]">Active</Badge>;
    case "inactive": return <Badge variant="secondary" className="text-[10px]">Inactive</Badge>;
    case "license_expired": return <Badge variant="destructive" className="text-[10px]">Expired</Badge>;
    case "pending_approval": return <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Pending</Badge>;
  }
}

function planBadge(plan: string) {
  switch (plan) {
    case "Enterprise": return <Badge className="bg-primary/15 text-primary border-primary/20 text-[10px]">{plan}</Badge>;
    case "Professional": return <Badge variant="secondary" className="text-[10px]">{plan}</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">{plan}</Badge>;
  }
}

function alertSeverityBadge(severity: string) {
  switch (severity) {
    case "critical": return <Badge variant="destructive" className="text-[10px]">Critique</Badge>;
    case "warning": return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/20 text-[10px]">Avertissement</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">Info</Badge>;
  }
}

export default function ModuleManagement() {
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; action: "activate" | "deactivate"; module: ModuleName | null }>({ open: false, action: "activate", module: null });

  const { user } = useAuth();
  const { data: tenantId } = useTenantId();

  // Live DB data
  const { data: dbLicenses = [] } = useLicenses();
  const { data: dbTenantModules = [] } = useTenantModules();
  const { data: dbWorkflowRules = [] } = useWorkflowRules();
  const { data: dbAlerts = [] } = useERPAlerts();
  const activateModuleMut = useActivateModule();
  const deactivateModuleMut = useDeactivateModule();

  // Tenant info
  const { data: tenant } = useQuery({
    queryKey: ["tenant-info", tenantId],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("name, currency").eq("id", tenantId!).single();
      return data;
    },
    enabled: !!tenantId,
  });

  const tenantName = tenant?.name || "Mon entreprise";
  const tenantCurrency = tenant?.currency || "XOF";

  // Convert DB data to domain types
  const licenses: License[] = useMemo(() => dbLicenses.map(toLicense), [dbLicenses]);

  const moduleStates = useMemo(() => {
    return dbTenantModules.map(toModuleState);
  }, [dbTenantModules]);

  // Workflow simulation state
  const [simModule, setSimModule] = useState<ModuleName>("AP");
  const [simAmount, setSimAmount] = useState("5000000");
  const [simCurrency, setSimCurrency] = useState("XOF");
  const [simDept, setSimDept] = useState("");
  const [simResult, setSimResult] = useState<any>(null);

  const allModules: ModuleName[] = Object.keys(MODULE_METADATA) as ModuleName[];
  const activeModules = moduleStates.filter(m => m.status === "active").map(m => m.moduleName);
  const expiringLicenses = getExpiringLicenses(licenses, 30);

  const filteredModules = useMemo(() => {
    return allModules.filter(mod => {
      const meta = MODULE_METADATA[mod];
      const state = moduleStates.find(m => m.moduleName === mod);
      const matchSearch = !search || meta.label.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || (state?.status || "inactive") === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [search, statusFilter, moduleStates]);

  const handleToggle = (mod: ModuleName) => {
    const state = moduleStates.find(m => m.moduleName === mod);
    const isActive = state?.status === "active";
    setConfirmDialog({ open: true, action: isActive ? "deactivate" : "activate", module: mod });
  };

  const confirmAction = () => {
    if (!confirmDialog.module) return;
    const mod = confirmDialog.module;
    if (confirmDialog.action === "activate") {
      // Check dependencies first
      const depCheck = checkDependencies(mod, activeModules);
      if (!depCheck.satisfied) {
        toast.error(`Dépendances manquantes : ${depCheck.missing.join(", ")}`);
        setConfirmDialog({ open: false, action: "activate", module: null });
        return;
      }
      // Check license
      const licCheck = checkLicense(tenantId || "", mod, licenses);
      const license = licenses.find(l => l.moduleName === mod && l.isActive);
      activateModuleMut.mutate(
        { moduleName: mod, licenseId: license?.id },
        {
          onSuccess: () => toast.success(`Module ${MODULE_METADATA[mod].label} activé`),
          onError: (err) => toast.error(`Erreur: ${err.message}`),
        }
      );
    } else {
      // Check removal dependencies
      const remCheck = checkRemovalDependencies(mod, activeModules);
      if (!remCheck.canRemove) {
        toast.error(`Impossible : ${remCheck.dependents.join(", ")} dépendent de ${mod}`);
        setConfirmDialog({ open: false, action: "activate", module: null });
        return;
      }
      deactivateModuleMut.mutate(
        { moduleName: mod },
        {
          onSuccess: () => toast.success(`Module ${MODULE_METADATA[mod].label} désactivé`),
          onError: (err) => toast.error(`Erreur: ${err.message}`),
        }
      );
    }
    setConfirmDialog({ open: false, action: "activate", module: null });
  };

  const runSimulation = () => {
    if (dbWorkflowRules.length > 0) {
      const result = simulateWorkflowRules(dbWorkflowRules, {
        module: simModule,
        amount: parseFloat(simAmount) || 0,
        currency: simCurrency,
        department: simDept || undefined,
      });
      setSimResult(result);
    } else {
      setSimResult({ matchedRules: [], requiredApprovers: [], estimatedSLA: 0, escalationRisk: false });
      toast.info("Aucune règle de workflow configurée.");
    }
  };

  // License table
  const licenseTable = useTableFeatures({
    data: licenses,
    pageSize: 10,
    searchableKeys: ["moduleName", "id"],
    filterConfigs: [
      { key: "plan", label: "Plan", options: ["Enterprise", "Professional", "Starter"] },
      { key: "licenseType", label: "Type", options: ["per-module", "per-user", "per-seat"] },
    ],
  });

  // Alerts table
  const alertsForTable = useMemo(() => dbAlerts.map(a => ({
    id: a.id,
    module: a.module as ModuleName,
    severity: a.severity,
    title: a.title,
    message: a.message,
    timestamp: a.created_at,
    actionRequired: a.action_required,
  })), [dbAlerts]);

  const alertsTable = useTableFeatures({
    data: alertsForTable,
    pageSize: 10,
    searchableKeys: ["title", "message"],
    filterConfigs: [
      { key: "severity", label: "Sévérité", options: ["critical", "warning", "info"] },
    ],
  });

  // Workflow rules table
  const workflowTable = useTableFeatures({
    data: dbWorkflowRules,
    pageSize: 10,
    searchableKeys: ["name", "module"],
  });

  const kpis = {
    total: allModules.length,
    active: activeModules.length,
    licensesActive: licenses.filter(l => l.isActive).length,
    alerts: dbAlerts.filter(a => a.severity === "critical").length,
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Administration" }, { label: "Module Management", href: "/admin/modules" }]} />
      <GuidanceBanner title="Module & License Management" description="Manage ERP modules, licenses, workflows, and cross-module alerts." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Module Management</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted rounded-md">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{tenantName}</span>
            <Badge variant="outline" className="text-[9px] h-4">{tenantCurrency}</Badge>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Refresh</Button>
          <Button size="sm" variant="outline" className="gap-1.5"><FileText className="w-3.5 h-3.5" />Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Blocks className="w-3.5 h-3.5" />Modules</div>
          <div className="text-xl font-bold text-foreground">{kpis.active}/{kpis.total}</div>
          <Progress value={(kpis.active / kpis.total) * 100} className="mt-2 h-1.5" />
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Key className="w-3.5 h-3.5" />Licences actives</div>
          <div className="text-xl font-bold text-foreground">{kpis.licensesActive}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{expiringLicenses.length} expirent bientôt</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><GitBranch className="w-3.5 h-3.5" />Règles Workflow</div>
          <div className="text-xl font-bold text-foreground">{dbWorkflowRules.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{dbWorkflowRules.filter(w => w.is_active).length} actives</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Bell className="w-3.5 h-3.5" />Alertes</div>
          <div className="text-xl font-bold text-foreground">{dbAlerts.length}</div>
          {kpis.alerts > 0 && <div className="text-[11px] text-destructive mt-1">{kpis.alerts} critique(s)</div>}
        </CardContent></Card>
      </div>

      {/* Alerts Banner */}
      {dbAlerts.filter(a => a.severity === "critical").length > 0 && (
        <div className="mb-4 space-y-1.5">
          {dbAlerts.filter(a => a.severity === "critical").slice(0, 3).map(alert => (
            <div key={alert.id} className="flex items-center gap-2 p-2.5 bg-destructive/10 border border-destructive/20 rounded-lg text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
              <span className="flex-1"><strong>{alert.title}</strong> — {alert.message}</span>
              <Badge variant="outline" className="text-[9px]">{MODULE_METADATA[alert.module as ModuleName]?.label || alert.module}</Badge>
            </div>
          ))}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="modules" className="gap-1.5"><Blocks className="w-3.5 h-3.5" />Modules</TabsTrigger>
          <TabsTrigger value="licenses" className="gap-1.5"><Key className="w-3.5 h-3.5" />Licences</TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1.5"><GitBranch className="w-3.5 h-3.5" />Workflows</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5"><Bell className="w-3.5 h-3.5" />Alertes</TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW TAB ─── */}
        <TabsContent value="overview">
          <div className="grid grid-cols-3 gap-4">
            <Card className="col-span-2 border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">État des modules</CardTitle></CardHeader>
              <CardContent className="p-4 pt-2 space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{tenantName}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                  <span><CheckCircle2 className="w-3 h-3 inline mr-0.5" />{activeModules.length} modules actifs</span>
                  <span><Key className="w-3 h-3 inline mr-0.5" />{kpis.licensesActive} licences</span>
                  {kpis.alerts > 0 && <span className="text-destructive"><AlertTriangle className="w-3 h-3 inline mr-0.5" />{kpis.alerts} alertes critiques</span>}
                </div>
                <Progress value={(activeModules.length / allModules.length) * 100} className="h-1.5" />
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {allModules.map(mod => {
                    const isActive = activeModules.includes(mod);
                    const Icon = getIcon(MODULE_METADATA[mod].icon);
                    return (
                      <div key={mod} className={`flex items-center gap-2 p-2 rounded text-xs ${isActive ? "bg-primary/5 text-foreground" : "bg-muted/30 text-muted-foreground"}`}>
                        <Icon className="w-3.5 h-3.5" />
                        <span className={isActive ? "font-medium" : ""}>{MODULE_METADATA[mod].label}</span>
                        {isActive && <CheckCircle2 className="w-3 h-3 text-success ml-auto" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Module Dependencies */}
            <Card className="border-border">
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Dépendances</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-1.5">
                {allModules.filter(m => MODULE_DEPENDENCIES[m].length > 0).map(mod => {
                  const deps = MODULE_DEPENDENCIES[mod];
                  const isActive = activeModules.includes(mod);
                  return (
                    <div key={mod} className="flex items-center gap-2 text-xs py-1">
                      <span className={`font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {MODULE_METADATA[mod].label}
                      </span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                      {deps.map(d => (
                        <Badge key={d} variant={activeModules.includes(d) ? "default" : "destructive"} className="text-[9px] h-4">
                          {d}
                        </Badge>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── MODULES TAB ─── */}
        <TabsContent value="modules">
          <div className="flex gap-4">
            <div className="w-56 shrink-0 space-y-3">
              <Card className="border-border">
                <CardHeader className="p-3 pb-2"><CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtres</CardTitle></CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      <SelectItem value="active">Actif</SelectItem>
                      <SelectItem value="inactive">Inactif</SelectItem>
                      <SelectItem value="license_expired">Expiré</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              {filteredModules.map(mod => {
                const meta = MODULE_METADATA[mod];
                const state = moduleStates.find(m => m.moduleName === mod);
                const status = state?.status || "inactive";
                const isActive = status === "active";
                const Icon = getIcon(meta.icon);
                const deps = MODULE_DEPENDENCIES[mod];
                const licCheck = checkLicense(tenantId || "", mod, licenses);

                return (
                  <Card key={mod} className={`border-border transition-all ${isActive ? "ring-1 ring-success/20" : ""}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? "bg-primary/10" : "bg-muted"}`}>
                            <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-foreground">{meta.label}</div>
                            <div className="text-[11px] text-muted-foreground">{mod}</div>
                          </div>
                        </div>
                        <Switch checked={isActive} onCheckedChange={() => handleToggle(mod)} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">{meta.description}</p>
                      <div className="flex items-center justify-between">
                        {statusBadge(status)}
                        {deps.length > 0 && <div className="text-[10px] text-muted-foreground">Requires: {deps.join(", ")}</div>}
                      </div>
                      {licCheck.daysRemaining !== undefined && licCheck.daysRemaining <= 30 && licCheck.daysRemaining > 0 && (
                        <div className="mt-2 text-[10px] text-amber-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />Licence expire dans {licCheck.daysRemaining}j
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ─── LICENSES TAB ─── */}
        <TabsContent value="licenses">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={licenseTable.search} onSearch={licenseTable.setSearch} filters={licenseTable.filters} onFilter={licenseTable.setFilter} onClear={licenseTable.clearFilters} filterConfigs={licenseTable.filterConfigs} activeCount={licenseTable.activeFilterCount} searchPlaceholder="Rechercher une licence…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="ID" sortKey="id" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Module" sortKey="moduleName" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Plan" sortKey="plan" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Type" sortKey="licenseType" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Début" sortKey="startDate" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Fin" sortKey="endDate" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Utilisateurs" sortKey="activeUsers" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                  <SortableHead label="Statut" sortKey="isActive" sort={licenseTable.sort} onSort={licenseTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenseTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">Aucune licence configurée.</TableCell></TableRow>
                ) : licenseTable.pagedData.map(lic => {
                  const check = checkLicense(tenantId || "", lic.moduleName, licenses);
                  const end = new Date(lic.endDate);
                  const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <TableRow key={lic.id} className="text-xs">
                      <TableCell className="font-mono text-primary">{lic.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-medium">{MODULE_METADATA[lic.moduleName]?.label || lic.moduleName}</TableCell>
                      <TableCell>{planBadge(lic.plan)}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{lic.licenseType}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{lic.startDate}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{lic.endDate}</TableCell>
                      <TableCell>
                        {lic.maxUsers ? (
                          <div className="flex items-center gap-1.5"><Users className="w-3 h-3 text-muted-foreground" />{lic.activeUsers || 0}/{lic.maxUsers}</div>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {check.valid ? <Badge className="bg-success/15 text-success border-success/20 text-[10px]">Valide</Badge> : <Badge variant="destructive" className="text-[10px]">Invalide</Badge>}
                          <span className={`font-mono text-[10px] ${daysLeft <= 7 ? "text-destructive" : daysLeft <= 30 ? "text-amber-600" : "text-muted-foreground"}`}>
                            {daysLeft > 0 ? `${daysLeft}j` : "expiré"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={licenseTable.page} totalPages={licenseTable.totalPages} totalItems={licenseTable.totalItems} pageSize={licenseTable.pageSize} onPageChange={licenseTable.setPage} />
          </CardContent></Card>
        </TabsContent>

        {/* ─── WORKFLOWS TAB ─── */}
        <TabsContent value="workflows">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Card className="border-border"><CardContent className="p-0">
                <FilterBar search={workflowTable.search} onSearch={workflowTable.setSearch} filters={workflowTable.filters} onFilter={workflowTable.setFilter} onClear={workflowTable.clearFilters} filterConfigs={[]} activeCount={workflowTable.activeFilterCount} searchPlaceholder="Rechercher un workflow…" />
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <SortableHead label="ID" sortKey="id" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="Nom" sortKey="name" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="Module" sortKey="module" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="Conditions" sortKey="combinator" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="Approbateurs" sortKey="approvers" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="SLA" sortKey="slaHours" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                      <SortableHead label="Statut" sortKey="isActive" sort={workflowTable.sort} onSort={workflowTable.toggleSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workflowTable.pagedData.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">Aucune règle de workflow configurée.</TableCell></TableRow>
                    ) : workflowTable.pagedData.map(wf => (
                      <TableRow key={wf.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{wf.id.slice(0, 8)}</TableCell>
                        <TableCell className="font-medium">{wf.name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{wf.module}</Badge></TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            {(wf.conditions as any[]).map((c: any, i: number) => (
                              <div key={i} className="text-[10px] text-muted-foreground font-mono">
                                {c.field} {c.operator} {String(c.value)}
                                {i < (wf.conditions as any[]).length - 1 && <Badge variant="secondary" className="text-[8px] ml-1 h-3">{wf.combinator}</Badge>}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            {(wf.approvers as any[]).map((a: any, i: number) => (
                              <div key={i} className="text-[10px]">
                                <span className="text-muted-foreground">{a.role}:</span> {a.name}
                                {a.substitute && <span className="text-amber-600 ml-1">(→ {a.substitute.name})</span>}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{wf.sla_hours}h</TableCell>
                        <TableCell>{wf.is_active ? <Badge className="bg-success/15 text-success border-success/20 text-[10px]">Actif</Badge> : <Badge variant="secondary" className="text-[10px]">Inactif</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationBar page={workflowTable.page} totalPages={workflowTable.totalPages} totalItems={workflowTable.totalItems} pageSize={workflowTable.pageSize} onPageChange={workflowTable.setPage} />
              </CardContent></Card>
            </div>

            {/* Simulation Panel */}
            <Card className="border-border">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><Play className="w-4 h-4" />Simulation (Dry-Run)</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-3">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Module</label>
                  <Select value={simModule} onValueChange={v => setSimModule(v as ModuleName)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(activeModules.length > 0 ? activeModules : allModules).map(m => <SelectItem key={m} value={m}>{MODULE_METADATA[m].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Montant</label>
                  <Input value={simAmount} onChange={e => setSimAmount(e.target.value)} className="h-8 text-xs mt-1" placeholder="5000000" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Devise</label>
                    <Input value={simCurrency} onChange={e => setSimCurrency(e.target.value)} className="h-8 text-xs mt-1" placeholder="XOF" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Département</label>
                    <Input value={simDept} onChange={e => setSimDept(e.target.value)} className="h-8 text-xs mt-1" placeholder="IT" />
                  </div>
                </div>
                <Button size="sm" className="w-full gap-1.5" onClick={runSimulation}>
                  <Zap className="w-3.5 h-3.5" />Simuler
                </Button>

                {simResult && (
                  <div className="mt-3 space-y-2">
                    <Separator />
                    <div className="text-xs font-medium">Résultat</div>
                    <div className="text-[11px] space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Règles matchées:</span>
                        <Badge variant={simResult.matchedRules.length > 0 ? "default" : "secondary"} className="text-[10px]">{simResult.matchedRules.length}</Badge>
                      </div>
                      {simResult.requiredApprovers.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Approbateurs requis:</span>
                          <div className="mt-1 space-y-0.5">
                            {simResult.requiredApprovers.map((a: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px] p-1.5 bg-muted/50 rounded">
                                <CheckCircle2 className="w-3 h-3 text-success" />
                                <span>{a.role}: <strong>{a.name}</strong></span>
                                {a.substitute && <span className="text-amber-600">(→ {a.substitute.name})</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">SLA estimé:</span>
                        <span className="font-mono font-medium">{simResult.estimatedSLA}h</span>
                      </div>
                      {simResult.escalationRisk && (
                        <div className="flex items-center gap-1 text-amber-600 text-[10px]">
                          <AlertTriangle className="w-3 h-3" />Risque d'escalade si SLA dépassé
                        </div>
                      )}
                      {simResult.matchedRules.length === 0 && (
                        <div className="text-success text-[10px] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />Aucune approbation requise — traitement automatique
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── ALERTS TAB ─── */}
        <TabsContent value="alerts">
          <Card className="border-border"><CardContent className="p-0">
            <FilterBar search={alertsTable.search} onSearch={alertsTable.setSearch} filters={alertsTable.filters} onFilter={alertsTable.setFilter} onClear={alertsTable.clearFilters} filterConfigs={alertsTable.filterConfigs} activeCount={alertsTable.activeFilterCount} searchPlaceholder="Rechercher une alerte…" />
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SortableHead label="Module" sortKey="module" sort={alertsTable.sort} onSort={alertsTable.toggleSort} />
                  <SortableHead label="Sévérité" sortKey="severity" sort={alertsTable.sort} onSort={alertsTable.toggleSort} />
                  <SortableHead label="Titre" sortKey="title" sort={alertsTable.sort} onSort={alertsTable.toggleSort} />
                  <SortableHead label="Message" sortKey="message" sort={alertsTable.sort} onSort={alertsTable.toggleSort} />
                  <SortableHead label="Date" sortKey="timestamp" sort={alertsTable.sort} onSort={alertsTable.toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertsTable.pagedData.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">Aucune alerte active.</TableCell></TableRow>
                ) : alertsTable.pagedData.map(alert => (
                  <TableRow key={alert.id} className="text-xs">
                    <TableCell><Badge variant="outline" className="text-[10px]">{MODULE_METADATA[alert.module as ModuleName]?.label || alert.module}</Badge></TableCell>
                    <TableCell>{alertSeverityBadge(alert.severity)}</TableCell>
                    <TableCell className="font-medium">{alert.title}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">{alert.message}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{new Date(alert.timestamp).toLocaleDateString("fr-FR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={alertsTable.page} totalPages={alertsTable.totalPages} totalItems={alertsTable.totalItems} pageSize={alertsTable.pageSize} onPageChange={alertsTable.setPage} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={open => !open && setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {confirmDialog.action === "activate" ? "Activer" : "Désactiver"} le module
            </DialogTitle>
            <DialogDescription className="text-xs">
              {confirmDialog.module && (
                <>
                  Voulez-vous {confirmDialog.action === "activate" ? "activer" : "désactiver"}{" "}
                  <strong>{MODULE_METADATA[confirmDialog.module].label}</strong> pour{" "}
                  <strong>{tenantName}</strong> ?
                  {confirmDialog.action === "activate" && MODULE_DEPENDENCIES[confirmDialog.module].length > 0 && (
                    <div className="mt-2 text-[11px]">
                      Dépendances requises : {MODULE_DEPENDENCIES[confirmDialog.module].join(", ")}
                    </div>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>Annuler</Button>
            <Button size="sm" variant={confirmDialog.action === "deactivate" ? "destructive" : "default"} onClick={confirmAction}>
              {confirmDialog.action === "activate" ? "Activer" : "Désactiver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
