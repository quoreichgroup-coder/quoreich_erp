import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Lock, X, History, Columns3 } from "lucide-react";
import { useHrRoleAudit, useMyHrRoles } from "@/hooks/use-hr-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import { ROLE_LABELS, canDo, actionTooltip, type HrRole } from "@/lib/hr-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

type ColKey = "date" | "action" | "role" | "actor" | "target" | "reason";
const ALL_COLS: { key: ColKey; header: string }[] = [
  { key: "date", header: "Date" },
  { key: "action", header: "Action" },
  { key: "role", header: "Rôle" },
  { key: "actor", header: "Acteur" },
  { key: "target", header: "Utilisateur cible" },
  { key: "reason", header: "Motif" },
];

const PAGE_SIZE = 25;

export default function AuditHr() {
  const perms = useMyHrRoles();
  const canView = canDo(perms, "view_sensitive");
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter l'audit");
  const viewTip = actionTooltip(perms, "view_sensitive", "Consulter l'audit");

  const { data: audit = [], isLoading } = useHrRoleAudit();
  const { data: users = [] } = useTenantProfiles();

  const [fUser, setFUser] = useState("all");
  const [fActor, setFActor] = useState("all");
  const [fAction, setFAction] = useState("all");
  const [fRole, setFRole] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [page, setPage] = useState(0);
  const [selectedCols, setSelectedCols] = useState<Set<ColKey>>(
    () => new Set(ALL_COLS.map((c) => c.key)),
  );
  const toggleCol = (k: ColKey) =>
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (next.size === 0) next.add(k); // keep at least one
      return next;
    });
  const activeCols = ALL_COLS.filter((c) => selectedCols.has(c.key));

  const filtered = useMemo(() => {
    const fromTs = fFrom ? new Date(fFrom).getTime() : null;
    const toTs = fTo ? new Date(fTo).getTime() + 86_400_000 : null;
    return audit.filter((r) => {
      if (fUser !== "all" && r.target_user_id !== fUser) return false;
      if (fActor !== "all" && r.performed_by !== fActor) return false;
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

  const rowToFlat = (r: any) => ({
    date: new Date(r.created_at).toISOString(),
    action: r.action === "grant" ? "Attribution" : "Révocation",
    role: ROLE_LABELS[r.role as HrRole] ?? r.role,
    actor: nameOf(r.performed_by),
    target: nameOf(r.target_user_id),
    reason: r.reason ?? "",
  });

  const exportCSV = () => {
    if (!canExport || activeCols.length === 0) return;
    exportToCSV(
      filtered.map(rowToFlat),
      activeCols.map((c) => ({ key: c.key as keyof ReturnType<typeof rowToFlat>, header: c.header })),
      `hr-role-audit-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const exportPDF = () => {
    if (!canExport || activeCols.length === 0) return;
    const formatters: Record<ColKey, (r: any) => string> = {
      date: (r) => new Date(r.created_at).toLocaleString("fr-FR"),
      action: (r) => (r.action === "grant" ? "Attribution" : "Révocation"),
      role: (r) => ROLE_LABELS[r.role as HrRole] ?? r.role,
      actor: (r) => nameOf(r.performed_by),
      target: (r) => nameOf(r.target_user_id),
      reason: (r) => r.reason ?? "",
    };
    exportToPDF({
      filename: `hr-role-audit-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Historique — Rôles RH / Paie",
      subtitle: `${filtered.length} ligne(s) · ${activeCols.length} colonne(s)`,
      columns: activeCols.map((c) => ({ key: c.key, header: c.header, format: formatters[c.key] })),
      rows: filtered as any[],
    });
  };


  if (!canView) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Audit" }, { label: "Rôles RH / Paie" }]} />
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
      <Breadcrumb items={[{ label: "Audit" }, { label: "Rôles RH / Paie" }]} />
      <GuidanceBanner
        title="Historique des rôles — RH / Paie"
        description="Journal complet des attributions et révocations de rôles hr_*, par tenant et utilisateur."
      />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> Historique — Rôles RH / Paie
        </h1>
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline" size="sm" className="h-8 text-xs gap-1"
                disabled={!canExport}
                title={canExport ? "Choisir les colonnes à exporter" : exportTip}
                aria-label="Sélection des colonnes d'export"
              >
                {canExport ? <Columns3 className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                Colonnes ({activeCols.length}/{ALL_COLS.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <div className="text-[11px] font-medium text-muted-foreground uppercase px-1 pb-1">
                Colonnes à exporter
              </div>
              {ALL_COLS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-1 py-1.5 text-xs rounded hover:bg-muted/40 cursor-pointer">
                  <Checkbox
                    checked={selectedCols.has(c.key)}
                    onCheckedChange={() => toggleCol(c.key)}
                  />
                  {c.header}
                </label>
              ))}
              <div className="flex justify-between pt-2 border-t border-border mt-1">
                <Button variant="ghost" size="sm" className="h-6 text-[11px]"
                  onClick={() => setSelectedCols(new Set(ALL_COLS.map((c) => c.key)))}>
                  Tout
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[11px]"
                  onClick={() => setSelectedCols(new Set([ALL_COLS[0].key]))}>
                  Minimum
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0 || activeCols.length === 0}
            aria-label={exportTip} title={exportTip} onClick={exportCSV}
          >
            {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0 || activeCols.length === 0}
            aria-label={exportTip} title={exportTip} onClick={exportPDF}
          >
            {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} PDF
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-3 mb-3 flex flex-wrap items-end gap-2">
        <FilterSelect label="Utilisateur cible" value={fUser} onChange={(v) => { setFUser(v); setPage(0); }}>
          <SelectItem value="all">Tous</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.id.slice(0, 8)}</SelectItem>)}
        </FilterSelect>
        <FilterSelect label="Acteur" value={fActor} onChange={(v) => { setFActor(v); setPage(0); }}>
          <SelectItem value="all">Tous</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.id.slice(0, 8)}</SelectItem>)}
        </FilterSelect>
        <FilterSelect label="Action" value={fAction} onChange={(v) => { setFAction(v); setPage(0); }} width={140}>
          <SelectItem value="all">Toutes</SelectItem>
          <SelectItem value="grant">Attribution</SelectItem>
          <SelectItem value="revoke">Révocation</SelectItem>
        </FilterSelect>
        <FilterSelect label="Rôle" value={fRole} onChange={(v) => { setFRole(v); setPage(0); }}>
          <SelectItem value="all">Tous</SelectItem>
          {(Object.keys(ROLE_LABELS) as HrRole[]).map((r) => (
            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
          ))}
        </FilterSelect>
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
                <Th>Date</Th><Th>Action</Th><Th>Rôle</Th>
                <Th>Acteur</Th><Th>Utilisateur cible</Th><Th>Motif</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {activeCount > 0 ? "Aucune entrée ne correspond aux filtres" : "Aucune action enregistrée"}
                </td></tr>
              )}
              {pageRows.map((row) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.action === "grant" ? "default" : "destructive"} className="text-[10px]">
                      {row.action === "grant" ? "Attribution" : "Révocation"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[row.role as HrRole] ?? row.role}</td>
                  <td className="px-3 py-2">{nameOf(row.performed_by)}</td>
                  <td className="px-3 py-2">{nameOf(row.target_user_id)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
            <span className="text-muted-foreground">Page {safePage + 1} / {totalPages}</span>
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

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">{children}</th>;
}

function FilterSelect({
  label, value, onChange, children, width = 180,
}: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs" style={{ width }}><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
