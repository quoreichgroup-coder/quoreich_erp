import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCrmRoleAudit, useMyCrmRoles, useCrmStageAudit } from "@/hooks/use-crm-data";
import { ROLE_LABELS, actionTooltip, type CrmRole } from "@/lib/crm-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { buildRoleAuditPreview, buildStageAuditPreview, type AuditPreview } from "@/lib/crm-audit-export";
import CrmAuditExportPreviewDialog from "@/components/CrmAuditExportPreviewDialog";
import { ShieldAlert, Eye } from "lucide-react";

export default function CrmControl() {
  const perms = useMyCrmRoles();
  const { data: audit = [], isLoading } = useCrmRoleAudit();
  const { data: stageAudit = [], isLoading: stageLoading } = useCrmStageAudit();
  const [preview, setPreview] = useState<AuditPreview | null>(null);


  if (!perms.canAudit) {
    return (
      <PageShell>
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Contrôle" }]} />
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">
            <ShieldAlert className="w-5 h-5 mx-auto mb-2 text-amber-500" />
            Accès réservé aux rôles « Auditeur CRM » et « Administrateur CRM ».
          </CardContent></Card>
        </div>
      </PageShell>
    );
  }

  function maskUser(id: string | null | undefined) {
    if (!id) return "—";
    return perms.canViewSensitive ? id : `${id.slice(0, 8)}…`;
  }
  function maskReason(reason: string | null | undefined) {
    if (!reason) return "—";
    return perms.canViewSensitive ? reason : "•••";
  }
  function maskSubject(subject: string) {
    return perms.canViewSensitive ? subject : subject.replace(/\b[\w-]{6,}\b/g, "•••");
  }

  function exportRolesCsv() {
    if (!perms.canExport) return;
    exportToCSV(
      audit.map((r) => ({
        date: new Date(r.created_at).toISOString(),
        action: r.action,
        role: ROLE_LABELS[r.role as CrmRole] ?? r.role,
        target_user: maskUser(r.target_user_id),
        performed_by: maskUser(r.performed_by),
        reason: maskReason(r.reason),
      })),
      [
        { key: "date", header: "Date" }, { key: "action", header: "Action" },
        { key: "role", header: "Rôle" }, { key: "target_user", header: "Utilisateur cible" },
        { key: "performed_by", header: "Par" }, { key: "reason", header: "Motif" },
      ],
      `crm-audit-roles-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  function exportRolesPdf() {
    if (!perms.canExport) return;
    exportToPDF({
      filename: `crm-audit-roles-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Audit CRM — Rôles",
      subtitle: `${audit.length} entrée(s)${perms.canViewSensitive ? "" : " · données masquées"}`,
      columns: [
        { key: "created_at", header: "Date", format: (r) => new Date((r as { created_at: string }).created_at).toLocaleString("fr-FR") },
        { key: "action", header: "Action" },
        { key: "role", header: "Rôle", format: (r) => ROLE_LABELS[(r as { role: string }).role as CrmRole] ?? (r as { role: string }).role },
        { key: "target_user_id", header: "Cible", format: (r) => maskUser((r as { target_user_id: string }).target_user_id) },
        { key: "performed_by", header: "Par", format: (r) => maskUser((r as { performed_by: string | null }).performed_by) },
        { key: "reason", header: "Motif", format: (r) => maskReason((r as { reason: string | null }).reason) },
      ],
      rows: audit as unknown as Record<string, unknown>[],
    });
  }

  function exportStageCsv() {
    if (!perms.canExport) return;
    exportToCSV(
      stageAudit.map((a) => ({
        date: new Date(a.created_at).toISOString(),
        opportunity: a.opportunity_id ?? "",
        subject: maskSubject(a.subject),
        by: maskUser(a.created_by),
      })),
      [
        { key: "date", header: "Date" },
        { key: "opportunity", header: "Opportunité" },
        { key: "subject", header: "Changement" },
        { key: "by", header: "Par" },
      ],
      `crm-audit-stages-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  function exportStagePdf() {
    if (!perms.canExport) return;
    exportToPDF({
      filename: `crm-audit-stages-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Audit CRM — Étapes & assignations",
      subtitle: `${stageAudit.length} entrée(s)${perms.canViewSensitive ? "" : " · données masquées"}`,
      columns: [
        { key: "created_at", header: "Date", format: (r) => new Date((r as { created_at: string }).created_at).toLocaleString("fr-FR") },
        { key: "opportunity_id", header: "Opportunité" },
        { key: "subject", header: "Changement", format: (r) => maskSubject((r as { subject: string }).subject) },
        { key: "created_by", header: "Par", format: (r) => maskUser((r as { created_by: string | null }).created_by) },
      ],
      rows: stageAudit as unknown as Record<string, unknown>[],
    });
  }

  const PreviewButton = ({ onClick }: { onClick: () => void }) => (
    <Button
      size="sm" variant="outline" className="h-7 text-[11px]"
      disabled={!perms.canExport}
      title={actionTooltip(perms, "export", "Prévisualiser & exporter")}
      onClick={onClick}
    >
      <Eye className="w-3 h-3 mr-1" /> Aperçu export
    </Button>
  );

  function openRolesPreview() {
    setPreview(buildRoleAuditPreview(perms, audit));
  }
  function openStagesPreview() {
    setPreview(buildStageAuditPreview(perms, stageAudit));
  }
  function handleConfirmCsv() {
    if (!preview) return;
    if (preview.kind === "roles") exportRolesCsv(); else exportStageCsv();
    setPreview(null);
  }
  function handleConfirmPdf() {
    if (!preview) return;
    if (preview.kind === "roles") exportRolesPdf(); else exportStagePdf();
    setPreview(null);
  }

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Contrôle" }]} />
        <GuidanceBanner
          title="Contrôle & Audit CRM"
          description="Historique des attributions de rôles, changements d'étape et assignations. Exports CSV/PDF gated par export + view_sensitive."
        />

        <Tabs defaultValue="roles">
          <TabsList>
            <TabsTrigger value="roles" className="text-xs">Rôles ({audit.length})</TabsTrigger>
            <TabsTrigger value="stages" className="text-xs">Étapes & assignations ({stageAudit.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="roles" className="mt-3">
            <Card>
              <CardHeader className="py-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs">Journal d'audit des rôles CRM</CardTitle>
                <PreviewButton onClick={openRolesPreview} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Date</TableHead>
                      <TableHead className="text-[11px]">Action</TableHead>
                      <TableHead className="text-[11px]">Rôle</TableHead>
                      <TableHead className="text-[11px]">Utilisateur cible</TableHead>
                      <TableHead className="text-[11px]">Par</TableHead>
                      <TableHead className="text-[11px]">Motif</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-xs py-6 text-muted-foreground">Chargement…</TableCell></TableRow>
                    ) : audit.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-xs py-6 text-muted-foreground">Aucun mouvement.</TableCell></TableRow>
                    ) : audit.map((r) => (
                      <TableRow key={r.id} className="text-xs">
                        <TableCell className="font-mono text-[10px]">{new Date(r.created_at).toLocaleString("fr-FR")}</TableCell>
                        <TableCell>
                          <Badge variant={r.action === "grant" ? "default" : "outline"} className="text-[10px]">
                            {r.action === "grant" ? "Attribué" : "Révoqué"}
                          </Badge>
                        </TableCell>
                        <TableCell>{ROLE_LABELS[r.role as CrmRole] ?? r.role}</TableCell>
                        <TableCell className="font-mono text-[10px]">{maskUser(r.target_user_id)}</TableCell>
                        <TableCell className="font-mono text-[10px]">{maskUser(r.performed_by)}</TableCell>
                        <TableCell className="text-muted-foreground">{maskReason(r.reason)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stages" className="mt-3">
            <Card>
              <CardHeader className="py-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs">Changements d'étape et assignations</CardTitle>
                <PreviewButton onClick={openStagesPreview} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Date</TableHead>
                      <TableHead className="text-[11px]">Opportunité</TableHead>
                      <TableHead className="text-[11px]">Changement</TableHead>
                      <TableHead className="text-[11px]">Par</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stageLoading ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs py-6 text-muted-foreground">Chargement…</TableCell></TableRow>
                    ) : stageAudit.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs py-6 text-muted-foreground">Aucun changement.</TableCell></TableRow>
                    ) : stageAudit.map((a) => (
                      <TableRow key={a.id} className="text-xs">
                        <TableCell className="font-mono text-[10px]">{new Date(a.created_at).toLocaleString("fr-FR")}</TableCell>
                        <TableCell className="font-mono text-[10px]">{a.opportunity_id?.slice(0, 8) ?? "—"}…</TableCell>
                        <TableCell>{maskSubject(a.subject)}</TableCell>
                        <TableCell className="font-mono text-[10px]">{maskUser(a.created_by)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CrmAuditExportPreviewDialog
        open={!!preview}
        onClose={() => setPreview(null)}
        preview={preview}
        onConfirmCsv={handleConfirmCsv}
        onConfirmPdf={handleConfirmPdf}
      />
    </PageShell>
  );
}
