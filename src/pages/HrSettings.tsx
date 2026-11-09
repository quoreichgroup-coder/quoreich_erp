import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UsersRound, X, Check, Minus, Grid3x3, Lock, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTenantHrRoles, useAssignHrRole, useMyHrRoles } from "@/hooks/use-hr-data";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import {
  ALL_HR_ROLES, ALL_HR_ACTIONS, ROLE_LABELS, ACTION_LABELS, REQUIRED_ROLES,
  SOD_CONFLICTS, violatesHrSoD, type HrRole,
} from "@/lib/hr-roles";

function mapAssignError(msg?: string): { title: string; hint: string } {
  const m = msg ?? "";
  if (/SoD|separation|séparation/i.test(m))
    return { title: "Conflit de séparation des tâches", hint: "Révoquez le rôle incompatible avant d'attribuer celui-ci." };
  if (/admin/i.test(m))
    return { title: "Action non autorisée", hint: "Seuls les administrateurs RH peuvent modifier les rôles." };
  if (/tenant/i.test(m))
    return { title: "Tenant invalide", hint: "L'utilisateur cible n'appartient pas à votre organisation." };
  if (/reason|motif/i.test(m))
    return { title: "Motif requis", hint: "Renseignez un motif d'audit avant de confirmer." };
  return { title: "Échec de l'opération", hint: m || "Réessayez ou contactez un administrateur." };
}

