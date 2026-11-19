import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { RiskRolesPanel } from "@/components/RiskRolesPanel";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGrcPerms, useRiskSettings, useSaveRiskSettings } from "@/hooks/use-grc";

/* Risques → Paramètres : échelle de cotation, seuils de criticité, appétence, revue périodique ; rôles. */
export default function RiskSettings() {
  const perms = useGrcPerms();
  const { data } = useRiskSettings();
  const save = useSaveRiskSettings();
  const [f, setF] = useState({ scale_max: "5", medium_from: "5", high_from: "10", critical_from: "15", appetite_score: "", review_days: "" });
  useEffect(() => {
    if (data) setF({ scale_max: String(data.scale_max), medium_from: String(data.medium_from), high_from: String(data.high_from), critical_from: String(data.critical_from),
      appetite_score: data.appetite_score == null ? "" : String(data.appetite_score), review_days: data.review_days == null ? "" : String(data.review_days) });
  }, [data]);
  const n = (v: string) => Number(v);
  const max = n(f.scale_max) ** 2;
  const err = !(n(f.scale_max) >= 3 && n(f.scale_max) <= 10) ? "Échelle de 3 à 10."
    : !(1 <= n(f.medium_from) && n(f.medium_from) <= n(f.high_from) && n(f.high_from) <= n(f.critical_from) && n(f.critical_from) <= max) ? `Seuils croissants, entre 1 et ${max}.`
    : f.appetite_score && !(n(f.appetite_score) >= 1 && n(f.appetite_score) <= max) ? `Appétence entre 1 et ${max}.` : "";
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <div className="space-y-1"><label htmlFor={`rs-${k}`} className="text-xs font-medium">{label}</label>
      <Input id={`rs-${k}`} inputMode="numeric" className="h-8 text-xs w-32" disabled={!perms.risksSettings} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}</div>
  );
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques", href: "/risk" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres des risques" description="Tout est propre à la société : aucune échelle ni appétence n'est imposée. Score = probabilité × impact." />
      <h1 className="text-lg font-semibold">Risques — Paramètres</h1>
      <section className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="risk-settings">
        <h2 className="text-sm font-semibold">Échelle et seuils</h2>
        <div className="flex flex-wrap gap-4">
          {field("scale_max", "Échelle (probabilité et impact de 1 à)")}
          {field("medium_from", "Modéré à partir du score")}
          {field("high_from", "Élevé à partir du score")}
          {field("critical_from", "Critique à partir du score")}
          {field("appetite_score", "Appétence (score maximal toléré)", "Vide : pas d'alerte d'appétence.")}
          {field("review_days", "Revue après évaluation (jours)", "Vide : date de revue saisie à la main.")}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {perms.risksSettings ? (
          <Button size="sm" disabled={Boolean(err) || save.isPending} onClick={() => save.mutate({ scale_max: n(f.scale_max), medium_from: n(f.medium_from), high_from: n(f.high_from),
            critical_from: n(f.critical_from), appetite_score: f.appetite_score ? n(f.appetite_score) : null, review_days: f.review_days ? n(f.review_days) : null })}>Enregistrer</Button>
        ) : <p className="text-xs text-muted-foreground">Droit « risks.settings » requis pour modifier.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Rôles</h2>
        <p className="text-xs text-muted-foreground">Droits du catalogue : risks.manage (registre, statut, actions), risks.assess (évaluation), risks.settings, risks.export.</p>
        <RiskRolesPanel />
      </section>
    </PageShell>
  );
}
