import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Warehouse, History, X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  INVENTORY_ROLE_LABELS,
  useTenantInventoryRoles,
  useAssignInventoryRole,
  useInventoryRoleAudit,
  type InventoryRole,
} from "@/hooks/use-inventory-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";

const PAGE_SIZE = 15;

export function InventoryRolesPanel() {
  const { data: users = [] } = useTenantProfiles();
  const { data: rolesByUser } = useTenantInventoryRoles();
  const { data: audit = [] } = useInventoryRoleAudit();
  const assign = useAssignInventoryRole();

  const [pending, setPending] = useState<{
    target_user: string;
    role: InventoryRole;
    action: "assign" | "revoke";
    userName: string;
    roleLabel: string;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  // Audit filters
  const [fUser, setFUser] = useState<string>("all");
  const [fAction, setFAction] = useState<string>("all");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");
  const [page, setPage] = useState(0);

  type AuditRow = { id: string; created_at: string; action: string; role: string; target_user_id: string; comment: string | null };

  const filteredAudit = useMemo(() => {
    const rows = (audit as AuditRow[]) ?? [];
    const fromTs = fFrom ? new Date(fFrom).getTime() : null;
    const toTs = fTo ? new Date(fTo).getTime() + 86_400_000 : null;
    return rows.filter((r) => {
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
  const resetFilters = () => { setFUser("all"); setFAction("all"); setFFrom(""); setFTo(""); setPage(0); };
  const activeCount = (fUser !== "all" ? 1 : 0) + (fAction !== "all" ? 1 : 0) + (fFrom ? 1 : 0) + (fTo ? 1 : 0);

  const submit = () => {
    if (!pending) return;
    if (pending.action === "revoke" && !comment.trim()) return;
    assign.mutate(
      {
        target_user: pending.target_user,
        role: pending.role,
        action: pending.action,
        comment: comment.trim() || undefined,
      },
      { onSuccess: () => { setPending(null); setComment(""); } },
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Rôles Stock (RBAC)</h3>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowAudit(true)}>
          <History className="w-3 h-3" /> Audit ({audit.length})
        </Button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Utilisateur</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Rôles Stock</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">Ajouter</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">Aucun utilisateur dans l'organisation</td></tr>
          )}
          {users.map((u) => {
            const userRoles = rolesByUser?.get(u.id) ?? [];
            const available = INVENTORY_ROLE_LABELS.filter((r) => !userRoles.includes(r.value));
            return (
              <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium text-foreground">{u.full_name || "Sans nom"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {userRoles.length === 0 && <span className="text-muted-foreground italic">—</span>}
                    {userRoles.map((r) => {
                      const def = INVENTORY_ROLE_LABELS.find((d) => d.value === r);
                      return (
                        <Badge key={r} variant="secondary" className="text-[10px] gap-1">
                          {def?.label.split(" — ")[0] ?? r}
                          <button
                            onClick={() => setPending({
                              target_user: u.id, role: r as InventoryRole, action: "revoke",
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
                          const def = INVENTORY_ROLE_LABELS.find((d) => d.value === e.target.value);
                          setPending({
                            target_user: u.id, role: e.target.value as InventoryRole, action: "assign",
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
          <DialogHeader><DialogTitle>Audit — Rôles Stock</DialogTitle></DialogHeader>

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
                    {filteredAudit.length === 0 && (audit as unknown[]).length > 0
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
                      <td className="px-3 py-1.5 font-mono">{row.role}</td>
                      <td className="px-3 py-1.5">{u?.full_name || row.target_user_id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.comment || "—"}</td>
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
  );
}
