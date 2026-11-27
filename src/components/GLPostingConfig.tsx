import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { BookOpen, Clock, Users, AlertTriangle, Settings, CheckCircle, XCircle, Pause, Play, RotateCcw, History, Eye, Undo2, FileText, Shield, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ─── Types ─── */
export interface GLBatch {
  id: string;
  date: string;
  module: string;
  type: string;
  entries: number;
  totalDebit: number;
  totalCredit: number;
  journal: string;
  status: "Pending" | "Validated" | "Posted" | "Rejected" | "Cancelled" | "Reversed";
  createdBy: string;
  approvedBy?: string;
  postedAt?: string;
  reversedAt?: string;
  reversedBy?: string;
}

export interface GLAuditEntry {
  id: string;
  batchId: string;
  timestamp: string;
  action: "Created" | "Submitted" | "Approved" | "Rejected" | "Posted" | "Cancelled" | "Reversed" | "Rollback";
  user: string;
  details: string;
  hash: string;
  prevHash: string;
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

/* ─── GL Posting Configuration Panel (for Settings pages) ─── */
export function GLBatchHistory({ batches, onPost, onCancel, readOnly = false }: {
  batches: GLBatch[];
  onPost?: (id: string) => void;
  onCancel?: (id: string) => void;
  /** Lots réels (V38) : consultation seule ; une écriture se contre-passe une à une, pas un lot. */
  readOnly?: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? batches : batches.filter(b => b.status === filter);

  const statusBadge = (s: string) => {
    switch (s) {
      case "Posted": return "success";
      case "Validated": return "info";
      case "Pending": return "warning";
      case "Rejected": return "error";
      case "Cancelled": return "error";
      default: return "info";
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <BookOpen className="size-4 shrink-0 text-primary" />
            Lots comptables
          </CardTitle>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <select
              aria-label="Filtrer les lots comptables par statut"
              className="h-11 max-w-full rounded border border-input bg-background px-3 text-base sm:h-7 sm:px-2 sm:text-[10px]"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">Tous les statuts</option>
              <option value="Pending">En attente</option>
              <option value="Validated">Validated</option>
              <option value="Posted">Comptabilisé</option>
              <option value="Rejected">Rejeté</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <Badge variant="outline" className="text-[10px]">{filtered.length} batches</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Batch ID", "Date", "Type", "Entries", "Total Debit", "Total Credit", "Journal", "Created By", "Approved By", "Status", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <tr key={b.id} className="border-b border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-primary">{b.id}</td>
                  <td className="px-3 py-2 tabular-nums">{b.date}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{b.type}</Badge></td>
                  <td className="px-3 py-2 text-center tabular-nums">{b.entries}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(b.totalDebit)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(b.totalCredit)}</td>
                  <td className="px-3 py-2 font-mono">{b.journal}</td>
                  <td className="px-3 py-2">{b.createdBy}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.approvedBy || "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={statusBadge(b.status)} label={b.status} /></td>
                  <td className="px-3 py-2">
                    {readOnly ? <span className="text-[10px] text-muted-foreground">{b.approvedBy ? "clôturé" : "ouvert"}</span> : (
                    <div className="flex items-center gap-1">
                      {b.status === "Validated" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={() => onPost?.(b.id)}>
                          <Play className="w-3 h-3" /> Comptabiliser
                        </Button>
                      )}
                      {(b.status === "Pending" || b.status === "Validated") && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive gap-1" onClick={() => onCancel?.(b.id)}>
                          <XCircle className="w-3 h-3" /> Annuler
                        </Button>
                      )}
                    </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-6 text-muted-foreground">Aucun lot</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── No more mock audit trail — data comes from gl_audit_logs table ─── */

/* ─── GL Audit History Component ─── */
export function GLAuditHistory({ 
  batches, 
  auditTrail = [],
  onRollback 
}: { 
  batches: GLBatch[];
  auditTrail?: GLAuditEntry[];
  onRollback?: (batchId: string) => void;
}) {
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [viewDetail, setViewDetail] = useState<GLAuditEntry | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<string | null>(null);

  const batchAudit = selectedBatch 
    ? auditTrail.filter(a => a.batchId === selectedBatch).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    : auditTrail.slice(0, 15);

  const postedBatches = batches.filter(b => b.status === "Posted");

  const actionIcon = (action: GLAuditEntry["action"]) => {
    switch (action) {
      case "Created": return <FileText className="w-3 h-3 text-muted-foreground" />;
      case "Submitted": return <Clock className="w-3 h-3 text-amber-600" />;
      case "Approved": return <CheckCircle className="w-3 h-3 text-primary" />;
      case "Rejected": return <XCircle className="w-3 h-3 text-destructive" />;
      case "Posted": return <BookOpen className="w-3 h-3 text-success" />;
      case "Cancelled": return <XCircle className="w-3 h-3 text-destructive" />;
      case "Reversed": return <RotateCcw className="w-3 h-3 text-amber-600" />;
      case "Rollback": return <Undo2 className="w-3 h-3 text-destructive" />;
      default: return <History className="w-3 h-3" />;
    }
  };

  const handleRollback = (batchId: string) => {
    setRollbackConfirm(null);
    onRollback?.(batchId);
  };

  return (
    <>
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Piste d'audit des lots comptables
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="h-7 px-2 rounded border border-input bg-background text-[10px]"
                value={selectedBatch || ""}
                onChange={e => setSelectedBatch(e.target.value || null)}
              >
                <option value="">Toute l'activité récente</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>{b.id} — {b.type}</option>
                ))}
              </select>
              <Badge variant="outline" className="text-[10px] gap-1">
                <Shield className="w-2.5 h-2.5" /> SHA-256 Secured
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border bg-muted/30">
                  {["Timestamp", "Batch ID", "Action", "User", "Details", "Hash Chain", "Actions"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batchAudit.map((entry, i) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[10px] tabular-nums whitespace-nowrap">{entry.timestamp}</td>
                    <td className="px-3 py-2 font-mono text-primary">{entry.batchId}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {actionIcon(entry.action)}
                        <span className={cn("font-medium",
                          entry.action === "Posted" && "text-success",
                          entry.action === "Rejected" && "text-destructive",
                          entry.action === "Reversed" && "text-amber-600"
                        )}>{entry.action}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{entry.user}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{entry.details}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Hash className="w-2.5 h-2.5 text-muted-foreground" />
                        <span className="font-mono text-[9px] text-muted-foreground" title={entry.hash}>{entry.hash?.slice(0, 12)}…</span>
                        {i > 0 && <span className="text-[8px] text-muted-foreground">← {entry.prevHash}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5" onClick={() => setViewDetail(entry)}>
                          <Eye className="w-2.5 h-2.5" />
                        </Button>
                        {entry.action === "Posted" && (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-5 text-[9px] px-1.5 text-amber-600 hover:text-amber-700" 
                            onClick={() => setRollbackConfirm(entry.batchId)}
                          >
                            <Undo2 className="w-2.5 h-2.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {batchAudit.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Aucune entrée d'audit</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!viewDetail} onOpenChange={() => setViewDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" />
              Détail de l'entrée d'audit
            </DialogTitle>
            <DialogDescription className="text-xs">
              Enregistrement d'audit inaltérable, chaîné par empreinte
            </DialogDescription>
          </DialogHeader>
          {viewDetail && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Identifiant</Label>
                  <div className="font-mono">{viewDetail.id}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">N° de lot</Label>
                  <div className="font-mono text-primary">{viewDetail.batchId}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Timestamp</Label>
                  <div className="font-mono tabular-nums">{viewDetail.timestamp}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Action</Label>
                  <div className="flex items-center gap-1.5">
                    {actionIcon(viewDetail.action)}
                    <span className="font-medium">{viewDetail.action}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Utilisateur</Label>
                  <div>{viewDetail.user}</div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Détails</Label>
                <div className="p-2 bg-muted/30 rounded text-foreground">{viewDetail.details}</div>
              </div>
              <div className="space-y-1 pt-2 border-t border-border">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Hash Chain Verification
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-muted/30 rounded">
                    <div className="text-[9px] text-muted-foreground mb-0.5">Current Hash</div>
                    <div className="font-mono text-[10px] break-all">{viewDetail.hash}</div>
                  </div>
                  <div className="p-2 bg-muted/30 rounded">
                    <div className="text-[9px] text-muted-foreground mb-0.5">Empreinte précédente</div>
                    <div className="font-mono text-[10px]">{viewDetail.prevHash}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setViewDetail(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation */}
      <AlertDialog open={!!rollbackConfirm} onOpenChange={() => setRollbackConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm flex items-center gap-2">
              <Undo2 className="w-4 h-4 text-amber-600" />
              Confirmer l'annulation du lot
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Cette action contrepasse toutes les écritures du lot <span className="font-mono font-medium text-foreground">{rollbackConfirm}</span> and 
              create compensating entries. This action is audited and cannot be undone without a new posting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Annuler</AlertDialogCancel>
            <AlertDialogAction 
              className="text-xs bg-amber-600 hover:bg-amber-700"
              onClick={() => rollbackConfirm && handleRollback(rollbackConfirm)}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Confirmer l'annulation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── GL Posting KPI Summary (for Dashboard) ─── */
export function GLPostingKPIs({ batches }: { batches: GLBatch[] }) {
  const pending = batches.filter(b => b.status === "Pending").length;
  const validated = batches.filter(b => b.status === "Validated").length;
  const posted = batches.filter(b => b.status === "Posted").length;
  const rejected = batches.filter(b => b.status === "Rejected").length;
  const totalPosted = batches.filter(b => b.status === "Posted").reduce((s, b) => s + b.totalDebit, 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {[
        { label: "Lots en attente", value: pending, icon: Clock, color: "text-amber-600" },
        { label: "Validated", value: validated, icon: CheckCircle, color: "text-primary" },
        { label: "Comptabilisés", value: posted, icon: BookOpen, color: "text-success" },
        { label: "Rejeté", value: rejected, icon: XCircle, color: "text-destructive" },
        { label: "Total comptabilisé (XOF)", value: fmt(totalPosted), icon: BookOpen, color: "text-foreground" },
      ].map(kpi => (
        <div key={kpi.label} className="bg-card rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{kpi.label}</span>
            <kpi.icon className={cn("w-3.5 h-3.5", kpi.color)} />
          </div>
          <div className={cn("text-lg font-semibold tabular-nums", kpi.color)}>{kpi.value}</div>
        </div>
      ))}
    </div>
  );
}



/* ─── Default GL Posting Settings per module ─── */