export default function HrSettings() {
  const perms = useMyHrRoles();
  const { data: users = [] } = useTenantProfiles();
  const { data: rolesByUser } = useTenantHrRoles();
  const assign = useAssignHrRole();

  const [pending, setPending] = useState<{
    target_user: string; role: HrRole; action: "assign" | "revoke";
    userName: string; roleLabel: string;
  } | null>(null);
  const [reason, setReason] = useState("");

  if (!perms.canManageSettings) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "RH / Paie" }, { label: "Paramètres" }]} />
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <h2 className="text-base font-semibold mb-1">Accès restreint</h2>
          <p className="text-sm text-muted-foreground">
            Seuls les administrateurs RH peuvent configurer les rôles.
          </p>
        </div>
      </PageShell>
    );
  }

  const submit = () => {
    if (!pending) return;
    if (pending.action === "revoke" && !reason.trim()) return;
    assign.mutate(
      { target_user: pending.target_user, role: pending.role, action: pending.action, reason: reason.trim() || undefined },
      { onSuccess: () => { setPending(null); setReason(""); } },
    );
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "RH / Paie" }, { label: "Paramètres" }]} />
      <GuidanceBanner
        title="Paramètres RH / Paie"
        description="Attribuez les rôles hr_clerk, hr_approver, payroll_officer, hr_auditor et hr_admin. La séparation des tâches (SoD) est appliquée côté serveur."
      />

      {/* Matrix */}
      <div className="bg-card rounded-lg border border-border overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Matrice des permissions</h3>
          <span className="text-[11px] text-muted-foreground ml-2 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> SoD : Saisie ⇄ Approbateur, Officier ⇄ Auditeur.
          </span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                {ALL_HR_ROLES.map((r) => (
                  <th key={r} className="text-center px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_HR_ACTIONS.map((action) => (
                <tr key={action} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{ACTION_LABELS[action]}</td>
                  {ALL_HR_ROLES.map((role) => (
                    <td key={role} className="px-3 py-2 text-center">
                      {REQUIRED_ROLES[action].includes(role)
                        ? <Check className="w-3.5 h-3.5 inline text-success" />
                        : <Minus className="w-3.5 h-3.5 inline text-muted-foreground/40" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assignment */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <UsersRound className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Attribution des rôles RH</h3>
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
              <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">Aucun utilisateur</td></tr>
            )}
            {users.map((u) => {
              const userRoles = (rolesByUser?.get(u.id) ?? []) as HrRole[];
              const available = ALL_HR_ROLES.filter((r) => !userRoles.includes(r));
              const isRowPending = assign.isPending && assign.variables?.target_user === u.id;
              const pendingRole = isRowPending ? assign.variables?.role : undefined;
              const existingConflict = userRoles.some((r) =>
                (SOD_CONFLICTS[r] ?? []).some((c) => userRoles.includes(c)),
              );
              return (
                <tr key={u.id} className={`border-b border-border/50 hover:bg-muted/20 ${isRowPending ? "opacity-70" : ""}`}>
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{u.full_name || "Sans nom"}</span>
                      {existingConflict && (
                        <Badge variant="destructive" className="text-[9px] gap-1" title="Conflit SoD existant">
                          <AlertTriangle className="w-2.5 h-2.5" /> SoD
                        </Badge>
                      )}
                      {!existingConflict && userRoles.length > 0 && (
                        <Badge variant="outline" className="text-[9px] gap-1 text-success border-success/30">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Conforme
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {userRoles.length === 0 && <span className="text-muted-foreground italic">Aucun rôle</span>}
                      {userRoles.map((r) => (
                        <Badge key={r} variant="secondary" className={`text-[10px] gap-1 ${pendingRole === r ? "animate-pulse" : ""}`}>
                          {ROLE_LABELS[r] ?? r}
                          <button
                            disabled={isRowPending}
                            onClick={() => setPending({
                              target_user: u.id, role: r, action: "revoke",
                              userName: u.full_name || "", roleLabel: ROLE_LABELS[r],
                            })}
                            className="hover:text-destructive disabled:opacity-50"
                            aria-label={`Révoquer ${ROLE_LABELS[r]}`}
                          ><X className="w-2.5 h-2.5" /></button>
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {available.length > 0 && (
                      <select
                        className="h-7 text-xs rounded border border-input bg-background px-2 disabled:opacity-50"
                        defaultValue=""
                        disabled={isRowPending}
                        onChange={(e) => {
                          const v = e.target.value as HrRole;
                          if (!v) return;
                          setPending({
                            target_user: u.id, role: v, action: "assign",
                            userName: u.full_name || "", roleLabel: ROLE_LABELS[v],
                          });
                          e.target.value = "";
                        }}
                      >
                        <option value="">+ Attribuer…</option>
                        {available.map((r) => {
                          const conflict = violatesHrSoD(userRoles, r);
                          return (
                            <option key={r} value={r} disabled={conflict}>
                              {ROLE_LABELS[r]}{conflict ? " — bloqué (SoD)" : ""}
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

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setPending(null); setReason(""); assign.reset(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.action === "assign" ? "Attribuer le rôle" : "Révoquer le rôle"}</DialogTitle>
          </DialogHeader>
          {(() => {
            const targetRoles = (pending && (rolesByUser?.get(pending.target_user) ?? [])) as HrRole[];
            const clientConflict =
              !!pending && pending.action === "assign" && violatesHrSoD(targetRoles, pending.role);
            const conflictingHeld = pending
              ? (SOD_CONFLICTS[pending.role] ?? []).filter((c) => targetRoles.includes(c))
              : [];
            const err = assign.error ? mapAssignError((assign.error as Error).message) : null;
            return (
              <div className="space-y-3 text-xs">
                <p><strong>{pending?.roleLabel}</strong> → <strong>{pending?.userName || "utilisateur"}</strong></p>
                {clientConflict && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertTitle className="text-xs">Conflit SoD détecté</AlertTitle>
                    <AlertDescription className="text-[11px]">
                      Incompatible avec : {conflictingHeld.map((r) => ROLE_LABELS[r]).join(", ")}.
                      Révoquez d'abord ce(s) rôle(s) pour pouvoir attribuer <strong>{pending?.roleLabel}</strong>.
                    </AlertDescription>
                  </Alert>
                )}
                {err && !clientConflict && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertTitle className="text-xs">{err.title}</AlertTitle>
                    <AlertDescription className="text-[11px]">{err.hint}</AlertDescription>
                  </Alert>
                )}
                <div>
                  <Label className="text-xs">Motif {pending?.action === "revoke" && <span className="text-destructive">*</span>}</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contexte (audit)" className="h-8 text-xs" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  La séparation des tâches est vérifiée côté serveur — toute violation sera refusée.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setPending(null); setReason(""); assign.reset(); }}>Annuler</Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={
                assign.isPending ||
                (pending?.action === "revoke" && !reason.trim()) ||
                (!!pending && pending.action === "assign" &&
                  violatesHrSoD((rolesByUser?.get(pending.target_user) ?? []) as HrRole[], pending.role))
              }
            >
              {assign.isPending ? "Enregistrement…" : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
