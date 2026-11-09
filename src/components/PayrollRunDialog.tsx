import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, FileCheck2, FileText, Hammer, Loader2, Lock, Play, ShieldCheck,
  Download, XCircle, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  usePayrollLines,
  useGeneratePayrollLines,
  useApprovePayrollRun,
  usePostPayrollRun,
  usePayrollRunAudit,
  type PayrollRun,
  type PayrollLine,
} from "@/hooks/use-hr-data";
import { useMyHrRoles } from "@/hooks/use-hr-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/hr-roles";
import { buildJournalPreview, type PayrollComputation } from "@/lib/payroll-engine";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";
import { exportPayrollRunRecapPDF } from "@/lib/payroll-recap-pdf";
import { PayrollExportPreviewDialog } from "@/components/PayrollExportPreviewDialog";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:    { label: "Brouillon",                cls: "bg-muted text-muted-foreground border-muted" },
  approved: { label: "Approuvé (à comptabiliser)", cls: "bg-blue-500/15 text-blue-700 border-blue-500/20" },
  posted:   { label: "Comptabilisé (verrouillé)", cls: "bg-success/15 text-success border-success/20" },
};

const TIMELINE: { key: "draft" | "approved" | "posted"; label: string; icon: typeof Play }[] = [
  { key: "draft",    label: "Création / Génération",     icon: Play },
  { key: "approved", label: "Approbation",                icon: FileCheck2 },
  { key: "posted",   label: "Comptabilisation SYSCOHADA", icon: Hammer },
];

const AUDIT_PAGE_SIZE = 10;

