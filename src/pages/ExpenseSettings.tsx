import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ModulePostingSettings, PostingPendingNotice } from "@/components/AccountSets";
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

      </div>

      <PostingPendingNotice module="notes de frais" />

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
