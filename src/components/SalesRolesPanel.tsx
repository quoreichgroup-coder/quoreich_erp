import { useState } from "react";
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
import { ShoppingBag, History, X } from "lucide-react";
import {
  SALES_ROLE_LABELS,
  useTenantSalesRoles,
  useAssignSalesRole,
  useSalesRoleAudit,
  type SalesRole,
} from "@/hooks/use-sales-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";

export function SalesRolesPanel() {
  const { data: users = [] } = useTenantProfiles();
  const { data: rolesByUser } = useTenantSalesRoles();
  const { data: audit = [] } = useSalesRoleAudit();
  const assign = useAssignSalesRole();

  const [pending, setPending] = useState<{
    target_user: string;
    role: SalesRole;
    action: "assign" | "revoke";
    userName: string;
    roleLabel: string;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [showAudit, setShowAudit] = useState(false);

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
      {
        onSuccess: () => {
          setPending(null);
          setComment("");
        },
      },
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Rôles Ventes (RBAC)</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          onClick={() => setShowAudit(true)}
        >
          <History className="w-3 h-3" /> Audit ({audit.length})
        </Button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">
              Utilisateur
            </th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">
              Rôles Ventes
            </th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground uppercase tracking-wider">
              Ajouter
            </th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                Aucun utilisateur dans l'organisation
              </td>
            </tr>
          )}
          {users.map((u) => {
            const userRoles = rolesByUser?.get(u.id) ?? [];
            const available = SALES_ROLE_LABELS.filter((r) => !userRoles.includes(r.value));
            return (
              <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {u.full_name || "Sans nom"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {userRoles.length === 0 && (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                    {userRoles.map((r) => {
                      const def = SALES_ROLE_LABELS.find((d) => d.value === r);
                      return (
                        <Badge key={r} variant="secondary" className="text-[10px] gap-1">
                          {def?.label.split(" — ")[0] ?? r}
                          <button
                            onClick={() =>
                              setPending({
                                target_user: u.id,
                                role: r as SalesRole,
                                action: "revoke",
                                userName: u.full_name || "",
                                roleLabel: def?.label ?? r,
                              })
                            }
                            className="hover:text-destructive"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
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
                          const def = SALES_ROLE_LABELS.find((d) => d.value === e.target.value);
                          setPending({
                            target_user: u.id,
                            role: e.target.value as SalesRole,
                            action: "assign",
                            userName: u.full_name || "",
                            roleLabel: def?.label ?? e.target.value,
                          });
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="">+ Attribuer…</option>
                      {available.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setComment("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.action === "assign" ? "Attribuer le rôle" : "Révoquer le rôle"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p>
              <strong>{pending?.roleLabel}</strong> →{" "}
              <strong>{pending?.userName || "utilisateur"}</strong>
            </p>
            <div>
              <Label className="text-xs">
                Commentaire{" "}
                {pending?.action === "revoke" && <span className="text-destructive">*</span>}
              </Label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Motif / contexte (audit)"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPending(null);
                setComment("");
              }}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={
                assign.isPending || (pending?.action === "revoke" && !comment.trim())
              }
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit — Rôles Ventes</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
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
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Aucune action enregistrée
                    </td>
                  </tr>
                )}
                {audit.map((a) => {
                  const u = users.find((x) => x.id === a.target_user_id);
                  return (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                        {new Date(a.created_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant={a.action === "assign" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {a.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 font-mono">{a.role}</td>
                      <td className="px-3 py-1.5">
                        {u?.full_name || a.target_user_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{a.comment || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
