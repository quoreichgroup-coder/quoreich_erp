import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert, UserPlus, Trash2 } from "lucide-react";
import {
  useMyCrmRoles, useTenantCrmRoles, useAssignCrmRole,
} from "@/hooks/use-crm-data";
import {
  ALL_CRM_ROLES, ROLE_LABELS, REQUIRED_ROLES, ALL_CRM_ACTIONS, ACTION_LABELS,
  violatesCrmSoD, type CrmRole,
} from "@/lib/crm-roles";

export default function CrmSettings() {
  const perms = useMyCrmRoles();
  const { data: tenantRoles } = useTenantCrmRoles();
  const assign = useAssignCrmRole();

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<CrmRole>("crm_agent");
  const [reason, setReason] = useState("");

  if (!perms.canManageSettings) {
    return (
      <PageShell>
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Paramètres" }]} />
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">
            <ShieldAlert className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            Réservé à l'« Administrateur CRM ».
          </CardContent></Card>
        </div>
      </PageShell>
    );
  }

  const targetRoles = (tenantRoles?.get(userId) ?? []) as CrmRole[];
  const conflict = userId && violatesCrmSoD(targetRoles, role);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Paramètres" }]} />
        <GuidanceBanner title="Paramètres CRM" description="Attribution des rôles CRM avec contrôle SoD (Agent ⇄ Manager mutuellement exclusifs)." />

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Attribuer / révoquer un rôle</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="md:col-span-2 space-y-1">
                <Label className="text-[11px]">ID utilisateur</Label>
                <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="UUID…" className="h-8 text-xs font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Rôle</Label>
                <Select value={role} onValueChange={(v) => setRole(v as CrmRole)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_CRM_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Motif</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optionnel" className="h-8 text-xs" />
              </div>
            </div>

            {conflict && (
              <div className="flex items-center gap-2 text-[11px] text-destructive p-2 border border-destructive/40 rounded">
                <ShieldAlert className="w-3.5 h-3.5" />
                Conflit SoD : ce rôle est incompatible avec un rôle déjà attribué à cet utilisateur.
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm" className="h-8 text-xs"
                disabled={!userId.trim() || !!conflict || assign.isPending}
                onClick={() => assign.mutate({ target_user: userId.trim(), role, action: "grant", reason: reason || undefined })}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Attribuer
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 text-xs"
                disabled={!userId.trim() || assign.isPending}
                onClick={() => assign.mutate({ target_user: userId.trim(), role, action: "revoke", reason: reason || undefined })}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Révoquer
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Matrice rôle × action</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Action</TableHead>
                  {ALL_CRM_ROLES.map((r) => <TableHead key={r} className="text-[11px] text-center">{ROLE_LABELS[r]}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ALL_CRM_ACTIONS.map((a) => (
                  <TableRow key={a} className="text-xs">
                    <TableCell>{ACTION_LABELS[a]}</TableCell>
                    {ALL_CRM_ROLES.map((r) => (
                      <TableCell key={r} className="text-center">
                        {REQUIRED_ROLES[a].includes(r) ? <Badge className="text-[10px]">✓</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
