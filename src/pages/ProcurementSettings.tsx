import { useState, useEffect } from "react";
import { ApprovalThresholdsEditor } from "@/components/ApprovalThresholdsEditor";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings, BookOpen, Users, Tag, Link, Scale, Timer, ShieldCheck } from "lucide-react";
import { ProcurementControlSettings } from "@/components/ProcurementControlSettings";
import { cn } from "@/lib/utils";
import { ModulePostingSettings, PostingPendingNotice } from "@/components/AccountSets";
import {
  useProcurementSettings,
  useUpdateProcurementSettings,
  useProcurementThresholds,
} from "@/hooks/use-procurement-data";

const tabs = [
  { id: "general", label: "Général", icon: Settings },
  { id: "controls", label: "Contrôles et suivi", icon: ShieldCheck },
  { id: "threeway", label: "Rapprochement à trois", icon: Scale },
  { id: "sla", label: "Délais cibles", icon: Timer },
  { id: "approval", label: "Niveaux d'approbation", icon: Users },
  { id: "glposting", label: "Comptabilisation", icon: BookOpen },
];




export default function ProcurementSettings() {
  const [activeTab, setActiveTab] = useState("general");
  const { data: settings } = useProcurementSettings();
  const update = useUpdateProcurementSettings();
  const { data: thresholds } = useProcurementThresholds();

  const [tolPct, setTolPct] = useState<number>(2);
  const [tolAmt, setTolAmt] = useState<number>(5000);
  const [reqPR, setReqPR] = useState(true);
  const [reqGR, setReqGR] = useState(true);

  // SLA
  const [slaPR, setSlaPR] = useState<number>(48);
  const [slaPRPO, setSlaPRPO] = useState<number>(24);
  const [slaPOGR, setSlaPOGR] = useState<number>(14);
  const [slaGRAP, setSlaGRAP] = useState<number>(7);
  const [warnPct, setWarnPct] = useState<number>(80);
  const [critPct, setCritPct] = useState<number>(100);
  const [colorOk, setColorOk] = useState<string>("#16a34a");
  const [colorWarn, setColorWarn] = useState<string>("#f59e0b");
  const [colorCrit, setColorCrit] = useState<string>("#dc2626");


  useEffect(() => {
    if (settings) {
      setTolPct(Number(settings.three_way_tolerance_pct ?? 2));
      setTolAmt(Number(settings.three_way_tolerance_amount ?? 5000));
      setReqPR(!!settings.require_pr_before_po);
      setReqGR(!!settings.require_gr_before_ap);
      setSlaPR(Number(settings.sla_pr_hours ?? 48));
      setSlaPRPO(Number(settings.sla_pr_to_po_hours ?? 24));
      setSlaPOGR(Number(settings.sla_po_to_gr_days ?? 14));
      setSlaGRAP(Number(settings.sla_gr_to_ap_days ?? 7));
      setWarnPct(Number(settings.sla_warning_pct ?? 80));
      setCritPct(Number(settings.sla_critical_pct ?? 100));
      setColorOk(settings.sla_color_ok ?? "#16a34a");
      setColorWarn(settings.sla_color_warning ?? "#f59e0b");
      setColorCrit(settings.sla_color_critical ?? "#dc2626");
    }
  }, [settings]);

  const save3WM = () => {
    if (!settings?.id) return;
    update.mutate({
      id: settings.id,
      three_way_tolerance_pct: tolPct,
      three_way_tolerance_amount: tolAmt,
      require_pr_before_po: reqPR,
      require_gr_before_ap: reqGR,
    });
  };

  const saveSLA = () => {
    if (!settings?.id) return;
    if (warnPct < 0 || warnPct > 100 || critPct < 0 || critPct > 200) {
      return; // basic guard
    }
    update.mutate({
      id: settings.id,
      sla_pr_hours: slaPR,
      sla_pr_to_po_hours: slaPRPO,
      sla_po_to_gr_days: slaPOGR,
      sla_gr_to_ap_days: slaGRAP,
      sla_warning_pct: warnPct,
      sla_critical_pct: critPct,
      sla_color_ok: colorOk,
      sla_color_warning: colorWarn,
      sla_color_critical: colorCrit,
    });
  };


  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Procurement", href: "/procurement" }, { label: "Settings" }]} />
      <GuidanceBanner title="Procurement Settings" description="Tolérances 3-Way Match, niveaux d'approbation PR/PO, catégories de dépenses." />

      <h1 className="text-lg font-semibold text-foreground mb-4">Procurement Settings</h1>

      <div className="flex gap-1 border-b border-border mb-4">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "controls" && <ProcurementControlSettings />}

      {activeTab === "general" && (
        <Card className="border-border max-w-2xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Règles de contrôle</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex items-center justify-between p-3 border border-border rounded">
              <div>
                <Label className="text-xs font-medium">Exiger une PR approuvée avant PO</Label>
                <p className="text-[11px] text-muted-foreground">Bloque la création/approbation d'un PO sans PR validée.</p>
              </div>
              <Switch checked={reqPR} onCheckedChange={setReqPR} aria-label="Exiger une PR approuvée avant PO" />
            </div>
            <div className="flex items-center justify-between p-3 border border-border rounded">
              <div>
                <Label className="text-xs font-medium">Exiger un GR avant facture AP</Label>
                <p className="text-[11px] text-muted-foreground">Empêche la saisie d'une facture sans réception préalable.</p>
              </div>
              <Switch checked={reqGR} onCheckedChange={setReqGR} aria-label="Exiger un GR avant facture AP" />
            </div>
            <Button size="sm" onClick={save3WM} disabled={update.isPending}>Enregistrer</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === "threeway" && (
        <Card className="border-border max-w-xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Tolérance 3-Way Match</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div>
              <Label className="text-xs">Tolérance (%)</Label>
              <Input type="number" step="0.1" value={tolPct} onChange={(e) => setTolPct(Number(e.target.value))} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Tolérance plancher (XOF)</Label>
              <Input type="number" value={tolAmt} onChange={(e) => setTolAmt(Number(e.target.value))} className="h-8 text-xs" />
              <p className="text-[11px] text-muted-foreground mt-1">La tolérance appliquée = max(plancher, total × %).</p>
            </div>
            <Button size="sm" onClick={save3WM} disabled={update.isPending}>Enregistrer</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === "sla" && (
        <Card className="border-border max-w-3xl">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Seuils SLA Procurement</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">PR — cycle (h)</Label>
                <Input type="number" min={1} value={slaPR} onChange={(e) => setSlaPR(Number(e.target.value))} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">PR → PO (h)</Label>
                <Input type="number" min={1} value={slaPRPO} onChange={(e) => setSlaPRPO(Number(e.target.value))} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">PO → GR (jours)</Label>
                <Input type="number" min={1} value={slaPOGR} onChange={(e) => setSlaPOGR(Number(e.target.value))} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">GR → AP (jours)</Label>
                <Input type="number" min={1} value={slaGRAP} onChange={(e) => setSlaGRAP(Number(e.target.value))} className="h-8 text-xs" />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium mb-2">Tolérances de coloration</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Seuil warning (% du SLA)</Label>
                  <Input type="number" min={0} max={100} value={warnPct} onChange={(e) => setWarnPct(Number(e.target.value))} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Seuil critique (% du SLA)</Label>
                  <Input type="number" min={0} max={200} value={critPct} onChange={(e) => setCritPct(Number(e.target.value))} className="h-8 text-xs" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Vert &lt; {warnPct}%, orange entre {warnPct}% et {critPct}%, rouge &gt; {critPct}% du temps cible.
              </p>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium mb-2">Couleurs</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">OK</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={colorOk} onChange={(e) => setColorOk(e.target.value)} className="h-8 w-12 p-1" />
                    <span className="text-[11px] font-mono">{colorOk}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Warning</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={colorWarn} onChange={(e) => setColorWarn(e.target.value)} className="h-8 w-12 p-1" />
                    <span className="text-[11px] font-mono">{colorWarn}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Critique</Label>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={colorCrit} onChange={(e) => setColorCrit(e.target.value)} className="h-8 w-12 p-1" />
                    <span className="text-[11px] font-mono">{colorCrit}</span>
                  </div>
                </div>
              </div>
            </div>

            <Button size="sm" onClick={saveSLA} disabled={update.isPending}>Enregistrer SLA</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === "approval" && <ApprovalThresholdsEditor kind="procurement" />}

      {activeTab === "glposting" && <ModulePostingSettings modules={["AP", "STK"]} kinds={["supplier", "item"]} />}


    </PageShell>
  );
}