export function PayrollRunDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRun | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const perms = useMyHrRoles();
  const { data: lines = [], isLoading: linesLoading } = usePayrollLines(run?.id ?? null);
  const generate = useGeneratePayrollLines();
  const approve = useApprovePayrollRun();
  const post = usePostPayrollRun();

  const computations: PayrollComputation[] = useMemo(
    () => lines.map((l) => ({ gross: +l.gross, deductions: +l.deductions, taxes: +l.taxes, net: +l.net })),
    [lines],
  );
  const je = useMemo(() => buildJournalPreview(computations), [computations]);

  const status = run?.status ?? "draft";
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const currentStep = status === "posted" ? 3 : status === "approved" ? 2 : 1;

  // ── Audit (server-side filters + pagination, RLS-enforced) ───
  const [auditAction, setAuditAction] = useState<"all" | "grant" | "revoke">("all");
  const [auditRole, setAuditRole] = useState<string>("");
  const [auditPage, setAuditPage] = useState(1);
  const { data: auditPayload } = usePayrollRunAudit(run?.id ?? null, {
    action: auditAction, role: auditRole, page: auditPage, pageSize: AUDIT_PAGE_SIZE,
  });
  const auditView = auditPayload?.rows ?? [];
  const auditTotal = auditPayload?.total ?? 0;
  const auditPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));

  // ── Export preview state ────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState<null | "csv" | "pdf">(null);


  if (!run) return null;

  const canGenerate = canDo(perms, "create_payroll_run") && status === "draft";
  const canApprove = canDo(perms, "approve_payroll_run") && status === "draft" && lines.length > 0;
  const canPost = canDo(perms, "execute_payroll") && status === "approved" && je.balanced;
  const canExport = canDo(perms, "export");

  // ── Action handlers with explicit loading toasts ────────────
  // Hook fires success/error; we add a loading indicator and friendly balance error.
  const runWithToast = async (label: string, fn: () => Promise<unknown>) => {
    const tid = toast.loading(label);
    try {
      await fn();
      toast.dismiss(tid);
    } catch (e) {
      const msg = (e as Error).message || "Erreur";
      if (/balanced|équilibr|debit|credit/i.test(msg)) {
        toast.error("Comptabilisation refusée : l'écriture SYSCOHADA n'est pas équilibrée.", { id: tid });
      } else {
        toast.dismiss(tid); // hook onError already toasted
      }
    }
  };

  // Export bodies are inlined in PayrollExportPreviewDialog.onConfirm below.


  const exportTip = actionTooltip(perms, "export", "Exporter les lignes");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Cycle de paie · <span className="font-mono">{run.period}</span>
            <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
            {status === "posted" && <Lock className="w-3.5 h-3.5 text-success" />}
          </DialogTitle>
        </DialogHeader>

        {/* Timeline */}
        <div className="flex items-center gap-2 text-[11px] py-2 border-y border-border">
          {TIMELINE.map((t, idx) => {
            const reached = idx + 1 <= currentStep;
            const Icon = t.icon;
            return (
              <div key={t.key} className="flex-1 flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full grid place-items-center border ${reached ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-muted"}`}>
                  <Icon className="w-3 h-3" />
                </div>
                <span className={reached ? "font-medium" : "text-muted-foreground"}>{t.label}</span>
                {idx < TIMELINE.length - 1 && <div className={`flex-1 h-px ${idx + 1 < currentStep ? "bg-primary" : "bg-border"}`} />}
              </div>
            );
          })}
        </div>

        <Tabs defaultValue="details" className="mt-2">
          <TabsList className="grid grid-cols-4 h-8">
            <TabsTrigger value="details" className="text-xs">Détails</TabsTrigger>
            <TabsTrigger value="lines" className="text-xs">Lignes ({lines.length})</TabsTrigger>
            <TabsTrigger value="preview" className="text-xs">Aperçu écriture</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Audit ({auditTotal})</TabsTrigger>
          </TabsList>

          {/* DETAILS */}
          <TabsContent value="details" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Info label="Période" value={run.period} mono />
              <Info label="Date de paie" value={run.pay_date} mono />
              <Info label="Effectif" value={String(run.employee_count)} />
              <Info label="Brut" value={`${maskAmount(perms, +run.gross_total)} XOF`} />
              <Info label="Net" value={`${maskAmount(perms, +run.net_total)} XOF`} />
              <Info label="Statut" value={meta.label} />
              {run.approved_by && <Info label="Approuvé le" value={run.approved_at?.slice(0, 16).replace("T", " ") ?? "—"} />}
              {run.executed_by && <Info label="Comptabilisé le" value={run.executed_at?.slice(0, 16).replace("T", " ") ?? "—"} />}
            </div>

            {run.notes && (
              <div className="text-[11px] text-muted-foreground border border-border rounded-md p-2 font-mono whitespace-pre-wrap">
                {run.notes}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm" variant="outline" className="h-8 text-xs gap-1"
                disabled={!canGenerate || generate.isPending}
                title={canGenerate ? "Régénère les lignes pour tous les employés actifs" : actionTooltip(perms, "create_payroll_run")}
                onClick={() => runWithToast(
                  "Génération des lignes…",
                  () => generate.mutateAsync(run.id),
                )}
              >
                {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                {generate.isPending ? "Génération…" : "Générer les lignes"}
              </Button>

              <ConfirmButton
                disabled={!canApprove || approve.isPending}
                loading={approve.isPending}
                label="Approuver"
                icon={FileCheck2}
                title={canApprove ? "Verrouille les lignes et autorise la comptabilisation" : actionTooltip(perms, "approve_payroll_run", "Aucune ligne à approuver")}
                confirmTitle="Approuver ce cycle ?"
                confirmDesc="L'approbation marque le cycle comme prêt à comptabiliser. Vous ne pourrez plus régénérer les lignes."
                onConfirm={() => runWithToast(
                  "Approbation du cycle…",
                  () => approve.mutateAsync(run.id),
                )}
              />

              <ConfirmButton
                disabled={!canPost || post.isPending}
                loading={post.isPending}
                label="Comptabiliser"
                icon={Hammer}
                variant="default"
                title={
                  !canDo(perms, "execute_payroll") ? actionTooltip(perms, "execute_payroll")
                  : status !== "approved" ? "Le cycle doit être approuvé"
                  : !je.balanced ? `Écriture déséquilibrée — D ${je.totalDebit} / C ${je.totalCredit}`
                  : "Génère l'écriture SYSCOHADA (DR 661/663 — CR 421/431/447) et verrouille le cycle"
                }
                confirmTitle="Comptabiliser ce cycle ?"
                confirmDesc={`Une écriture équilibrée de ${je.totalDebit.toLocaleString("fr-FR")} XOF sera créée. Action irréversible.`}
                onConfirm={() => runWithToast(
                  "Comptabilisation en cours…",
                  () => post.mutateAsync(run.id),
                )}
              />
            </div>

            {status === "approved" && !je.balanced && (
              <Alert variant="destructive" className="mt-2">
                <XCircle className="w-4 h-4" />
                <AlertTitle className="text-xs">Comptabilisation bloquée</AlertTitle>
                <AlertDescription className="text-[11px]">
                  L'écriture prévisualisée est déséquilibrée (D {je.totalDebit.toLocaleString("fr-FR")} / C {je.totalCredit.toLocaleString("fr-FR")}).
                  Vérifiez les lignes générées avant de relancer.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* LINES */}
          <TabsContent value="lines" className="mt-3 space-y-2">
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                disabled={!canExport || lines.length === 0}
                title={exportTip}
                onClick={() => setPreviewOpen("csv")}
              >
                {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                disabled={!canExport || lines.length === 0}
                title={exportTip}
                onClick={() => setPreviewOpen("pdf")}
              >
                {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} PDF
              </Button>
              <Button
                size="sm" variant="default" className="h-7 text-[11px] gap-1"
                disabled={!canExport || lines.length === 0}
                title={canExport ? "Récapitulatif PDF (KPI + lignes + écriture)" : exportTip}
                onClick={() => {
                  try { exportPayrollRunRecapPDF(run, lines, perms); }
                  catch (e) { toast.error((e as Error).message); }
                }}
              >
                {canExport ? <FileText className="w-3 h-3" /> : <Lock className="w-3 h-3" />} Récap
              </Button>
            </div>

            {linesLoading ? (
              <p className="text-xs text-muted-foreground py-6 text-center flex items-center justify-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Chargement des lignes…
              </p>
            ) : lines.length === 0 ? (
              <Alert>
                <AlertTitle className="text-xs">Aucune ligne</AlertTitle>
                <AlertDescription className="text-[11px]">
                  Cliquez sur « Générer les lignes » pour calculer la paie de tous les employés actifs.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="overflow-auto max-h-[40vh] border border-border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr className="border-b border-border">
                      <Th>Employé</Th>
                      <Th className="text-right">Brut</Th>
                      <Th className="text-right">CNPS (6,3 %)</Th>
                      <Th className="text-right">IRPP (10 %)</Th>
                      <Th className="text-right">Net</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-border/50">
                        <td className="px-3 py-1.5 font-mono text-[11px]">{l.employee_id.slice(0, 8)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{maskAmount(perms, +l.gross)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{maskAmount(perms, +l.deductions)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{maskAmount(perms, +l.taxes)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{maskAmount(perms, +l.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* JE PREVIEW */}
          <TabsContent value="preview" className="mt-3 space-y-3">
            {lines.length === 0 ? (
              <Alert>
                <AlertTitle className="text-xs">Rien à prévisualiser</AlertTitle>
                <AlertDescription className="text-[11px]">Générez d'abord les lignes de paie.</AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert variant={je.balanced ? "default" : "destructive"}>
                  {je.balanced ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <AlertTitle className="text-xs">
                    {je.balanced ? "Écriture équilibrée" : "Écriture DÉSÉQUILIBRÉE — la comptabilisation sera refusée"}
                  </AlertTitle>
                  <AlertDescription className="text-[11px] font-mono">
                    Total Débit : {je.totalDebit.toLocaleString("fr-FR")} XOF · Total Crédit : {je.totalCredit.toLocaleString("fr-FR")} XOF
                    {!je.balanced && ` · Écart : ${(je.totalDebit - je.totalCredit).toLocaleString("fr-FR")} XOF`}
                  </AlertDescription>
                </Alert>

                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr className="border-b border-border">
                        <Th>Compte</Th><Th>Libellé</Th>
                        <Th className="text-right">Débit</Th><Th className="text-right">Crédit</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {je.lines.map((l, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="px-3 py-1.5 font-mono text-primary">{l.account}</td>
                          <td className="px-3 py-1.5">{l.label}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{l.debit ? maskAmount(perms, l.debit) : "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{l.credit ? maskAmount(perms, l.credit) : "—"}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-semibold">
                        <td colSpan={2} className="px-3 py-2 text-right">Totaux</td>
                        <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, je.totalDebit)}</td>
                        <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, je.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <ShieldCheck className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  Aperçu calculé côté client (mirror du moteur SQL). L'écriture définitive est générée par
                  <code className="mx-1 px-1 bg-muted rounded">post_payroll_run</code>
                  et vérifiée par <code className="mx-1 px-1 bg-muted rounded">enforce_balanced_entry</code>.
                </p>
              </>
            )}
          </TabsContent>

          {/* AUDIT */}
          <TabsContent value="audit" className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={auditAction} onValueChange={(v) => { setAuditAction(v as "all" | "grant" | "revoke"); setAuditPage(1); }}>
                <SelectTrigger className="h-7 text-[11px] w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes actions</SelectItem>
                  <SelectItem value="grant">Attribution</SelectItem>
                  <SelectItem value="revoke">Révocation</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={auditRole}
                onChange={(e) => { setAuditRole(e.target.value); setAuditPage(1); }}
                placeholder="Filtrer par rôle…"
                className="h-7 text-[11px] w-44"
              />
              <span className="text-[11px] text-muted-foreground ml-auto">
                {auditTotal} événement(s)
              </span>
            </div>

            {auditView.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                Aucun événement d'audit ne correspond.
              </p>
            ) : (
              <div className="space-y-1.5">
                {auditView.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px] border border-border rounded-md px-2 py-1.5">
                    <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                    <span className="font-mono">{a.role}</span>
                    <span className="text-muted-foreground ml-auto">{a.created_at.slice(0, 16).replace("T", " ")}</span>
                  </div>
                ))}
              </div>
            )}

            {auditPages > 1 && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-3 h-3" /> Préc.
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Page {auditPage} / {auditPages}
                </span>
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                  disabled={auditPage >= auditPages}
                  onClick={() => setAuditPage((p) => Math.min(auditPages, p + 1))}
                >
                  Suiv. <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>

      <PayrollExportPreviewDialog
        open={previewOpen !== null}
        onOpenChange={(v) => !v && setPreviewOpen(null)}
        format={previewOpen === "pdf" ? "PDF" : "CSV"}
        title={`Lignes de paie — ${run.period}`}
        perms={perms}
        balanced={lines.length === 0 ? undefined : je.balanced}
        totalDebit={je.totalDebit}
        totalCredit={je.totalCredit}
        columns={[
          { key: "employee_id", header: "Employé" },
          { key: "gross", header: "Brut" },
          { key: "deductions", header: "CNPS" },
          { key: "taxes", header: "IRPP" },
          { key: "net", header: "Net" },
        ]}
        rows={lines.map((l) => ({
          employee_id: l.employee_id.slice(0, 8),
          gross: maskAmount(perms, +l.gross),
          deductions: maskAmount(perms, +l.deductions),
          taxes: maskAmount(perms, +l.taxes),
          net: maskAmount(perms, +l.net),
        }))}
        onConfirm={() => {
          if (previewOpen === "csv") {
            const view = canDo(perms, "view_sensitive");
            exportToCSV(
              lines.map((l: PayrollLine) => ({
                employee_id: l.employee_id,
                gross: view ? l.gross : 0,
                deductions: view ? l.deductions : 0,
                taxes: view ? l.taxes : 0,
                net: view ? l.net : 0,
              })),
              [
                { key: "employee_id", header: "Employé" },
                { key: "gross", header: "Brut" },
                { key: "deductions", header: "CNPS" },
                { key: "taxes", header: "IRPP" },
                { key: "net", header: "Net" },
              ],
              `payroll-${run.period}-lines`,
            );
          } else if (previewOpen === "pdf") {
            exportToPDF<PayrollLine>({
              filename: `payroll-${run.period}-lines`,
              title: `Lignes de paie — ${run.period}`,
              subtitle: `Date paie ${run.pay_date} · Statut ${meta.label} · ${lines.length} ligne(s)`,
              columns: [
                { key: "employee_id", header: "Employé", format: (r) => r.employee_id.slice(0, 8) },
                { key: "gross", header: "Brut", format: (r) => maskAmount(perms, +r.gross) },
                { key: "deductions", header: "CNPS", format: (r) => maskAmount(perms, +r.deductions) },
                { key: "taxes", header: "IRPP", format: (r) => maskAmount(perms, +r.taxes) },
                { key: "net", header: "Net", format: (r) => maskAmount(perms, +r.net) },
              ],
              rows: lines,
            });
          }
        }}
      />
    </Dialog>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-border rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs" : "text-xs"}>{value}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider ${className}`}>{children}</th>;
}

function ConfirmButton({
  disabled, loading, label, icon: Icon, variant = "outline", title, confirmTitle, confirmDesc, onConfirm,
}: {
  disabled: boolean; loading?: boolean; label: string; icon: typeof Play;
  variant?: "default" | "outline";
  title: string; confirmTitle: string; confirmDesc: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant} className="h-8 text-xs gap-1" disabled={disabled} title={title}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
          {loading ? `${label}…` : label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirmer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
