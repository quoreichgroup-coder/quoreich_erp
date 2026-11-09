import { useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ShieldCheck, FileWarning, Download, FileText, Lock, History } from "lucide-react";
import { useAssets } from "@/hooks/use-asset-data";
import {
  useFixedAssetRoleAudit,
  useMyFixedAssetRoles,
  useAssetDisposals,
  useAssetKpis,
} from "@/hooks/use-fixed-assets-data";
import { actionTooltip, canDo, maskAmount } from "@/lib/fixed-assets-roles";
import { exportToCSV } from "@/lib/csv-export";
import { exportToPDF } from "@/lib/pdf-export";

export default function AssetsControl() {
  const perms = useMyFixedAssetRoles();
  const { data: assets = [], isLoading: la } = useAssets();
  const { data: disposals = [] } = useAssetDisposals();
  const { data: kpis } = useAssetKpis();
  const { data: audit = [], isLoading: lau } = useFixedAssetRoleAudit();

  const alerts = useMemo(() => {
    const out: { assetCode: string; type: string; message: string; severity: "critical" | "warning" | "info"; dueDate: string }[] = [];
    const today = new Date();
    (assets as any[]).forEach((a) => {
      if (Number(a.net_book_value) <= 0 && a.status === "active") {
        out.push({ assetCode: a.asset_code, type: "end_of_life", message: `${a.name} entièrement amorti — à reclasser`, severity: "warning", dueDate: today.toISOString().slice(0, 10) });
      }
      if (a.warranty_expiry) {
        const d = new Date(a.warranty_expiry);
        const days = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (days < 0) out.push({ assetCode: a.asset_code, type: "warranty", message: `Garantie expirée pour ${a.name}`, severity: "critical", dueDate: a.warranty_expiry });
        else if (days < 90) out.push({ assetCode: a.asset_code, type: "warranty", message: `Garantie expire dans ${days} jours — ${a.name}`, severity: "warning", dueDate: a.warranty_expiry });
      }
      if (a.next_maintenance) {
        const d = new Date(a.next_maintenance);
        const days = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (days < 0) out.push({ assetCode: a.asset_code, type: "maintenance", message: `Maintenance en retard — ${a.name}`, severity: "critical", dueDate: a.next_maintenance });
        else if (days < 30) out.push({ assetCode: a.asset_code, type: "maintenance", message: `Maintenance dans ${days} jours — ${a.name}`, severity: "warning", dueDate: a.next_maintenance });
      }
    });
    return out;
  }, [assets]);

  const integrityChecks = useMemo(() => {
    const overDep = (assets as any[]).filter((a) => Number(a.accumulated_depreciation) > Number(a.acquisition_cost) - Number(a.salvage_value || 0));
    const negNbv = (assets as any[]).filter((a) => Number(a.net_book_value) < 0);
    const pendingDisposals = (disposals as any[]).filter((d) => !d.journal_entry_id);
    return [
      { check: "VNC ≥ 0 pour les actifs", status: negNbv.length === 0 ? "Pass" : "Fail", details: negNbv.length === 0 ? `${assets.length} actifs vérifiés` : `${negNbv.length} actif(s) avec VNC négative` },
      { check: "Cumul ≤ (Coût − Résiduelle)", status: overDep.length === 0 ? "Pass" : "Fail", details: overDep.length === 0 ? "Aucun sur-amortissement" : `${overDep.length} sur-amortissement(s)` },
      { check: "Cessions comptabilisées (JE liée)", status: pendingDisposals.length === 0 ? "Pass" : "Warning", details: pendingDisposals.length === 0 ? "Toutes les cessions postées" : `${pendingDisposals.length} en attente` },
      { check: "KPIs registre cohérents", status: kpis && Math.abs((kpis.gross_value - kpis.accumulated) - kpis.net_book_value) < 1 ? "Pass" : "Warning", details: kpis ? `Brut − Cumul = VNC (${maskAmount(perms, kpis.net_book_value)})` : "KPIs indisponibles" },
    ];
  }, [assets, disposals, kpis, perms]);

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warnings = alerts.filter((a) => a.severity === "warning").length;
  const passed = integrityChecks.filter((c) => c.status === "Pass").length;

  const handleExport = () => {
    if (!canDo(perms, "export")) return;
    exportToCSV(
      (audit as any[]).map((r) => ({
        Date: r.created_at, Acteur: r.actor_user_id, Cible: r.target_user_id || "",
        Rôle: r.role || "", Action: r.action, Commentaire: r.details?.comment || "",
      })),
      [
        { key: "Date", header: "Date" }, { key: "Acteur", header: "Acteur" },
        { key: "Cible", header: "Utilisateur cible" }, { key: "Rôle", header: "Rôle" },
        { key: "Action", header: "Action" }, { key: "Commentaire", header: "Commentaire" },
      ],
      `assets-audit-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const handleExportPDF = () => {
    if (!canDo(perms, "export")) return;
    exportToPDF({
      filename: `assets-audit-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: "Piste d'audit RBAC — Immobilisations",
      subtitle: `${audit.length} évènement(s)`,
      columns: [
        { key: "Date", header: "Date", format: (r: any) => new Date(r.created_at).toLocaleString("fr-FR") },
        { key: "Acteur", header: "Acteur", format: (r: any) => String(r.actor_user_id || "").slice(0, 8) },
        { key: "Cible", header: "Cible", format: (r: any) => String(r.target_user_id || "").slice(0, 8) },
        { key: "Rôle", header: "Rôle", format: (r: any) => r.role || "" },
        { key: "Action", header: "Action", format: (r: any) => r.action },
        { key: "Commentaire", header: "Commentaire", format: (r: any) => r.details?.comment || "" },
      ],
      rows: audit as any[],
    });
  };

  const exportTooltip = actionTooltip(perms, "export", "Exporter la piste d'audit");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Fixed Assets", href: "/assets" }, { label: "Control" }]} />
      <GuidanceBanner title="Contrôle & Validation Immobilisations" description="Alertes maintenance / garantie, contrôles d'intégrité et piste d'audit RBAC." />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-foreground">Contrôle</h1>
        <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1.5"
          disabled={!canDo(perms, "export") || audit.length === 0}
          onClick={handleExport}
          aria-label={exportTooltip} title={exportTooltip}>
          {canDo(perms, "export") ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          Export audit CSV
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5"
          disabled={!canDo(perms, "export") || audit.length === 0}
          onClick={handleExportPDF}
          aria-label={exportTooltip} title={exportTooltip}>
          {canDo(perms, "export") ? <FileText className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          Export audit PDF
        </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Alertes critiques</div>
          <div className="text-xl font-bold text-destructive">{critical}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="w-3.5 h-3.5" />Avertissements</div>
          <div className="text-xl font-bold text-amber-600">{warnings}</div>
        </CardContent></Card>
        <Card className="border-border"><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><ShieldCheck className="w-3.5 h-3.5" />Contrôles intégrité</div>
          <div className="text-xl font-bold text-foreground">{passed}/{integrityChecks.length} OK</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Alertes actives</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {la ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />) :
              alerts.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">Aucune alerte. Tout est conforme.</div>
              ) : alerts.map((a, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border text-xs ${a.severity === "critical" ? "bg-destructive/5 border-destructive/20" : a.severity === "warning" ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/30 border-border"}`}>
                  <FileWarning className={`w-4 h-4 mt-0.5 shrink-0 ${a.severity === "critical" ? "text-destructive" : a.severity === "warning" ? "text-amber-600" : "text-muted-foreground"}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{a.type.replace(/_/g, " ")}</Badge>
                      <span className="font-mono text-primary">{a.assetCode}</span>
                    </div>
                    <div className="text-foreground">{a.message}</div>
                    <div className="text-muted-foreground mt-1">Échéance : {a.dueDate}</div>
                  </div>
                  <Badge variant={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "secondary" : "outline"} className="text-[10px]">{a.severity}</Badge>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Contrôles d'intégrité</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {integrityChecks.map((c, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${c.status === "Pass" ? "bg-success/5 border-success/20" : c.status === "Fail" ? "bg-destructive/5 border-destructive/20" : "bg-amber-500/5 border-amber-500/20"}`}>
                <Badge variant={c.status === "Pass" ? "default" : c.status === "Fail" ? "destructive" : "secondary"} className="text-[10px]">{c.status}</Badge>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{c.check}</div>
                  <div className="text-muted-foreground mt-0.5">{c.details}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border mt-4">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" />Piste d'audit RBAC (50 derniers)</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {lau ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : audit.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">Aucun événement d'audit.</div>
          ) : (
            <div className="space-y-1 max-h-[320px] overflow-auto">
              {audit.slice(0, 50).map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-[11px] py-1.5 px-2 border-b border-border/60">
                  <span className="font-mono text-muted-foreground w-[140px] shrink-0">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
                  <Badge variant="outline" className="text-[10px]">{r.action}</Badge>
                  {r.role && <Badge variant="secondary" className="text-[10px]">{r.role}</Badge>}
                  <span className="font-mono text-[10px] truncate">{r.actor_user_id?.slice(0, 8)} → {r.target_user_id?.slice(0, 8) || "—"}</span>
                  {r.details?.comment && <span className="text-muted-foreground truncate">— {r.details.comment}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
