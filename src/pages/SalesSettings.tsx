import { useState, useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { GLPostingConfigPanel, defaultGLPostingSettings } from "@/components/GLPostingConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Calculator, Clock, Loader2 } from "lucide-react";
import { useSalesSettings, useUpdateSalesSettings } from "@/hooks/use-sales-data";

export default function SalesSettings() {
  const { data: settings, isLoading } = useSalesSettings();
  const update = useUpdateSalesSettings();
  const [form, setForm] = useState({
    auto_invoice_on_delivery: true,
    reserve_stock_on_confirm: true,
    sla_quote_hours: 48,
    sla_quote_to_so_hours: 72,
    sla_so_to_dn_days: 7,
    sla_dn_to_invoice_days: 2,
    sla_warning_pct: 75,
    sla_critical_pct: 100,
    color_ok: "#16a34a",
    color_warning: "#f59e0b",
    color_critical: "#dc2626",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        auto_invoice_on_delivery: settings.auto_invoice_on_delivery,
        reserve_stock_on_confirm: settings.reserve_stock_on_confirm,
        sla_quote_hours: settings.sla_quote_hours,
        sla_quote_to_so_hours: settings.sla_quote_to_so_hours,
        sla_so_to_dn_days: settings.sla_so_to_dn_days,
        sla_dn_to_invoice_days: settings.sla_dn_to_invoice_days,
        sla_warning_pct: settings.sla_warning_pct,
        sla_critical_pct: settings.sla_critical_pct,
        color_ok: settings.color_ok,
        color_warning: settings.color_warning,
        color_critical: settings.color_critical,
      });
    }
  }, [settings]);

  const save = () => update.mutate(form);

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Settings" }]} />
      <GuidanceBanner
        title="Sales Settings"
        description="Workflow d'auto-facturation, seuils SLA, mapping GL et règles de posting."
      />

      <h1 className="text-lg font-semibold text-foreground">Sales Settings</h1>

      <Tabs defaultValue="general">
        <TabsList className="mb-3">
          <TabsTrigger value="general" className="gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            Général
          </TabsTrigger>
          <TabsTrigger value="sla" className="gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            SLA
          </TabsTrigger>
          <TabsTrigger value="gl" className="gap-1.5">
            <Calculator className="w-3.5 h-3.5" />
            GL Mapping
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Workflow Ventes</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-4 max-w-xl">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">
                        Auto-facturation sur livraison
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Génère automatiquement la facture client à la validation du BL.
                      </p>
                    </div>
                    <Switch
                      checked={form.auto_invoice_on_delivery}
                      onCheckedChange={(v) =>
                        setForm((f) => ({ ...f, auto_invoice_on_delivery: v }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">
                        Réservation de stock à la confirmation
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Bloque les quantités disponibles dès la confirmation du SO.
                      </p>
                    </div>
                    <Switch
                      checked={form.reserve_stock_on_confirm}
                      onCheckedChange={(v) =>
                        setForm((f) => ({ ...f, reserve_stock_on_confirm: v }))
                      }
                    />
                  </div>
                  <Button size="sm" onClick={save} disabled={update.isPending}>
                    {update.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Seuils SLA</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Configure les délais cibles du cycle Quote → SO → DN → Facture.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field
                  label="Quote (h)"
                  value={form.sla_quote_hours}
                  onChange={(v) => setForm((f) => ({ ...f, sla_quote_hours: v }))}
                />
                <Field
                  label="Quote → SO (h)"
                  value={form.sla_quote_to_so_hours}
                  onChange={(v) => setForm((f) => ({ ...f, sla_quote_to_so_hours: v }))}
                />
                <Field
                  label="SO → DN (j)"
                  value={form.sla_so_to_dn_days}
                  onChange={(v) => setForm((f) => ({ ...f, sla_so_to_dn_days: v }))}
                />
                <Field
                  label="DN → Facture (j)"
                  value={form.sla_dn_to_invoice_days}
                  onChange={(v) => setForm((f) => ({ ...f, sla_dn_to_invoice_days: v }))}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field
                  label="% Warning"
                  value={form.sla_warning_pct}
                  onChange={(v) => setForm((f) => ({ ...f, sla_warning_pct: v }))}
                />
                <Field
                  label="% Critique"
                  value={form.sla_critical_pct}
                  onChange={(v) => setForm((f) => ({ ...f, sla_critical_pct: v }))}
                />
                <ColorField
                  label="OK"
                  value={form.color_ok}
                  onChange={(v) => setForm((f) => ({ ...f, color_ok: v }))}
                />
                <ColorField
                  label="Warning"
                  value={form.color_warning}
                  onChange={(v) => setForm((f) => ({ ...f, color_warning: v }))}
                />
                <ColorField
                  label="Critique"
                  value={form.color_critical}
                  onChange={(v) => setForm((f) => ({ ...f, color_critical: v }))}
                />
              </div>
              <Button size="sm" onClick={save} disabled={update.isPending}>
                {update.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enregistrer SLA"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gl">
          <Card className="border-border">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="w-4 h-4 text-primary" />
                GL Account Mapping
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-2.5">
              {[
                { label: "Sales Revenue", account: "4000", desc: "Revenue from sales" },
                { label: "Accounts Receivable", account: "4110", desc: "Customer receivables" },
                { label: "COGS", account: "6010", desc: "Cost of Goods Sold" },
                { label: "Sales Tax (Output VAT)", account: "4310", desc: "VAT collected" },
              ].map((m) => (
                <div
                  key={m.account}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 text-xs"
                >
                  <div>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[10px] text-muted-foreground">{m.desc}</div>
                  </div>
                  <span className="font-mono text-primary font-medium">{m.account}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="mt-4">
            <GLPostingConfigPanel
              config={
                defaultGLPostingSettings.Sales || {
                  module: "Sales",
                  batchMode: "individual",
                  frequency: "immediate",
                  targetJournal: "VJ",
                  approvalWorkflow: true,
                  autoPost: true,
                  approvalLevels: [
                    { level: "L1", role: "Sales Manager", threshold: "All orders" },
                    { level: "L2", role: "Finance Controller", threshold: "> 50M XOF" },
                  ],
                  alertThresholds: [
                    {
                      rule: "Margin below threshold",
                      threshold: "20%",
                      action: "Alert sales manager",
                      severity: "Warning",
                    },
                    {
                      rule: "Credit limit exceeded",
                      threshold: "100%",
                      action: "Block order",
                      severity: "Critical",
                    },
                  ],
                }
              }
            />
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="h-8 text-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 rounded border border-input bg-background"
        />
        <Input
          className="h-8 text-xs font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
