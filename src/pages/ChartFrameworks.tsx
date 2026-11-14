import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ChartImport } from "@/components/ChartImport";
import { ChartMappings } from "@/components/ChartMappings";
import { ChartMigration } from "@/components/ChartMigration";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  effectiveFramework, effectiveRule, useFrameworks, useOperationalChart, useQualityRules, useSetQualityRule, type Severity,
} from "@/hooks/use-chart-frameworks";

/*
 * Plans et référentiels (lots PC-3 à PC-6, docs/audit-erp/12). PC-3 : référentiels comptables versionnés
 * (données de plateforme, lecture seule) et règles de qualité du plan, activables et de gravité
 * réglable par société (droit accounting.chart_admin). PC-4 : import guidé (onglet Import). PC-5 :
 * correspondances et plans secondaires (onglet Correspondances). PC-6 : migration du plan
 * opérationnel (onglet Migration).
 */
const TABS: [string, string][] = [["frameworks", "Référentiels"], ["rules", "Règles de qualité"], ["import", "Import"], ["mappings", "Correspondances"], ["migration", "Migration"]];
const KIND: Record<string, string> = { legal: "Légal", erp: "ERP", group: "Groupe", custom: "Personnalisé" };
const VERSION_STATUS: Record<string, [string, string]> = { published: ["success", "Publiée"], draft: ["neutral", "Brouillon"], archived: ["neutral", "Archivée"] };
const SEVERITIES: [Severity, string][] = [["error", "Erreur"], ["warning", "À revoir"], ["info", "Information"]];

export default function ChartFrameworks() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([v]) => v === params.get("tab")) ? params.get("tab")! : "frameworks";
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité", href: "/journal" }, { label: "Grand livre", href: "/journal" }, { label: "Plans et référentiels" }]} />
      <GuidanceBanner message="Référentiels comptables applicables (SYSCOHADA, PCG…) et règles de qualité du plan comptable de la société. Les référentiels sont fournis par la plateforme ; la société choisit quelles règles s'appliquent et avec quelle gravité." />
      <div>
        <h1 className="text-lg font-semibold text-foreground">Plans et référentiels</h1>
        <p className="text-xs text-muted-foreground">Référentiel du plan opérationnel, versions, règles de contrôle</p>
      </div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "frameworks" ? <FrameworksTab /> : tab === "rules" ? <RulesTab /> : tab === "import" ? <ChartImport /> : tab === "mappings" ? <ChartMappings /> : <ChartMigration />}
    </PageShell>
  );
}

function FrameworksTab() {
  const { data, isLoading, error } = useFrameworks();
  const { data: chart } = useOperationalChart();
  const current = effectiveFramework(chart);
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>;
  return (
    <div className="space-y-3">
      <div className="card-elevated p-4 text-xs" data-testid="operational-chart">
        <p className="font-semibold text-sm">{chart?.name ?? "Plan principal"}</p>
        <p className="text-muted-foreground">Référentiel : {data?.frameworks.find((f) => f.code === current)?.name ?? current}
          {chart?.framework_version ? ` · version ${chart.framework_version}` : ""}{chart?.framework_code ? "" : " (par défaut, aucun référentiel appliqué)"}</p>
        <p className="text-muted-foreground">Changer de référentiel est une migration comptable (correspondances validées, reclassement par OD), pas un paramètre.</p>
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="frameworks-table">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Référentiel</th><th className="text-left">Nature</th><th className="text-left">Pays / zone</th>
            <th className="text-left">Versions</th><th className="text-right">Comptes de référence</th><th className="text-left pl-3">Validation</th>
          </tr></thead>
          <tbody>
            {(data?.frameworks ?? []).map((f) => (
              <tr key={f.code} data-testid="framework-row" className={cn("border-t border-border/50 align-top", f.code === current && "bg-primary/5")}>
                <td className="p-2"><p className="font-medium">{f.short_label ?? f.code} {f.code === current && <span className="text-primary">· appliqué</span>}</p>
                  <p className="text-muted-foreground">{f.name}</p></td>
                <td>{KIND[f.kind] ?? f.kind}</td>
                <td>{f.country ?? "—"}</td>
                <td>{(data?.versions ?? []).filter((v) => v.framework_code === f.code).map((v) => (
                  <div key={v.version} className="flex items-center gap-1.5 py-0.5">
                    <span className="font-mono">{v.version}</span><span className="text-muted-foreground">dès le {new Date(v.effective_from).toLocaleDateString("fr-FR")}</span>
                    <StatusBadge status={VERSION_STATUS[v.status]?.[0] ?? "neutral"} label={VERSION_STATUS[v.status]?.[1] ?? v.status} />
                  </div>))}</td>
                <td className="text-right tabular-nums">{data?.referenceCounts[f.code] ?? 0}</td>
                <td className="pl-3">{f.is_validated ? <StatusBadge status="success" label="Validé" /> : <StatusBadge status="warning" label="À valider par l'expert-comptable" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RulesTab() {
  const { data: chart } = useOperationalChart();
  const framework = effectiveFramework(chart);
  const { data, isLoading, error } = useQualityRules(framework);
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("accounting.chart_admin");
  const set = useSetQualityRule();
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>;
  return (
    <div className="space-y-2">
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Administrer les plans comptables et les attributs de compte » est requis.</p>}
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-xs" data-testid="quality-rules">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Règle</th><th className="text-left">Gravité du référentiel</th><th className="text-left">Active</th>
            <th className="text-left">Gravité pour la société</th><th />
          </tr></thead>
          <tbody>
            {(data?.rules ?? []).map((r) => {
              const o = data?.overrides.find((x) => x.rule_code === r.rule_code);
              const eff = effectiveRule(r, o);
              return (
                <tr key={r.rule_code} data-testid="quality-rule-row" className="border-t border-border/50">
                  <td className="p-2"><p className="font-medium">{r.label}</p><p className="text-muted-foreground font-mono text-[10px]">{r.rule_code}
                    {typeof r.params?.pattern === "string" ? ` · motif ${r.params.pattern}` : ""}</p></td>
                  <td>{SEVERITIES.find(([v]) => v === r.severity)?.[1]}</td>
                  <td><Switch aria-label={`Activer la règle ${r.label}`} checked={eff.enabled} disabled={!canEdit || set.isPending}
                    onCheckedChange={(v) => set.mutate({ rule_code: r.rule_code, enabled: v, severity: o?.severity ?? null })} /></td>
                  <td><select aria-label={`Gravité de la règle ${r.label}`} className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    value={eff.severity} disabled={!canEdit || !eff.enabled || set.isPending}
                    onChange={(e) => set.mutate({ rule_code: r.rule_code, enabled: eff.enabled, severity: e.target.value as Severity })}>
                    {SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select></td>
                  <td className="pr-2 text-right">{canEdit && o && <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                    onClick={() => set.mutate({ rule_code: r.rule_code, reset: true })}>Rétablir</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Une règle désactivée n'est plus contrôlée dans « Contrôle du plan comptable ». Le format des codes n'est imposé à la saisie que s'il est actif en gravité « Erreur ».</p>
    </div>
  );
}
