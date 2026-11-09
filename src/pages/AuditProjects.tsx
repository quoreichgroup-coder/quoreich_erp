import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Lock, X, History } from "lucide-react";
import { useProjectRoleAudit, useMyProjectRoles } from "@/hooks/use-project-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import { ROLE_LABELS, canDo, actionTooltip, type ProjectRole } from "@/lib/project-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

const PAGE_SIZE = 25;

export default function AuditProjects() {
  const perms = useMyProjectRoles();
  const canView = canDo(perms, "view_sensitive");
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter l'audit");
  const viewTip = actionTooltip(perms, "view_sensitive", "Consulter l'audit");
  const { data: audit = [], isLoading } = useProjectRoleAudit();
  const { data: users = [] } = useTenantProfiles();

  const [fUser, setFUser] = useState("all");
  const [fActor, setFActor] = useState("all");
  const [fAction, setFAction] = useState("all");
  const [fRole, setFRole] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const fromTs = fFrom ? new Date(fFrom).getTime() : null;
    const toTs = fTo ? new Date(fTo).getTime() + 86_400_000 : null;
    return (audit ?? []).filter((r: any) => {
      if (fUser !== "all" && r.target_user_id !== fUser) return false;
      if (fActor !== "all" && r.actor_user_id !== fActor) return false;
      if (fAction !== "all" && r.action !== fAction) return false;
      if (fRole !== "all" && r.role !== fRole) return false;
      const ts = new Date(r.created_at).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts >= toTs) return false;
      return true;
    });
  }, [audit, fUser, fActor, fAction, fRole, fFrom, fTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const activeCount =
    (fUser !== "all" ? 1 : 0) + (fActor !== "all" ? 1 : 0) +
    (fAction !== "all" ? 1 : 0) + (fRole !== "all" ? 1 : 0) +
    (fFrom ? 1 : 0) + (fTo ? 1 : 0);

  const resetFilters = () => {
    setFUser("all"); setFActor("all"); setFAction("all"); setFRole("all");
    setFFrom(""); setFTo(""); setPage(0);
  };

  const nameOf = (id: string) => users.find((u) => u.id === id)?.full_name || id.slice(0, 8);

  const exportCSV = () => {
    if (!canExport) return;
    exportToCSV(
      filtered.map((r: any) => ({
        date: new Date(r.created_at).toISOString(),
        action: r.action, role: r.role,
        actor: nameOf(r.actor_user_id), target: nameOf(r.target_user_id),
        reason: r.reason ?? "",
      })),
      [
        { key: "date", header: "Date" }, { key: "action", header: "Action" },
        { key: "role", header: "Rôle" }, { key: "actor", header: "Acteur" },
        { key: "target", header: "Utilisateur cible" }, { key: "reason", header: "Motif" },
      ],
      `project-role-audit-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const exportPDF = () => {
    if (!canExport) return;
    exportToPDF({
      filename: `project-role-audit-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Historique — Rôles Projets",
      subtitle: `${filtered.length} ligne(s)`,
      columns: [
        { key: "date", header: "Date", format: (r: any) => new Date(r.created_at).toLocaleString("fr-FR") },
        { key: "action", header: "Action", format: (r: any) => r.action },
        { key: "role", header: "Rôle", format: (r: any) => r.role },
        { key: "actor", header: "Acteur", format: (r: any) => nameOf(r.actor_user_id) },
        { key: "target", header: "Cible", format: (r: any) => nameOf(r.target_user_id) },
        { key: "reason", header: "Motif", format: (r: any) => r.reason ?? "" },
      ],
      rows: filtered as any[],
    });
  };

  if (!canView) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Audit" }, { label: "Rôles Projets" }]} />
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <h2 className="text-base font-semibold mb-1">Accès restreint</h2>
          <p className="text-sm text-muted-foreground">{viewTip}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Audit" }, { label: "Rôles Projets" }]} />
      <GuidanceBanner
        title="Historique des rôles — Comptabilité Projets"
        description="Journal complet des attributions et révocations de rôles project_*, par tenant et utilisateur."
      />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          Historique — Rôles Projets
        </h1>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0}
            aria-label={exportTip} title={exportTip}
            onClick={exportCSV}
          >
            {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0}
            aria-label={exportTip} title={exportTip}
            onClick={exportPDF}
          >
            {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} PDF
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-3 mb-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Utilisateur cible</Label>
          <Select value={fUser} onValueChange={(v) => { setFUser(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.id.slice(0, 8)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Acteur</Label>
          <Select value={fActor} onValueChange={(v) => { setFActor(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.id.slice(0, 8)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Action</Label>
          <Select value={fAction} onValueChange={(v) => { setFAction(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="grant">Attribution</SelectItem>
              <SelectItem value="revoke">Révocation</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Rôle</Label>
          <Select value={fRole} onValueChange={(v) => { setFRole(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {(Object.keys(ROLE_LABELS) as ProjectRole[]).map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Du</Label>
          <Input type="date" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setPage(0); }} className="h-8 text-xs w-[140px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Au</Label>
          <Input type="date" value={fTo} onChange={(e) => { setFTo(e.target.value); setPage(0); }} className="h-8 text-xs w-[140px]" />
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={resetFilters}>
            <X className="w-3 h-3" /> Effacer ({activeCount})
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filtered.length} / {audit.length} entrée(s)
        </span>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Rôle</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Acteur</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Utilisateur cible</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Motif</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {activeCount > 0 ? "Aucune entrée ne correspond aux filtres" : "Aucune action enregistrée"}
                </td></tr>
              )}
              {pageRows.map((row: any) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.action === "grant" ? "default" : "destructive"} className="text-[10px]">
                      {row.action === "grant" ? "Attribution" : "Révocation"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[row.role as ProjectRole] ?? row.role}</td>
                  <td className="px-3 py-2">{nameOf(row.actor_user_id)}</td>
                  <td className="px-3 py-2">{nameOf(row.target_user_id)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
            <span className="text-muted-foreground">
              Page {safePage + 1} / {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Précédent</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Suivant</Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
