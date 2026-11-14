import { useState, useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, CreditCard, FileText, Bell, Calculator, Globe, BookOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostingAccountsPanel } from "@/components/PostingAccountsPanel";
import {
  useARPaymentTerms, useUpsertARPaymentTerm,
  useARNumberingSeries, useUpdateARNumberingSeries,
  useARDunningRules, useUpsertARDunningRule,
  useARGeneralSettings, useUpdateARGeneralSettings,
  useARNotificationRules, useUpsertARNotificationRule, useToggleARNotificationRule, useDeleteARPaymentTerm, useDeleteARDunningRule, useDeleteARNotificationRule } from "@/hooks/use-ar-data";

const tabs = [
  { id: "general", label: "General", icon: Settings },
  { id: "glposting", label: "Comptabilisation", icon: BookOpen },
  { id: "payment", label: "Payment Terms", icon: CreditCard },
  { id: "numbering", label: "Numbering", icon: FileText },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "dunning", label: "Dunning Rules", icon: Calculator },
  { id: "currency", label: "Currency", icon: Globe },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

function GeneralTab() {
  const { data, isLoading } = useARGeneralSettings();
  const update = useUpdateARGeneralSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-2xl">
      <h3 className="text-sm font-semibold text-foreground">General Settings</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Default Payment Term Code</Label>
          <Input className="h-9 text-xs" value={form.default_payment_term_code || ""} onChange={e => setForm((f: any) => ({ ...f, default_payment_term_code: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Default Currency</Label>
          <Input className="h-9 text-xs" value={form.default_currency || ""} onChange={e => setForm((f: any) => ({ ...f, default_currency: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Credit Limit Default (XOF)</Label>
          <Input type="number" className="h-9 text-xs" value={form.default_credit_limit ?? ""} onChange={e => setForm((f: any) => ({ ...f, default_credit_limit: parseFloat(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Auto-numbering</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs" value={form.auto_numbering ? "1" : "0"} onChange={e => setForm((f: any) => ({ ...f, auto_numbering: e.target.value === "1" }))}>
            <option value="1">Enabled</option><option value="0">Disabled</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Late Payment Interest (%)</Label>
          <Input type="number" step="0.1" className="h-9 text-xs" value={form.late_payment_interest_pct ?? ""} onChange={e => setForm((f: any) => ({ ...f, late_payment_interest_pct: parseFloat(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Grace Period (days)</Label>
          <Input type="number" className="h-9 text-xs" value={form.grace_period_days ?? ""} onChange={e => setForm((f: any) => ({ ...f, grace_period_days: parseInt(e.target.value) || 0 }))} />
        </div>
      </div>
      <Button size="sm" className="text-xs" disabled={update.isPending} onClick={() => update.mutate(form)}>
        {update.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Changes"}
      </Button>
    </div>
  );
}

function PaymentTermsTab() {
  const remove = useDeleteARPaymentTerm();
  const { data: terms = [], isLoading } = useARPaymentTerms();
  const upsert = useUpsertARPaymentTerm();
  const [editing, setEditing] = useState<any>(null);
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="p-3 border-b border-border flex justify-between items-center">
        <h3 className="text-sm font-semibold text-foreground">Payment Terms</h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing({ code: "", label: "", days: 30, discount_percent: 0, is_active: true })}>+ Add Term</Button>
      </div>
      {isLoading ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Code", "Label", "Days", "Discount %", "Active", "Actions"].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
          </tr></thead>
          <tbody>
            {terms.map(t => (
              <tr key={t.id} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-mono">{t.code}</td>
                <td className="px-3 py-2 font-medium">{t.label}</td>
                <td className="px-3 py-2">{t.days}</td>
                <td className="px-3 py-2">{t.discount_percent}%</td>
                <td className="px-3 py-2">{t.is_active ? <span className="text-success">●</span> : <span className="text-muted-foreground">●</span>}</td>
                <td className="px-3 py-2 flex gap-1"><Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditing(t)}>Modifier</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Supprimer le terme ${t.code} ?`)) remove.mutate(t.id); }}>Supprimer</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <div className="p-4 border-t border-border bg-muted/10 grid grid-cols-5 gap-2 items-end">
          <div><Label className="text-[10px]">Code</Label><Input className="h-8 text-xs" value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })} /></div>
          <div><Label className="text-[10px]">Label</Label><Input className="h-8 text-xs" value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} /></div>
          <div><Label className="text-[10px]">Days</Label><Input type="number" className="h-8 text-xs" value={editing.days} onChange={e => setEditing({ ...editing, days: parseInt(e.target.value) || 0 })} /></div>
          <div><Label className="text-[10px]">Discount %</Label><Input type="number" step="0.1" className="h-8 text-xs" value={editing.discount_percent} onChange={e => setEditing({ ...editing, discount_percent: parseFloat(e.target.value) || 0 })} /></div>
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-xs" onClick={async () => { await upsert.mutateAsync(editing); setEditing(null); }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberingTab() {
  const { data: series = [], isLoading } = useARNumberingSeries();
  const update = useUpdateARNumberingSeries();
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="p-3 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Document Numbering Series</h3></div>
      {isLoading ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Type", "Prefix", "Format", "Next #", "Reset", "Actions"].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
          </tr></thead>
          <tbody>
            {series.map(n => editId === n.id ? (
              <tr key={n.id} className="border-b border-border bg-muted/10">
                <td className="px-3 py-2 font-medium">{n.doc_type}</td>
                <td className="px-3 py-2"><Input className="h-7 text-xs font-mono" value={draft.prefix} onChange={e => setDraft({ ...draft, prefix: e.target.value })} /></td>
                <td className="px-3 py-2"><Input className="h-7 text-xs font-mono" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value })} /></td>
                <td className="px-3 py-2"><Input type="number" className="h-7 text-xs" value={draft.next_number} onChange={e => setDraft({ ...draft, next_number: parseInt(e.target.value) || 0 })} /></td>
                <td className="px-3 py-2">
                  <select className="h-7 text-xs border border-input rounded px-2 bg-background" value={draft.reset_frequency} onChange={e => setDraft({ ...draft, reset_frequency: e.target.value })}>
                    <option value="yearly">Yearly</option><option value="monthly">Monthly</option><option value="never">Never</option>
                  </select>
                </td>
                <td className="px-3 py-2 flex gap-1">
                  <Button size="sm" className="h-6 text-[10px]" onClick={async () => { await update.mutateAsync({ id: n.id, ...draft }); setEditId(null); }}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditId(null)}>Cancel</Button>
                </td>
              </tr>
            ) : (
              <tr key={n.id} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{n.doc_type}</td>
                <td className="px-3 py-2 font-mono">{n.prefix}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{n.format}</td>
                <td className="px-3 py-2 font-mono">{n.next_number}</td>
                <td className="px-3 py-2">{n.reset_frequency}</td>
                <td className="px-3 py-2"><Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setEditId(n.id); setDraft(n); }}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DunningTab() {
  const remove = useDeleteARDunningRule();
  const { data: rules = [], isLoading } = useARDunningRules();
  const upsert = useUpsertARDunningRule();
  const [editing, setEditing] = useState<any>(null);
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="p-3 border-b border-border flex justify-between">
        <h3 className="text-sm font-semibold text-foreground">Dunning Levels</h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing({ level: rules.length + 1, days_overdue: 0, action: "", fee_amount: 0, template: "", is_active: true })}>+ Add Level</Button>
      </div>
      {isLoading ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Level", "Days Overdue", "Action", "Late Fee (XOF)", "Template", "Actions"].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
          </tr></thead>
          <tbody>
            {rules.map(d => (
              <tr key={d.id} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">Level {d.level}</td>
                <td className="px-3 py-2">{d.days_overdue}+</td>
                <td className="px-3 py-2">{d.action}</td>
                <td className="px-3 py-2 font-mono">{fmt(d.fee_amount)}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.template}</td>
                <td className="px-3 py-2 flex gap-1"><Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditing(d)}>Modifier</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Supprimer le niveau ${d.level} ?`)) remove.mutate(d.id); }}>Supprimer</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <div className="p-4 border-t border-border bg-muted/10 grid grid-cols-6 gap-2 items-end">
          <div><Label className="text-[10px]">Level</Label><Input type="number" className="h-8 text-xs" value={editing.level} onChange={e => setEditing({ ...editing, level: parseInt(e.target.value) || 1 })} /></div>
          <div><Label className="text-[10px]">Days Overdue</Label><Input type="number" className="h-8 text-xs" value={editing.days_overdue} onChange={e => setEditing({ ...editing, days_overdue: parseInt(e.target.value) || 0 })} /></div>
          <div><Label className="text-[10px]">Action</Label><Input className="h-8 text-xs" value={editing.action} onChange={e => setEditing({ ...editing, action: e.target.value })} /></div>
          <div><Label className="text-[10px]">Fee (XOF)</Label><Input type="number" className="h-8 text-xs" value={editing.fee_amount} onChange={e => setEditing({ ...editing, fee_amount: parseFloat(e.target.value) || 0 })} /></div>
          <div><Label className="text-[10px]">Template</Label><Input className="h-8 text-xs" value={editing.template || ""} onChange={e => setEditing({ ...editing, template: e.target.value })} /></div>
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-xs" onClick={async () => { await upsert.mutateAsync(editing); setEditing(null); }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsTab() {
  const remove = useDeleteARNotificationRule();
  const { data: rules = [], isLoading } = useARNotificationRules();
  const upsert = useUpsertARNotificationRule();
  const toggle = useToggleARNotificationRule();
  const [editing, setEditing] = useState<any>(null);
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="p-3 border-b border-border flex justify-between">
        <h3 className="text-sm font-semibold text-foreground">Notification Rules</h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing({ trigger_condition: "", channel: "email", recipients: "", is_active: true })}>+ New Rule</Button>
      </div>
      {isLoading ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin" /></div> : (
        <div className="divide-y divide-border">
          {rules.length === 0 && <p className="p-4 text-xs text-muted-foreground text-center">Aucune règle configurée</p>}
          {rules.map(r => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-foreground">{r.trigger_condition}</div>
                <div className="text-[10px] text-muted-foreground">{r.channel} → {r.recipients} · {r.trigger_count} déclenchements</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => toggle.mutate({ id: r.id, is_active: !r.is_active })}>{r.is_active ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditing(r)}>Modifier</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" disabled={remove.isPending}
                  onClick={() => { if (window.confirm("Supprimer cette règle ?")) remove.mutate(r.id); }}>Supprimer</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div className="p-4 border-t border-border bg-muted/10 grid grid-cols-4 gap-2 items-end">
          <div className="col-span-2"><Label className="text-[10px]">Trigger Condition</Label><Input className="h-8 text-xs" value={editing.trigger_condition} onChange={e => setEditing({ ...editing, trigger_condition: e.target.value })} /></div>
          <div><Label className="text-[10px]">Channel</Label>
            <select className="w-full h-8 text-xs border border-input rounded px-2 bg-background" value={editing.channel} onChange={e => setEditing({ ...editing, channel: e.target.value })}>
              <option value="email">Email</option><option value="sms">SMS</option><option value="email+sms">Email + SMS</option><option value="in-app">In-app</option>
            </select>
          </div>
          <div><Label className="text-[10px]">Recipients</Label><Input className="h-8 text-xs" value={editing.recipients} onChange={e => setEditing({ ...editing, recipients: e.target.value })} /></div>
          <div className="col-span-4 flex gap-1">
            <Button size="sm" className="h-7 text-xs" onClick={async () => { await upsert.mutateAsync(editing); setEditing(null); }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ARSettings() {
  const [activeTab, setActiveTab] = useState("general");
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Accounts Receivable", href: "/receivables" }, { label: "Settings" }]} />
      <GuidanceBanner title="AR Module Settings" description="Configure payment terms, document numbering, dunning rules, notifications and currency settings for the Accounts Receivable module." />
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      {activeTab === "general" && <GeneralTab />}
      {activeTab === "glposting" && <div className="max-w-4xl"><PostingAccountsPanel modules={["AR", "TRE"]} /></div>}
      {activeTab === "payment" && <PaymentTermsTab />}
      {activeTab === "numbering" && <NumberingTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "dunning" && <DunningTab />}
      {activeTab === "currency" && (
        <div className="bg-card border border-border rounded-lg p-5 max-w-2xl text-xs text-muted-foreground">
          Configuration multi-devises à venir — devise de base : XOF (CFA Franc BCEAO).
        </div>
      )}
    </PageShell>
  );
}
