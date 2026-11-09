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
export interface GLPostingSettings {
  module: string;
  batchMode: "individual" | "consolidated";
  frequency: "immediate" | "daily" | "weekly" | "monthly";
  targetJournal: string;
  approvalWorkflow: boolean;
  approvalLevels: { level: string; role: string; threshold: string }[];
  alertThresholds: { rule: string; threshold: string; action: string; severity: "Critical" | "Warning" | "Info" }[];
  autoPost: boolean;
  lastRun?: string;
  nextRun?: string;
}

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
export function GLPostingConfigPanel({ config, onSave }: { config: GLPostingSettings; onSave?: (c: GLPostingSettings) => void }) {
  const [settings, setSettings] = useState(config);

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            GL Posting Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Batch Mode</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                value={settings.batchMode}
                onChange={e => setSettings({ ...settings, batchMode: e.target.value as any })}
              >
                <option value="individual">Individual — Post each transaction separately</option>
                <option value="consolidated">Consolidated — Group by period/type</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Posting Frequency</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                value={settings.frequency}
                onChange={e => setSettings({ ...settings, frequency: e.target.value as any })}
              >
                <option value="immediate">Immediate — On validation</option>
                <option value="daily">Daily — End of day batch</option>
                <option value="weekly">Weekly — Every Friday</option>
                <option value="monthly">Monthly — Period close</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target GL Journal</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                value={settings.targetJournal}
                onChange={e => setSettings({ ...settings, targetJournal: e.target.value })}
              >
                <option value="VJ">VJ — Sales Journal</option>
                <option value="AJ">AJ — Purchase Journal</option>
                <option value="CJ">CJ — Cash Journal</option>
                <option value="GJ">GJ — General Journal</option>
                <option value="FAJ">FAJ — Fixed Assets Journal</option>
                <option value="BJ">BJ — Budget Journal</option>
                <option value="PJ">PJ — Project Journal</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auto-Post on Approval</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={settings.autoPost}
                  onCheckedChange={v => setSettings({ ...settings, autoPost: v })}
                />
                <span className="text-xs text-muted-foreground">{settings.autoPost ? "Enabled" : "Manual posting required"}</span>
              </div>
            </div>
          </div>

          {settings.lastRun && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3">
              <span>Last batch: <span className="font-medium text-foreground">{settings.lastRun}</span></span>
              {settings.nextRun && <span>Next scheduled: <span className="font-medium text-foreground">{settings.nextRun}</span></span>}
            </div>
          )}

          <Button size="sm" className="text-xs" onClick={() => onSave?.(settings)}>Save GL Posting Settings</Button>
        </CardContent>
      </Card>

      {/* Approval Workflow */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Posting Approval Workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Switch
              checked={settings.approvalWorkflow}
              onCheckedChange={v => setSettings({ ...settings, approvalWorkflow: v })}
            />
            <span className="text-xs">{settings.approvalWorkflow ? "Multi-level approval enabled" : "Direct posting (no approval)"}</span>
          </div>
          {settings.approvalWorkflow && settings.approvalLevels.map((lvl, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded border border-border bg-muted/20 text-xs">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">{lvl.level}</div>
              <div className="flex-1">
                <div className="font-medium">{lvl.role}</div>
                <div className="text-muted-foreground">{lvl.threshold}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Alert Thresholds */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" />
            Posting Alert Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-2">
          {settings.alertThresholds.map((t, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded border border-border text-xs">
              <Badge variant={t.severity === "Critical" ? "destructive" : t.severity === "Warning" ? "secondary" : "outline"} className="text-[10px]">{t.severity}</Badge>
              <div className="flex-1">
                <div className="font-medium">{t.rule}</div>
                <div className="text-muted-foreground">{t.action}</div>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]">Edit</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="text-xs mt-2">+ Add Alert Rule</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── GL Batch History Table (for Transaction pages) ─── */
export function GLBatchHistory({ batches, onPost, onCancel }: {
  batches: GLBatch[];
  onPost?: (id: string) => void;
  onCancel?: (id: string) => void;
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
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            GL Posting Batches
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              className="h-7 px-2 rounded border border-input bg-background text-[10px]"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Validated">Validated</option>
              <option value="Posted">Posted</option>
              <option value="Rejected">Rejected</option>
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
                    <div className="flex items-center gap-1">
                      {b.status === "Validated" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={() => onPost?.(b.id)}>
                          <Play className="w-3 h-3" /> Post
                        </Button>
                      )}
                      {(b.status === "Pending" || b.status === "Validated") && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive gap-1" onClick={() => onCancel?.(b.id)}>
                          <XCircle className="w-3 h-3" /> Cancel
                        </Button>
                      )}
                      {b.status === "Posted" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1">
                          <RotateCcw className="w-3 h-3" /> Reverse
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1">
                        <History className="w-3 h-3" /> Audit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-6 text-muted-foreground">No batches found</td></tr>
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
              GL Batch Audit Trail
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="h-7 px-2 rounded border border-input bg-background text-[10px]"
                value={selectedBatch || ""}
                onChange={e => setSelectedBatch(e.target.value || null)}
              >
                <option value="">All Recent Activity</option>
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
                        <span className="font-mono text-[9px] text-muted-foreground">{entry.hash}</span>
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
                  <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No audit entries found</td></tr>
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
              Audit Entry Detail
            </DialogTitle>
            <DialogDescription className="text-xs">
              Immutable audit record secured by hash chain
            </DialogDescription>
          </DialogHeader>
          {viewDetail && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Entry ID</Label>
                  <div className="font-mono">{viewDetail.id}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Batch ID</Label>
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
                  <Label className="text-[10px] text-muted-foreground">User</Label>
                  <div>{viewDetail.user}</div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Details</Label>
                <div className="p-2 bg-muted/30 rounded text-foreground">{viewDetail.details}</div>
              </div>
              <div className="space-y-1 pt-2 border-t border-border">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Hash Chain Verification
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-muted/30 rounded">
                    <div className="text-[9px] text-muted-foreground mb-0.5">Current Hash</div>
                    <div className="font-mono text-[10px]">{viewDetail.hash}</div>
                  </div>
                  <div className="p-2 bg-muted/30 rounded">
                    <div className="text-[9px] text-muted-foreground mb-0.5">Previous Hash</div>
                    <div className="font-mono text-[10px]">{viewDetail.prevHash}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setViewDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation */}
      <AlertDialog open={!!rollbackConfirm} onOpenChange={() => setRollbackConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm flex items-center gap-2">
              <Undo2 className="w-4 h-4 text-amber-600" />
              Confirm Batch Rollback
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This will reverse all GL entries from batch <span className="font-mono font-medium text-foreground">{rollbackConfirm}</span> and 
              create compensating entries. This action is audited and cannot be undone without a new posting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="text-xs bg-amber-600 hover:bg-amber-700"
              onClick={() => rollbackConfirm && handleRollback(rollbackConfirm)}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Confirm Rollback
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
        { label: "Pending Batches", value: pending, icon: Clock, color: "text-amber-600" },
        { label: "Validated", value: validated, icon: CheckCircle, color: "text-primary" },
        { label: "Posted to GL", value: posted, icon: BookOpen, color: "text-success" },
        { label: "Rejected", value: rejected, icon: XCircle, color: "text-destructive" },
        { label: "Total Posted (XOF)", value: fmt(totalPosted), icon: BookOpen, color: "text-foreground" },
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
export const defaultGLPostingSettings: Record<string, GLPostingSettings> = {
  AR: {
    module: "AR",
    batchMode: "consolidated",
    frequency: "daily",
    targetJournal: "VJ",
    approvalWorkflow: true,
    autoPost: true,
    lastRun: "2026-03-07 18:00",
    nextRun: "2026-03-08 18:00",
    approvalLevels: [
      { level: "L1", role: "AR Clerk", threshold: "< 10M XOF" },
      { level: "L2", role: "AR Manager", threshold: "10M – 50M XOF" },
      { level: "L3", role: "CFO", threshold: "> 50M XOF" },
    ],
    alertThresholds: [
      { rule: "Batch total > 100M XOF", threshold: "100,000,000", action: "Notify CFO for review", severity: "Warning" },
      { rule: "Unmatched credit notes > 5", threshold: "5", action: "Block posting until resolution", severity: "Critical" },
      { rule: "Customer credit limit exceeded", threshold: "Client specific", action: "Flag for AR Manager", severity: "Warning" },
    ],
  },
  AP: {
    module: "AP",
    batchMode: "consolidated",
    frequency: "daily",
    targetJournal: "AJ",
    approvalWorkflow: true,
    autoPost: true,
    lastRun: "2026-03-07 18:00",
    nextRun: "2026-03-08 18:00",
    approvalLevels: [
      { level: "L1", role: "AP Clerk", threshold: "< 5M XOF" },
      { level: "L2", role: "Finance Manager", threshold: "5M – 25M XOF" },
      { level: "L3", role: "CFO", threshold: "> 25M XOF" },
    ],
    alertThresholds: [
      { rule: "Invoice > budget allocation", threshold: "100%", action: "Block and notify budget controller", severity: "Critical" },
      { rule: "Batch total > 50M XOF", threshold: "50,000,000", action: "Require L2 approval", severity: "Warning" },
      { rule: "Duplicate supplier invoice detected", threshold: "N/A", action: "Hold for manual review", severity: "Critical" },
    ],
  },
  Treasury: {
    module: "Treasury",
    batchMode: "consolidated",
    frequency: "daily",
    targetJournal: "CJ",
    approvalWorkflow: true,
    autoPost: false,
    lastRun: "2026-03-07 23:00",
    nextRun: "2026-03-08 23:00",
    approvalLevels: [
      { level: "L1", role: "Treasury Analyst", threshold: "All transactions" },
      { level: "L2", role: "Treasury Manager", threshold: "> 20M XOF" },
    ],
    alertThresholds: [
      { rule: "Unreconciled items > 48h", threshold: "48h", action: "Alert Treasury Manager", severity: "Warning" },
      { rule: "FX gain/loss > 5M XOF", threshold: "5,000,000", action: "Notify CFO", severity: "Warning" },
      { rule: "Bank balance mismatch > 1%", threshold: "1%", action: "Block GL posting", severity: "Critical" },
    ],
  },
  Assets: {
    module: "Assets",
    batchMode: "consolidated",
    frequency: "monthly",
    targetJournal: "FAJ",
    approvalWorkflow: true,
    autoPost: true,
    lastRun: "2026-03-01 06:00",
    nextRun: "2026-04-01 06:00",
    approvalLevels: [
      { level: "L1", role: "Asset Manager", threshold: "Depreciation runs" },
      { level: "L2", role: "Head of Department", threshold: "Acquisitions < 50M" },
      { level: "L3", role: "CFO", threshold: "Acquisitions > 50M / Disposals / Revaluations" },
    ],
    alertThresholds: [
      { rule: "Asset NBV = 0 still in service", threshold: "N/A", action: "Flag for review", severity: "Info" },
      { rule: "Acquisition > budget", threshold: "Budget line", action: "Block and escalate", severity: "Critical" },
      { rule: "Depreciation variance > 5%", threshold: "5%", action: "Alert accountant", severity: "Warning" },
    ],
  },
  Budget: {
    module: "Budget",
    batchMode: "consolidated",
    frequency: "monthly",
    targetJournal: "BJ",
    approvalWorkflow: true,
    autoPost: false,
    lastRun: "2026-03-01 09:00",
    nextRun: "2026-04-01 09:00",
    approvalLevels: [
      { level: "L1", role: "Department Head", threshold: "< 5% revision" },
      { level: "L2", role: "CFO", threshold: "5-15% revision" },
      { level: "L3", role: "Board", threshold: "> 15% revision" },
    ],
    alertThresholds: [
      { rule: "Budget utilization > 90%", threshold: "90%", action: "Warning to department head", severity: "Warning" },
      { rule: "Budget utilization > 100%", threshold: "100%", action: "Block commitments", severity: "Critical" },
      { rule: "Forecast deviation > 10%", threshold: "10%", action: "Notify CFO", severity: "Warning" },
    ],
  },
  Projects: {
    module: "Projects",
    batchMode: "consolidated",
    frequency: "weekly",
    targetJournal: "PJ",
    approvalWorkflow: true,
    autoPost: true,
    lastRun: "2026-03-07 18:00",
    nextRun: "2026-03-14 18:00",
    approvalLevels: [
      { level: "L1", role: "Project Manager", threshold: "All costs" },
      { level: "L2", role: "PMO Director", threshold: "Revenue recognition" },
      { level: "L3", role: "CFO", threshold: "WIP adjustments / closures" },
    ],
    alertThresholds: [
      { rule: "Project cost > budget", threshold: "100%", action: "Block and notify PM + CFO", severity: "Critical" },
      { rule: "Margin erosion > 5%", threshold: "5%", action: "Alert PMO", severity: "Warning" },
      { rule: "Revenue mismatch with AR", threshold: "Any", action: "Hold for reconciliation", severity: "Critical" },
    ],
  },
  Procurement: {
    module: "Procurement",
    batchMode: "individual",
    frequency: "immediate",
    targetJournal: "AJ",
    approvalWorkflow: true,
    autoPost: true,
    lastRun: "2026-03-07 18:00",
    nextRun: "On validation",
    approvalLevels: [
      { level: "L1", role: "Procurement Officer", threshold: "< 10M XOF" },
      { level: "L2", role: "Procurement Manager", threshold: "10M – 50M XOF" },
      { level: "L3", role: "CFO", threshold: "50M – 200M XOF" },
      { level: "L4", role: "CEO / Board", threshold: "> 200M XOF" },
    ],
    alertThresholds: [
      { rule: "PO amount > budget line", threshold: "Budget line", action: "Block PO creation", severity: "Critical" },
      { rule: "Supplier spend > contract limit", threshold: "Contract max", action: "Alert procurement manager", severity: "Warning" },
      { rule: "Delivery overdue > 7 days", threshold: "7 days", action: "Escalate to manager", severity: "Warning" },
    ],
  },
};
