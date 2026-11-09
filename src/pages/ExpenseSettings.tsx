import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Settings, Calculator, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ExpenseRolesPanel } from "@/components/ExpenseRolesPanel";

export default function ExpenseSettings() {
  const [autoPost, setAutoPost] = useState(true);
  const [requireReceipt, setRequireReceipt] = useState(true);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Expenses", href: "/expenses" }, { label: "Settings" }]} />
      <GuidanceBanner title="Expense Settings" description="Configure approval workflows, expense limits, GL account mapping, and auto-posting rules." />

      <h1 className="text-lg font-semibold text-foreground">Expense Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4 text-primary" />General Configuration</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Receipt Required (default)</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch checked={requireReceipt} onCheckedChange={setRequireReceipt} />
                <span className="text-xs text-muted-foreground">{requireReceipt ? "Required for all amounts > 10K XOF" : "Optional"}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auto-post Reimbursements to GL</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch checked={autoPost} onCheckedChange={setAutoPost} />
                <span className="text-xs text-muted-foreground">{autoPost ? "Enabled" : "Manual posting"}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reimbursement Method</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs">
                <option>Bank Transfer</option>
                <option>Payroll Deduction</option>
                <option>Petty Cash</option>
              </select>
            </div>
            <Button size="sm" className="text-xs">Save Settings</Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" />GL Account Mapping</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-2.5">
            {[
              { label: "Travel Expenses", account: "6100", desc: "Flights, hotels, transport" },
              { label: "Meals & Entertainment", account: "6150", desc: "Client and team meals" },
              { label: "Office Supplies", account: "6200", desc: "Stationery, equipment" },
              { label: "Training", account: "6300", desc: "Certifications, courses" },
              { label: "Accounts Payable (Reimbursement)", account: "2010", desc: "AP for reimbursements" },
            ].map(m => (
              <div key={m.account} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 text-xs">
                <div><div className="font-medium">{m.label}</div><div className="text-[10px] text-muted-foreground">{m.desc}</div></div>
                <span className="font-mono text-primary font-medium">{m.account}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <GLPostingConfigPanel config={defaultGLPostingSettings.Expenses || {
        module: "Expenses",
        batchMode: "consolidated",
        frequency: "weekly",
        targetJournal: "GJ",
        approvalWorkflow: true,
        autoPost: true,
        approvalLevels: [
          { level: "L1", role: "Manager", threshold: "< 500K XOF" },
          { level: "L2", role: "Finance Controller", threshold: "> 500K XOF" },
        ],
        alertThresholds: [
          { rule: "Missing receipt", threshold: "> 10K XOF", action: "Block submission", severity: "Critical" },
          { rule: "Budget overrun > 90%", threshold: "90%", action: "Alert department head", severity: "Warning" },
        ],
      }} />

      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />Rôles & RBAC — Notes de frais
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <ExpenseRolesPanel />
        </CardContent>
      </Card>
    </PageShell>
  );
}
