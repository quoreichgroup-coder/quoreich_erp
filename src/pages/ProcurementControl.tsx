import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Clock, ThumbsUp, ThumbsDown, MessageSquare, Loader2, Download, History, Lock } from "lucide-react";
import {
  useThreeWayMatch, useProcurementKpis, useApprovalQueue, useApproveStep, useRejectStep,
  useRecordMatchDecision, useProcurementSLA, useProcurementAudit, useMyProcurementRoles,
} from "@/hooks/use-procurement-data";
import { useProcurementSettings } from "@/hooks/use-procurement-data";
import { Input } from "@/components/ui/input";


const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n ?? 0);

const statusBadge = (s: string) => {
  if (s === "matched") return <Badge className="bg-success text-success-foreground"><CheckCircle2 className="w-3 h-3 mr-1" />Match</Badge>;
  if (s === "discrepancy") return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Écart</Badge>;
  return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />En attente</Badge>;
};

// ── 3WM Decision Dialog ──
function MatchDecisionDialog({ po, decision, onClose }: { po: any | null; decision: "accepted" | "revision_requested"; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const mut = useRecordMatchDecision();
  if (!po) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision === "accepted" ? "Accepter le match" : "Demander révision"} — {po.po_number}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          <div>PO Total: <span className="font-mono">{fmt(po.po_total)}</span></div>
          <div>GR Valeur: <span className="font-mono">{fmt(po.gr_value)}</span></div>
          <div>AP Valeur: <span className="font-mono">{fmt(po.ap_value)}</span></div>
          <Label className="text-xs mt-2 block">Motif {decision === "accepted" ? "(obligatoire)" : "(détails)"}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Justification..." />
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!reason || mut.isPending}
            onClick={async () => { await mut.mutateAsync({ po_id: po.po_id, decision, reason }); onClose(); }}>
            {mut.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Approval Decision Dialog ──
function ApprovalDialog({ row, action, onClose }: { row: any | null; action: "approve" | "reject"; onClose: () => void }) {
  const [comment, setComment] = useState("");
  const approve = useApproveStep();
  const reject = useRejectStep();
  if (!row) return null;
  const isReject = action === "reject";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isReject ? "Rejeter" : "Approuver"} {row.doc_type} — {row.level_label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          <div>Montant: <span className="font-mono">{fmt(row.amount)} XOF</span></div>
          <Label className="text-xs">Commentaire {isReject ? "(obligatoire)" : "(optionnel)"}</Label>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Annuler</Button>
          <Button size="sm" variant={isReject ? "destructive" : "default"}
            disabled={(isReject && !comment) || approve.isPending || reject.isPending}
            onClick={async () => {
              if (isReject) await reject.mutateAsync({ id: row.id, comment });
              else await approve.mutateAsync({ id: row.id, comment: comment || undefined });
              onClose();
            }}>
            {(approve.isPending || reject.isPending) && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            {isReject ? "Rejeter" : "Approuver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──
export default function ProcurementControl() {
  const [filter, setFilter] = useState<"all" | "discrepancy" | "matched" | "pending">("all");
  const { data: rows, isLoading } = useThreeWayMatch(filter);
  const { data: kpis } = useProcurementKpis();
  const { data: approvals, isLoading: loadingAppr } = useApprovalQueue(undefined, "pending");
  const { data: sla, isLoading: loadingSLA } = useProcurementSLA();
  const { data: settings } = useProcurementSettings();
  const { data: perms } = useMyProcurementRoles();

  const [matchAction, setMatchAction] = useState<{ po: any; decision: "accepted" | "revision_requested" } | null>(null);
  const [approvalAction, setApprovalAction] = useState<{ row: any; action: "approve" | "reject" } | null>(null);
  const [auditFilters, setAuditFilters] = useState<{ dateFrom?: string; dateTo?: string; eventType?: string }>({ eventType: "all" });
  const { data: audit, isLoading: loadingAudit } = useProcurementAudit(auditFilters);

  // SLA thresholds (hours/days)
  const SLA_PR_HOURS = Number(settings?.sla_pr_hours ?? 48);
  const SLA_PO_HOURS = Number(settings?.sla_pr_to_po_hours ?? 24);
  const SLA_GR_DAYS = Number(settings?.sla_po_to_gr_days ?? 14);
  const SLA_AP_DAYS = Number(settings?.sla_gr_to_ap_days ?? 7);


  const canApproveLevel = (n: number) =>
    n <= 1 ? !!perms?.canApproveL1 : n === 2 ? !!perms?.canApproveL2 : !!perms?.canApproveL3;

  const exportSLA = () => {
    const headers = ["PR", "PO", "PR cycle (h)", "PR→PO (h)", "PO→GR (j)", "GR→AP (j)", "Alertes",
      `Seuils: PR=${SLA_PR_HOURS}h | PR→PO=${SLA_PO_HOURS}h | PO→GR=${SLA_GR_DAYS}j | GR→AP=${SLA_AP_DAYS}j`];
    const lines = [headers.slice(0,7).join(",")];
    (sla ?? []).forEach((r: any) => {
      const breaches: string[] = [];
      if (r.pr_cycle_hours != null && r.pr_cycle_hours > SLA_PR_HOURS) breaches.push("PR");
      if (r.pr_to_po_hours != null && r.pr_to_po_hours > SLA_PO_HOURS) breaches.push("PR→PO");
      if (r.po_to_gr_days != null && r.po_to_gr_days > SLA_GR_DAYS) breaches.push("PO→GR");
      if (r.gr_to_ap_days != null && r.gr_to_ap_days > SLA_AP_DAYS) breaches.push("GR→AP");
      lines.push([
        r.pr_number ?? "", r.po_number ?? "",
        r.pr_cycle_hours ?? "", r.pr_to_po_hours ?? "",
        r.po_to_gr_days ?? "", r.gr_to_ap_days ?? "",
        breaches.join("|") || "OK",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    lines.push("");
    lines.push(`# ${headers[7]}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `procurement-sla-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };


  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Control" }]} />
      <GuidanceBanner title="Procurement Control"
        description="3-Way Match, file d'approbation PR/PO multi-niveaux, SLA cycle PR→PO→GR→AP." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Procurement Control</h1>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">PR ouvertes</div>
          <div className="text-xl font-bold">{kpis?.pr_open ?? 0}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">PO en attente</div>
          <div className="text-xl font-bold">{kpis?.po_pending ?? 0}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">À approuver</div>
          <div className="text-xl font-bold text-amber-600">{approvals?.length ?? 0}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Écarts 3WM</div>
          <div className="text-xl font-bold text-destructive">{kpis?.tw_discrepancies ?? 0}</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="threeway">
        <TabsList>
          <TabsTrigger value="threeway">3-Way Match</TabsTrigger>
          <TabsTrigger value="approvals">Approbations ({approvals?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="sla">SLA Cycle</TabsTrigger>
          <TabsTrigger value="audit"><History className="w-3 h-3 mr-1" />Audit</TabsTrigger>
        </TabsList>


        {/* 3-Way Match Tab */}
        <TabsContent value="threeway">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">PO ↔ GR ↔ AP — tolérance {settings?.three_way_tolerance_pct ?? 2}%</CardTitle>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
                <TabsList>
                  <TabsTrigger value="all">Tous</TabsTrigger>
                  <TabsTrigger value="discrepancy">Écarts</TabsTrigger>
                  <TabsTrigger value="matched">Matchés</TabsTrigger>
                  <TabsTrigger value="pending">En attente</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {isLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !rows || rows.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">Aucune ligne</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>PO</TableHead><TableHead>Fournisseur</TableHead>
                    <TableHead className="text-right">PO</TableHead><TableHead className="text-right">GR</TableHead>
                    <TableHead className="text-right">AP</TableHead><TableHead className="text-right">Écart GR/AP</TableHead>
                    <TableHead>Statut</TableHead><TableHead>Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.po_id}>
                        <TableCell className="font-mono text-xs">{r.po_number}</TableCell>
                        <TableCell className="text-xs">{r.supplier_name ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(r.po_total)}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(r.gr_value)}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(r.ap_value)}</TableCell>
                        <TableCell className={`text-right text-xs ${Math.abs(r.gr_vs_ap_diff) > 0 ? "text-destructive" : ""}`}>{fmt(r.gr_vs_ap_diff)}</TableCell>
                        <TableCell>{statusBadge(r.match_status)}</TableCell>
                        <TableCell>
                          {r.match_status === "discrepancy" && (
                            perms?.can3WM ? (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                                  onClick={() => setMatchAction({ po: r, decision: "accepted" })}>
                                  <ThumbsUp className="w-3 h-3 mr-1" />Accepter
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-amber-600"
                                  onClick={() => setMatchAction({ po: r, decision: "revision_requested" })}>
                                  <MessageSquare className="w-3 h-3 mr-1" />Révision
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                                <Lock className="w-3 h-3" />Rôle 3WM requis
                              </span>
                            )
                          )}
                        </TableCell>

                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approval Queue Tab */}
        <TabsContent value="approvals">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">File d'approbation PR / PO</CardTitle></CardHeader>
            <CardContent className="p-4 pt-2">
              {loadingAppr ? (
                <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !approvals || approvals.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">Aucune approbation en attente</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Type</TableHead><TableHead>Niveau</TableHead><TableHead>Approbateur</TableHead>
                    <TableHead className="text-right">Montant</TableHead><TableHead>SLA</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {approvals.map((a: any) => {
                      const overdue = new Date(a.sla_due_at) < new Date();
                      return (
                        <TableRow key={a.id}>
                          <TableCell><Badge variant="outline" className="text-[10px]">{a.doc_type}</Badge></TableCell>
                          <TableCell className="text-xs font-medium">{a.level_label}</TableCell>
                          <TableCell className="text-xs">{a.approver_role}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{fmt(a.amount)}</TableCell>
                          <TableCell className={`text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {new Date(a.sla_due_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                          </TableCell>
                          <TableCell>
                            {canApproveLevel(a.level_order) ? (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-success"
                                  onClick={() => setApprovalAction({ row: a, action: "approve" })}>
                                  <ThumbsUp className="w-3 h-3 mr-1" />Approuver
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive"
                                  onClick={() => setApprovalAction({ row: a, action: "reject" })}>
                                  <ThumbsDown className="w-3 h-3 mr-1" />Rejeter
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                                <Lock className="w-3 h-3" />Rôle L{a.level_order}+ requis
                              </span>
                            )}
                          </TableCell>

                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SLA Tab */}
        <TabsContent value="sla">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-sm">Cycle time PR → PO → GR → AP</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Seuils : PR {SLA_PR_HOURS}h · PR→PO {SLA_PO_HOURS}h · PO→GR {SLA_GR_DAYS}j · GR→AP {SLA_AP_DAYS}j
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="ghost" className="h-7 text-[11px]">
                  <a href="/procurement/settings">Configurer SLA…</a>
                </Button>
                <Button size="sm" variant="outline" onClick={exportSLA} disabled={!sla || sla.length === 0}>
                  <Download className="w-3 h-3 mr-1" />Export CSV
                </Button>
              </div>

            </CardHeader>

            <CardContent className="p-4 pt-2">
              {loadingSLA ? (
                <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !sla || sla.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">Aucune donnée</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>PR</TableHead><TableHead>PO</TableHead>
                    <TableHead className="text-right">PR cycle (h)</TableHead>
                    <TableHead className="text-right">PR→PO (h)</TableHead>
                    <TableHead className="text-right">PO→GR (j)</TableHead>
                    <TableHead className="text-right">GR→AP (j)</TableHead>
                    <TableHead>Alerte</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {sla.map((r: any) => {
                      const breaches: string[] = [];
                      if (r.pr_cycle_hours != null && r.pr_cycle_hours > SLA_PR_HOURS) breaches.push("PR");
                      if (r.pr_to_po_hours != null && r.pr_to_po_hours > SLA_PO_HOURS) breaches.push("PR→PO");
                      if (r.po_to_gr_days != null && r.po_to_gr_days > SLA_GR_DAYS) breaches.push("PO→GR");
                      if (r.gr_to_ap_days != null && r.gr_to_ap_days > SLA_AP_DAYS) breaches.push("GR→AP");
                      const cell = (val: number | null, breach: boolean) =>
                        <TableCell className={`text-right text-xs font-mono ${breach ? "text-destructive font-semibold" : ""}`}>
                          {val == null ? "—" : Number(val).toFixed(1)}
                        </TableCell>;
                      return (
                        <TableRow key={r.po_id}>
                          <TableCell className="font-mono text-xs">{r.pr_number ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.po_number}</TableCell>
                          {cell(r.pr_cycle_hours, r.pr_cycle_hours > SLA_PR_HOURS)}
                          {cell(r.pr_to_po_hours, r.pr_to_po_hours > SLA_PO_HOURS)}
                          {cell(r.po_to_gr_days, r.po_to_gr_days > SLA_GR_DAYS)}
                          {cell(r.gr_to_ap_days, r.gr_to_ap_days > SLA_AP_DAYS)}
                          <TableCell>
                            {breaches.length > 0
                              ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />{breaches.join(", ")}</Badge>
                              : <Badge className="bg-success text-success-foreground text-[10px]">OK</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Trail Tab */}
        <TabsContent value="audit">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Journal d'audit — actions procurement</CardTitle>
                <p className="text-[11px] text-muted-foreground">Approbations, rejets, conversions PR→PO, décisions 3-Way Match.</p>
              </div>
              <div className="flex gap-2 items-end">
                <div>
                  <Label className="text-[10px]">Du</Label>
                  <Input type="date" className="h-7 text-xs" value={auditFilters.dateFrom ?? ""}
                    onChange={(e) => setAuditFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Au</Label>
                  <Input type="date" className="h-7 text-xs" value={auditFilters.dateTo ?? ""}
                    onChange={(e) => setAuditFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Événement</Label>
                  <select className="h-7 text-xs border rounded px-2 bg-background"
                    value={auditFilters.eventType ?? "all"}
                    onChange={(e) => setAuditFilters((f) => ({ ...f, eventType: e.target.value }))}>
                    <option value="all">Tous</option>
                    <option value="approval_approved">Approuvée</option>
                    <option value="approval_rejected">Rejetée</option>
                    <option value="approval_assigned">Assignée</option>
                    <option value="match_accepted">3WM acceptée</option>
                    <option value="match_revision_requested">3WM révision</option>
                    <option value="pr_converted_to_po">PR→PO</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {loadingAudit ? (
                <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : !audit || audit.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">Aucun événement</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Événement</TableHead><TableHead>Document</TableHead>
                    <TableHead>Niveau</TableHead><TableHead className="text-right">Montant</TableHead>
                    <TableHead>Utilisateur</TableHead><TableHead>Commentaire</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {audit.map((e: any) => (
                      <TableRow key={`${e.event_type}-${e.id}-${e.event_at}`}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(e.event_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{e.event_type}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.doc_number ?? "—"}</TableCell>
                        <TableCell className="text-xs">{e.level_label}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmt(e.amount)}</TableCell>
                        <TableCell className="text-xs">{e.actor_name || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={e.comment ?? ""}>
                          {e.comment ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      <MatchDecisionDialog po={matchAction?.po ?? null} decision={matchAction?.decision ?? "accepted"} onClose={() => setMatchAction(null)} />
      <ApprovalDialog row={approvalAction?.row ?? null} action={approvalAction?.action ?? "approve"} onClose={() => setApprovalAction(null)} />
    </PageShell>
  );
}
