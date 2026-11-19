import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ProjectRolesPanel } from "@/components/ProjectRolesPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";
import { useAnalyticsSetup } from "@/hooks/use-analytics-setup";
import { useProjectSettings, useSaveProjectSettings } from "@/hooks/use-projects";

/*
 * Projets → Paramètres : l'axe analytique dont chaque valeur est un projet (créée avec le projet), la prise en
 * compte des demandes d'achat dans l'engagé, et les rôles. La comptabilisation est celle des pièces : un projet
 * n'a pas de compte propre, il est une section imputée sur les écritures.
 */
const tabs = [["general", "Général"], ["posting", "Comptabilisation"], ["roles", "Rôles"]] as const;

function General() {
  const settings = useProjectSettings();
  const analytics = useAnalyticsSetup();
  const save = useSaveProjectSettings();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("projects.settings");
  const [axis, setAxis] = useState("");
  const [pr, setPr] = useState(false);
  useEffect(() => { if (settings.data) { setAxis(settings.data.project_axis_id); setPr(settings.data.include_requisitions_in_commitments); } }, [settings.data]);
  const axes = analytics.data?.axes ?? [];
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl" data-testid="project-settings">
      <div className="space-y-1">
        <label htmlFor="project-axis" className="text-xs font-medium">Axe analytique des projets *</label>
        <select id="project-axis" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" disabled={!can} value={axis} onChange={(e) => setAxis(e.target.value)}>
          <option value="">— choisir —</option>{axes.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground">Chaque projet crée sa section sur cet axe. Les demandes, commandes, factures, notes de frais et écritures imputées à la section alimentent le projet.
          {axes.length === 0 && <> Aucun axe : en créer un dans <Link className="text-primary underline" to="/settings?tab=analytics">Paramètres → Analytique</Link>.</>}</p>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!can} checked={pr} onChange={(e) => setPr(e.target.checked)} />
        Compter dans l'engagé les demandes d'achat approuvées non encore commandées</label>
      {can ? <Button size="sm" disabled={!axis || save.isPending} onClick={() => save.mutate({ project_axis_id: axis, include_requisitions_in_commitments: pr })}>Enregistrer</Button>
        : <p className="text-[11px] text-muted-foreground">Modification réservée au droit « projects.settings ».</p>}
    </section>
  );
}

export default function ProjectSettings() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab = tabs.some(([k]) => k === asked) ? asked! : "general";
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Projets", href: "/projects" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres des projets" description="Axe analytique des projets, calcul de l'engagé et rôles du module." />
      <div className="flex gap-1 border-b border-border" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams((p) => { p.set("tab", k); return p; }, { replace: true })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === k ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "general" && <General />}
      {tab === "posting" && (
        <section className="bg-card border border-border rounded-lg p-5 text-xs text-muted-foreground max-w-2xl space-y-2">
          <p>Un projet n'a pas de compte propre : il est la section analytique portée par les lignes des pièces (achats, notes de frais, ventes, écritures). Son réalisé est la somme des écritures comptabilisées portant sa section ; son budget se saisit par compte.</p>
          <p>Règles d'imputation analytique par compte (obligatoire, interdite) : <Link className="text-primary underline" to="/settings?tab=analytics">Paramètres → Analytique</Link>.</p>
        </section>
      )}
      {tab === "roles" && <div className="max-w-4xl"><ProjectRolesPanel /></div>}
    </PageShell>
  );
}
