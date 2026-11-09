import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, History, X, Download, FileText, Lock, Check, Minus, Grid3x3 } from "lucide-react";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

const PAGE_SIZE = 15;

export type GenericRolesPanelProps<R extends string, A extends string> = {
  moduleLabel: string;            // e.g. "Conformité"
  filePrefix: string;             // e.g. "compliance-role-audit"
  sodHint: string;                // e.g. "Officier et Auditeur sont mutuellement exclusifs."
  roles: readonly R[];
  actions: readonly A[];
  roleLabels: Record<R, string>;
  actionLabels: Record<A, string>;
  requiredRoles: Record<A, R[]>;
  violatesSoD: (existing: string[], next: R) => boolean;
  canExport: boolean;
  exportTooltip: string;
  useTenantRoles: () => { data?: Map<string, string[]> };
  useAudit: () => { data?: Array<{
    id: string; created_at: string; tenant_id: string; actor_user_id: string;
    target_user_id: string; role: string; action: "grant" | "revoke"; reason: string | null;
  }> };
  useAssign: () => {
    mutate: (input: { target_user: string; role: R; action: "grant" | "revoke"; reason?: string },
             opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
    variables?: { target_user: string; role: R };
  };
};

export function GenericRolesPanel<R extends string, A extends string>(p: GenericRolesPanelProps<R, A>) {
  const { data: users = [] } = useTenantProfiles();
  const { data: rolesByUser } = p.useTenantRoles();
  const { data: audit = [] } = p.useAudit();
  const assign = p.useAssign();

  const [pending, setPending] = useState<{
    target_user: string; role: R; action: "grant" | "revoke";
    userName: string; roleLabel: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [showAudit, setShowAudit] = useState(false);
  const [fUser, setFUser] = useState("all");
  const [fAction, setFAction] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [page, setPage] = useState(0);

  const filteredAudit = useMemo(() => {
    const fromTs = fFrom ? new Date(fFrom).getTime() : null;
    const toTs = fTo ? new Date(fTo).getTime() + 86_400_000 : null;
    return (audit ?? []).filter((r) => {
      if (fUser !== "all" && r.target_user_id !== fUser) return false;
      if (fAction !== "all" && r.action !== fAction) return false;
      const ts = new Date(r.created_at).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts >= toTs) return false;
      return true;
    });
  }, [audit, fUser, fAction, fFrom, fTo]);

  const totalPages = Math.max(1, Math.ceil(filteredAudit.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredAudit.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const activeCount = (fUser !== "all" ? 1 : 0) + (fAction !== "all" ? 1 : 0) + (fFrom ? 1 : 0) + (fTo ? 1 : 0);
  const resetFilters = () => { setFUser("all"); setFAction("all"); setFFrom(""); setFTo(""); setPage(0); };

  const submit = () => {
    if (!pending) return;
    if (pending.action === "revoke" && !reason.trim()) return;
    assign.mutate(
      { target_user: pending.target_user, role: pending.role, action: pending.action, reason: reason.trim() || undefined },
      { onSuccess: () => { setPending(null); setReason(""); } },
    );
  };

  const exportAuditPDF = () => {
    if (!p.canExport) return;
    exportToPDF({
      filename: `${p.filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: `Audit — Rôles ${p.moduleLabel}`,
      subtitle: `${filteredAudit.length} ligne(s)`,
      columns: [
        { key: "date", header: "Date", format: (r: any) => new Date(r.created_at).toLocaleString("fr-FR") },
        { key: "action", header: "Action", format: (r: any) => r.action },
        { key: "role", header: "Rôle", format: (r: any) => r.role ?? "" },
        { key: "user", header: "Utilisateur cible", format: (r: any) => users.find((u) => u.id === r.target_user_id)?.full_name || r.target_user_id || "" },
        { key: "reason", header: "Motif", format: (r: any) => r.reason ?? "" },
      ],
      rows: filteredAudit as any[],
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Matrice des permissions</h3>
          <span className="text-[11px] text-muted-foreground ml-2">SoD : {p.sodHint}</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                {p.roles.map((r) => (
                  <th key={r} className="text-center px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {p.roleLabels[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.actions.map((action) => (
                <tr key={action} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-foreground">{p.actionLabels[action]}</td>
                  {p.roles.map((role) => {
                    const ok = p.requiredRoles[action].includes(role);
                    return (
                      <td key={role} className="px-3 py-2 text-center">
                        {ok
                          ? <Check className="w-3.5 h-3.5 inline text-success" aria-label="Autorisé" />
                          : <Minus className="w-3.5 h-3.5 inline text-muted-foreground/40" aria-label="Non autorisé" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Attribution des rôles {p.moduleLabel}</h3>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowAudit(true)}>
            <History className="w-3 h-3" /> Audit ({audit.length})
          </Button>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Utilisateur</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Rôles</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Ajouter</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">Aucun utilisateur dans l'organisation</td></tr>
            )}
            {users.map((u) => {
              const userRoles = (rolesByUser?.get(u.id) ?? []) as R[];
              const available = p.roles.filter((r) => !userRoles.includes(r));
              const isRowPending = assign.isPending && assign.variables?.target_user === u.id;
              const pendingRole = isRowPending ? assign.variables?.role : undefined;
              return (
                <tr key={u.id} className={`border-b border-border/50 hover:bg-muted/20 ${isRowPending ? "opacity-70" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{u.full_name || "Sans nom"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {userRoles.length === 0 && <span className="text-muted-foreground italic">—</span>}
                      {userRoles.map((r) => {
                        const thisPending = pendingRole === r;
                        return (
                          <Badge key={r} variant="secondary" className={`text-[10px] gap-1 ${thisPending ? "animate-pulse" : ""}`}>
                            {p.roleLabels[r] ?? r}
                            <button
                              disabled={isRowPending}
                              onClick={() => setPending({
                                target_user: u.id, role: r, action: "revoke",
                                userName: u.full_name || "", roleLabel: p.roleLabels[r] ?? r,
                              })}
                              className="hover:text-destructive disabled:opacity-50"
                              aria-label={`Révoquer ${p.roleLabels[r] ?? r}`}
                            ><X className="w-2.5 h-2.5" /></button>
                          </Badge>
                        );
                      })}
                      {isRowPending && <span className="text-[10px] text-muted-foreground italic" role="status">Enregistrement…</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {available.length > 0 && (
                      <select
                        className="h-7 text-xs rounded border border-input bg-background px-2 disabled:opacity-50"
                        defaultValue=""
                        disabled={isRowPending}
                        onChange={(e) => {
                          const val = e.target.value as R;
                          if (!val) return;
                          const conflict = p.violatesSoD(userRoles, val);
                          setPending({
                            target_user: u.id, role: val, action: "grant",
                            userName: u.full_name || "",
                            roleLabel: conflict ? `${p.roleLabels[val]} (⚠ SoD)` : p.roleLabels[val],
                          });
                          e.target.value = "";
                        }}
                      >
                        <option value="">+ Attribuer…</option>
                        {available.map((r) => {
                          const conflict = p.violatesSoD(userRoles, r);
                          return (
                            <option key={r} value={r} disabled={conflict}>
                              {p.roleLabels[r]}{conflict ? " — bloqué SoD" : ""}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setPending(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pending?.action === "grant" ? "Attribuer le rôle" : "Révoquer le rôle"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-xs">
            <p><strong>{pending?.roleLabel}</strong> → <strong>{pending?.userName || "utilisateur"}</strong></p>
            <div>
              <Label className="text-xs">Motif {pending?.action === "revoke" && <span className="text-destructive">*</span>}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif / contexte (audit)" className="h-8 text-xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">SoD : {p.sodHint}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setPending(null); setReason(""); }}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={assign.isPending || (pending?.action === "revoke" && !reason.trim())}>
              {assign.isPending ? "Enregistrement…" : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAudit} onOpenChange={(o) => { setShowAudit(o); if (!o) setPage(0); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Audit — Rôles {p.moduleLabel}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-end gap-2 pb-2 border-b border-border">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Utilisateur</Label>
              <Select value={fUser} onValueChange={(v) => { setFUser(v); setPage(0); }}>
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
            <Button
              variant="outline" size="sm" className="h-8 text-xs gap-1 ml-auto"
              disabled={!p.canExport || filteredAudit.length === 0}
              aria-label={p.exportTooltip} title={p.exportTooltip}
              onClick={() => {
                if (!p.canExport) return;
                exportToCSV(
                  filteredAudit.map((r) => ({
                    date: new Date(r.created_at).toISOString(),
                    action: r.action, role: r.role,
                    target_user: users.find((u) => u.id === r.target_user_id)?.full_name || r.target_user_id || "",
                    reason: r.reason ?? "",
                  })),
                  [
                    { key: "date", header: "Date" }, { key: "action", header: "Action" },
                    { key: "role", header: "Rôle" }, { key: "target_user", header: "Utilisateur cible" },
                    { key: "reason", header: "Motif" },
                  ],
                  `${p.filePrefix}-${new Date().toISOString().slice(0, 10)}`,
                );
              }}
            >
              {p.canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Export CSV
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 text-xs gap-1"
              disabled={!p.canExport || filteredAudit.length === 0}
              aria-label={p.exportTooltip} title={p.exportTooltip}
              onClick={exportAuditPDF}
            >
              {p.canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Export PDF
            </Button>
          </div>
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Rôle</th>
                  <th className="text-left px-3 py-2">Utilisateur cible</th>
                  <th className="text-left px-3 py-2">Motif</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {filteredAudit.length === 0 && audit.length > 0
                      ? "Aucune action ne correspond aux filtres"
                      : "Aucune action enregistrée"}
                  </td></tr>
                )}
                {pageRows.map((row) => {
                  const u = users.find((x) => x.id === row.target_user_id);
                  const label = (p.roleLabels as Record<string, string>)[row.role] ?? row.role;
                  return (
                    <tr key={row.id} className="border-b border-border/50">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-2">
                        <Badge variant={row.action === "grant" ? "default" : "destructive"} className="text-[10px]">
                          {row.action === "grant" ? "Attribution" : "Révocation"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{label}</td>
                      <td className="px-3 py-2">{u?.full_name || row.target_user_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.reason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
              <span className="text-muted-foreground">
                Page {safePage + 1} / {totalPages} — {filteredAudit.length} ligne(s)
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Précédent</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Suivant</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
