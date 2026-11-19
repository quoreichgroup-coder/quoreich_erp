import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { ModulePostingSettings } from "@/components/AccountSets";
import { ApprovalThresholdsEditor } from "@/components/ApprovalThresholdsEditor";
import { ExpenseRolesPanel } from "@/components/ExpenseRolesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";
import { useExpenseSettings, useSaveExpenseSettings } from "@/hooks/use-expenses";

/*
 * Notes de frais → Paramètres : règles (justificatif, plafond par note, délai de soumission ; vide =
 * désactivé), niveaux d'approbation, comptabilisation (rôle « notes de frais à rembourser » ; les
 * comptes de charge sont sur les catégories) et rôles.
 */
const tabs = [["rules", "Règles"], ["approval", "Approbation"], ["posting", "Comptabilisation"], ["roles", "Rôles"]] as const;

function Rules() {
  const q = useExpenseSettings();
  const save = useSaveExpenseSettings();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes("expenses.settings");
  const [f, setF] = useState<{ receipt: string; max: string; late: string } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ receipt: q.data.receipt_required_above?.toString() ?? "", max: q.data.max_report_amount?.toString() ?? "", late: q.data.late_submission_days?.toString() ?? "" });
  }, [q.data, f]);
  if (!f) return <div className="p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-4 max-w-2xl" data-testid="expense-rules">
      <p className="text-xs text-muted-foreground">Aucune valeur n'est imposée : un champ vide désactive le contrôle. La soumission d'une note est refusée tant qu'une règle n'est pas respectée.</p>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1"><label htmlFor="exp-receipt" className="text-xs font-medium">Justificatif exigé à partir de (TTC)</label>
          <Input id="exp-receipt" inputMode="decimal" className="h-8 text-xs" disabled={!can} value={f.receipt} placeholder="vide = jamais exigé" onChange={(e) => setF({ ...f, receipt: e.target.value })} /></div>
        <div className="space-y-1"><label htmlFor="exp-max" className="text-xs font-medium">Plafond par note (TTC)</label>
          <Input id="exp-max" inputMode="decimal" className="h-8 text-xs" disabled={!can} value={f.max} placeholder="vide = aucun" onChange={(e) => setF({ ...f, max: e.target.value })} /></div>
        <div className="space-y-1"><label htmlFor="exp-late" className="text-xs font-medium">Délai de soumission (jours après la dépense)</label>
          <Input id="exp-late" type="number" min={1} max={365} className="h-8 text-xs" disabled={!can} value={f.late} placeholder="vide = aucun" onChange={(e) => setF({ ...f, late: e.target.value })} /></div>
      </div>
      <p className="text-[11px] text-muted-foreground">Le seuil de justificatif et le plafond par dépense d'une catégorie (Données de base) priment sur le paramètre général.</p>
      {can ? <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ receipt_required_above: n(f.receipt), max_report_amount: n(f.max), late_submission_days: n(f.late) })}>Enregistrer</Button>
        : <p className="text-[11px] text-muted-foreground">Modification réservée au droit « expenses.settings ».</p>}
    </section>
  );
}

export default function ExpenseSettings() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab = tabs.some(([k]) => k === asked) ? asked! : "rules";
  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais", href: "/expenses" }, { label: "Paramètres" }]} />
      <GuidanceBanner title="Paramètres des notes de frais" description="Règles de soumission, niveaux d'approbation, comptabilisation et rôles du module." />
      <div className="flex gap-1 border-b border-border" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams((p) => { p.set("tab", k); return p; }, { replace: true })}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === k ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "rules" && <Rules />}
      {tab === "approval" && <ApprovalThresholdsEditor kind="expense" />}
      {tab === "posting" && <ModulePostingSettings modules={["EXP"]} extra={
        <p className="text-xs text-muted-foreground">Comptes de charge : sur chaque catégorie de frais (Données de base). TVA récupérable : compte du code TVA, sinon rôle « TVA récupérable ».</p>} />}
      {tab === "roles" && <div className="max-w-4xl"><ExpenseRolesPanel /></div>}
    </PageShell>
  );
}
