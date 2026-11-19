import { PageShell } from "@/components/PageShell";
import { ComplianceRolesPanel } from "@/components/ComplianceRolesPanel";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { useComplianceSettings, useGrcPerms, useSaveComplianceSettings } from "@/hooks/use-grc";

/* Conformité → Paramètres : séparation des tâches sur la clôture des constats ; rôles. */
export default function ComplianceSettings() {
  const perms = useGrcPerms();
  const { data } = useComplianceSettings();
  const save = useSaveComplianceSettings();
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Conformité", href: "/compliance" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres de la conformité" description="Règles de la société pour le suivi des constats." />
      <h1 className="text-lg font-semibold">Conformité — Paramètres</h1>
      <section className="bg-card border border-border rounded-lg p-4 space-y-2" data-testid="compliance-settings">
        <h2 className="text-sm font-semibold">Constats</h2>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={!perms.complianceSettings || !data || save.isPending} checked={data?.issue_second_person ?? true}
            onChange={(e) => save.mutate({ issue_second_person: e.target.checked })} />
          Un constat est clôturé par une autre personne que celle qui l'a relevé
        </label>
        {!perms.complianceSettings && <p className="text-xs text-muted-foreground">Droit « compliance.settings » requis pour modifier.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Rôles</h2>
        <p className="text-xs text-muted-foreground">Droits du catalogue : compliance.manage (référentiels et contrôles), compliance.test (tests), compliance.close_issue (clôture des constats), compliance.settings, compliance.export.</p>
        <ComplianceRolesPanel />
      </section>
    </PageShell>
  );
}
