import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, History, X, ChevronLeft, ChevronRight, Download, FileText, Lock, Check, Minus, Grid3x3 } from "lucide-react";
import {
  useTenantFixedAssetRoles, useAssignFixedAssetRole, useFixedAssetRoleAudit, useMyFixedAssetRoles,
} from "@/hooks/use-fixed-assets-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import {
  FIXED_ASSET_ROLE_LABELS, type FixedAssetRole, actionTooltip, canDo,
  REQUIRED_ROLES, ACTION_LABELS, ROLE_LABELS, ALL_FA_ACTIONS, ALL_FA_ROLES,
} from "@/lib/fixed-assets-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

const PAGE_SIZE = 15;

export function FixedAssetsRolesPanel() {
  const { data: users = [] } = useTenantProfiles();
  const { data: rolesByUser } = useTenantFixedAssetRoles();
  const { data: audit = [] } = useFixedAssetRoleAudit();
  const assign = useAssignFixedAssetRole();
  const perms = useMyFixedAssetRoles();
  const canExport = canDo(perms, "export");
  const exportTip = actionTooltip(perms, "export", "Exporter l'audit CSV");

  const [pending, setPending] = useState<{
    target_user: string; role: FixedAssetRole; action: "assign" | "revoke";
    userName: string; roleLabel: string;
  } | null>(null);
  const [comment, setComment] = useState("");
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
    if (pending.action === "revoke" && !comment.trim()) return;
    assign.mutate(
      { target_user: pending.target_user, role: pending.role, action: pending.action, comment: comment.trim() || undefined },
      { onSuccess: () => { setPending(null); setComment(""); } },
    );
  };

  const exportAuditPDF = () => {
    if (!canExport) return;
    exportToPDF({
      filename: `fixed-asset-role-audit-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Audit — Rôles Immobilisations",
      subtitle: `${filteredAudit.length} ligne(s)`,
      columns: [
        { key: "date", header: "Date", format: (r: any) => new Date(r.created_at).toLocaleString("fr-FR") },
        { key: "action", header: "Action", format: (r: any) => r.action },
        { key: "role", header: "Rôle", format: (r: any) => r.role ?? "" },
        { key: "user", header: "Utilisateur cible", format: (r: any) => users.find((u) => u.id === r.target_user_id)?.full_name || r.target_user_id || "" },
        { key: "comment", header: "Commentaire", format: (r: any) => r.details?.comment ?? "" },
      ],
      rows: filteredAudit as any[],
    });
  };

  return (
    <div className="space-y-4">
      {/* === Role × Action permission matrix === */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Matrice des permissions</h3>
          <span className="text-[11px] text-muted-foreground ml-2">
            Qui peut faire quoi ? Les administrateurs assignent les rôles dans le tableau ci-dessous.
          </span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                {ALL_FA_ROLES.map((r) => (
                  <th key={r} className="text-center px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_FA_ACTIONS.map((action) => (
                <tr key={action} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-foreground">{ACTION_LABELS[action]}</td>
                  {ALL_FA_ROLES.map((role) => {
                    const ok = REQUIRED_ROLES[action].includes(role);
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
            <Landmark className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Attribution des rôles</h3>
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
            const userRoles = rolesByUser?.get(u.id) ?? [];
            const available = FIXED_ASSET_ROLE_LABELS.filter((r) => !userRoles.includes(r.value));
            return (
              <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium text-foreground">{u.full_name || "Sans nom"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {userRoles.length === 0 && <span className="text-muted-foreground italic">—</span>}
                    {userRoles.map((r) => {
                      const def = FIXED_ASSET_ROLE_LABELS.find((d) => d.value === r);
                      return (
                        <Badge key={r} variant="secondary" className="text-[10px] gap-1">
                          {def?.label.split(" — ")[0] ?? r}
                          <button
                            onClick={() => setPending({
                              target_user: u.id, role: r as FixedAssetRole, action: "revoke",
                              userName: u.full_name || "", roleLabel: def?.label ?? r,
                            })}
                            className="hover:text-destructive"
                          ><X className="w-2.5 h-2.5" /></button>
                        </Badge>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {available.length > 0 && (
                    <select
                      className="h-7 text-xs rounded border border-input bg-background px-2"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const def = FIXED_ASSET_ROLE_LABELS.find((d) => d.value === e.target.value);
                          setPending({
                            target_user: u.id, role: e.target.value as FixedAssetRole, action: "assign",
                            userName: u.full_name || "", roleLabel: def?.label ?? e.target.value,
                          });
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="">+ Attribuer…</option>
                      {available.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setPending(null); setComment(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.action === "assign" ? "Attribuer le rôle" : "Révoquer le rôle"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p><strong>{pending?.roleLabel}</strong> → <strong>{pending?.userName || "utilisateur"}</strong></p>
            <div>
              <Label className="text-xs">Commentaire {pending?.action === "revoke" && <span className="text-destructive">*</span>}</Label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Motif / contexte (audit)" className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setPending(null); setComment(""); }}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={assign.isPending || (pending?.action === "revoke" && !comment.trim())}>Confirmer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAudit} onOpenChange={(o) => { setShowAudit(o); if (!o) setPage(0); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Audit — Rôles Immobilisations</DialogTitle></DialogHeader>
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
                  <SelectItem value="assign">Attribution</SelectItem>
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
              disabled={!canExport || filteredAudit.length === 0}
              aria-label={exportTip} title={exportTip}
              onClick={() => {
                if (!canExport) return;
                exportToCSV(
                  filteredAudit.map((r) => ({
                    date: new Date(r.created_at).toISOString(),
                    action: r.action, role: r.role ?? "",
                    target_user: users.find((u) => u.id === r.target_user_id)?.full_name || r.target_user_id || "",
                    comment: r.details?.comment ?? "",
                  })),
                  [
                    { key: "date", header: "Date" }, { key: "action", header: "Action" },
                    { key: "role", header: "Rôle" }, { key: "target_user", header: "Utilisateur cible" },
                    { key: "comment", header: "Commentaire" },
                  ],
                  `fixed-asset-role-audit-${new Date().toISOString().slice(0, 10)}`,
                );
              }}
            >
              {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Export CSV
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 text-xs gap-1"
              disabled={!canExport || filteredAudit.length === 0}
              aria-label={exportTip} title={exportTip}
              onClick={exportAuditPDF}
            >
              {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Export PDF
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
                  <th className="text-left px-3 py-2">Commentaire</th>
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
                  return (
                    <tr key={row.id} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant={row.action === "assign" ? "default" : "destructive"} className="text-[10px]">{row.action}</Badge>
                      </td>
                      <td className="px-3 py-1.5 font-mono">{row.role ?? "—"}</td>
                      <td className="px-3 py-1.5">{u?.full_name || (row.target_user_id ?? "").slice(0, 8)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.details?.comment ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredAudit.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
              <span className="text-muted-foreground">
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredAudit.length)} sur {filteredAudit.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="px-2 tabular-nums">{safePage + 1} / {totalPages}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
