import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useGrcPerms, useRiskCategories, useSaveRiskCategory } from "@/hooks/use-grc";

/* Risques → Données de base : catégories de risques de la société (aucune pré-remplie). */
export default function RiskMasterData() {
  const perms = useGrcPerms();
  const { data: categories = [] } = useRiskCategories();
  const save = useSaveRiskCategory();
  const [f, setF] = useState({ code: "", name: "" });
  const code = f.code.trim().toUpperCase();
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Gouvernance" }, { label: "Risques", href: "/risk" }, { label: "Données de base" }]} />
      <GuidanceBanner title="Catégories de risques" description="Classement du registre propre à la société (financier, opérationnel, conformité, fraude…). Une catégorie inutilisée se désactive." />
      <h1 className="text-lg font-semibold">Risques — Données de base</h1>
      <section className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="risk-categories">
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground"><th className="text-left">Code</th><th className="text-left">Libellé</th><th className="text-left">État</th><th /></tr></thead>
          <tbody>
            {categories.length === 0 && <tr><td colSpan={4} className="py-2 text-muted-foreground">Aucune catégorie.</td></tr>}
            {categories.map((c) => (
              <tr key={c.id} className="border-t border-border/50" data-testid="risk-category-row">
                <td className="py-1 font-mono">{c.code}</td><td>{c.name}</td>
                <td><StatusBadge status={c.is_active ? "success" : "neutral"} label={c.is_active ? "Active" : "Inactive"} /></td>
                <td className="text-right">{perms.risksSettings && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => save.mutate({ ...c, is_active: !c.is_active })}>
                  {c.is_active ? "Désactiver" : "Activer"}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {perms.risksSettings ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="space-y-1"><label htmlFor="rc-code" className="text-[11px] text-muted-foreground">Code</label>
              <Input id="rc-code" className="h-8 w-28 text-xs" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FIN" /></div>
            <div className="space-y-1"><label htmlFor="rc-name" className="text-[11px] text-muted-foreground">Libellé</label>
              <Input id="rc-name" className="h-8 w-64 text-xs" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <Button size="sm" className="h-8 text-xs gap-1" disabled={!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code) || !f.name.trim() || save.isPending}
              onClick={() => save.mutate({ code, name: f.name }, { onSuccess: () => setF({ code: "", name: "" }) })}><Plus className="w-3.5 h-3.5" /> Ajouter la catégorie</Button>
          </div>
        ) : <p className="text-xs text-muted-foreground">Droit « risks.settings » requis pour modifier les catégories.</p>}
      </section>
    </PageShell>
  );
}
