import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { useHrMovementReferences, useHrPayrollSettings } from "@/hooks/use-hr-data";
import {
  useArchivePayrollRuleVersion, useDeletePayrollRuleVersion, usePayrollRuleVersions, useSavePayrollRuleVersion,
  useValidatePayrollRuleVersion, type PayrollContribution, type PayrollRuleVersion,
} from "@/hooks/use-payroll-rules";
import { hrErrorMessage } from "@/lib/hr-error-message";

const STATUS: Record<string, [string, "default" | "outline" | "secondary"]> = {
  draft: ["Brouillon", "outline"], validated: ["Validée", "default"], archived: ["Archivée", "secondary"],
};

function blankVersion(): PayrollRuleVersion {
  return {
    country_code: "", currency_code: "", effective_from: "", reference: "", notes: null,
    proration_method: "calendar_days", rounding_unit: 1, rounding_mode: "nearest", taxable_rounding_unit: null,
    income_tax_bands: [{ up_to: null, rate_pct: 0 }], tax_abatements: [], family_reductions: [], family_max_dependents: null,
    contributions: [],
  };
}

function blankContribution(order: number): PayrollContribution {
  return {
    code: "", label: "", organism: null, employee_rate_pct: 0, employer_rate_pct: 0, base_floor: null,
    employee_ceiling: null, employer_ceiling: null, deductible_from_tax: true, payable_account_code: null,
    employer_account_code: null, sort_order: order,
  };
}

/** Copie modifiable d'une version (sans identifiant ni statut) : une nouvelle loi = une nouvelle version. */
function copyOf(v: PayrollRuleVersion): PayrollRuleVersion {
  return {
    country_code: v.country_code, currency_code: v.currency_code, effective_from: "", reference: "", notes: null,
    proration_method: v.proration_method, rounding_unit: Number(v.rounding_unit), rounding_mode: v.rounding_mode,
    taxable_rounding_unit: v.taxable_rounding_unit == null ? null : Number(v.taxable_rounding_unit),
    income_tax_bands: v.income_tax_bands.map((b) => ({ ...b })), tax_abatements: v.tax_abatements.map((a) => ({ ...a })),
    family_reductions: v.family_reductions.map((f) => ({ ...f })), family_max_dependents: v.family_max_dependents,
    contributions: v.contributions.map(({ id: _id, ...c }) => ({ ...c })),
  };
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const txt = (v: number | null | undefined) => (v == null ? "" : String(v));

export function PayrollRuleVersionsPanel() {
  const { data: access } = useMyAccess();
  const permissions = access?.permissions ?? [];
  const canEdit = permissions.includes("hr.payroll_settings");
  const canValidate = permissions.includes("hr.payroll_rules_validate");
  const versions = usePayrollRuleVersions();
  const legacy = useHrPayrollSettings();
  const categories = (useHrMovementReferences(true).data ?? []).filter((r) => r.kind === "payroll_category");
  const save = useSavePayrollRuleVersion();
  const validate = useValidatePayrollRuleVersion();
  const archive = useArchivePayrollRuleVersion();
  const remove = useDeletePayrollRuleVersion();
  const [draft, setDraft] = useState<PayrollRuleVersion | null>(null);
  const [archiveReason, setArchiveReason] = useState<Record<string, string>>({});

  const rows = versions.data ?? [];
  const hasValidated = rows.some((v) => v.status === "validated");
  const set = <K extends keyof PayrollRuleVersion>(key: K, value: PayrollRuleVersion[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const fromLegacy = (): PayrollRuleVersion => {
    const s = legacy.data;
    const v = blankVersion();
    if (!s) return v;
    return {
      ...v, country_code: s.country_code?.trim() ?? "", currency_code: s.currency_code?.trim() ?? "",
      proration_method: s.proration_method === "thirty_days" ? "thirty_days" : "calendar_days", rounding_unit: 0.01,
      income_tax_bands: s.income_tax_bands?.length ? s.income_tax_bands.map((b) => ({ ...b })) : v.income_tax_bands,
      contributions: [{ ...blankContribution(0), code: "SOCIAL", label: "Cotisations sociales",
        employee_rate_pct: Number(s.employee_contribution_pct ?? 0), employer_rate_pct: Number(s.employer_contribution_pct ?? 0),
        employee_ceiling: s.employee_contribution_cap, employer_ceiling: s.employer_contribution_cap }],
    };
  };

  return (
    <section aria-label="Versions des règles de paie" className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Règles légales de paie — versions datées</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Chaque version (pays, cotisations par organisme, barème d’impôt, abattements, charges de famille, arrondis) s’applique
            aux cycles à partir de sa date d’effet. Une version validée est figée : une nouvelle loi = une nouvelle version.
            Aucune valeur légale n’est préremplie ; chaque version cite sa source officielle.
          </p>
        </div>
        {canEdit && !draft && <div className="flex gap-2">
          {!hasValidated && legacy.data?.country_code && <Button size="sm" variant="outline" onClick={() => setDraft(fromLegacy())}>Reprendre les règles actuelles</Button>}
          <Button size="sm" onClick={() => setDraft(blankVersion())}>Nouvelle version</Button>
        </div>}
      </div>

      {!hasValidated && !versions.isLoading && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
        Aucune version validée : les cycles utilisent encore les « Règles actuelles » ci-dessous (une seule cotisation). Dès qu’une
        version est validée, elle les remplace pour les périodes à partir de sa date d’effet.
      </p>}
      {versions.isError && <div role="alert" className="flex items-center justify-between gap-2 rounded border border-destructive/30 p-2 text-xs text-destructive">
        <span>Impossible de charger les versions{hrErrorMessage(versions.error) ? ` : ${hrErrorMessage(versions.error)}` : "."}</span>
        <Button size="sm" variant="outline" onClick={() => void versions.refetch()}>Réessayer</Button>
      </div>}

      {draft && <VersionEditor draft={draft} set={set} categories={categories.map((c) => [c.code, c.label])}
        saving={save.isPending} onCancel={() => setDraft(null)}
        onSave={() => save.mutate(draft, { onSuccess: () => setDraft(null) })} />}

      {!versions.isLoading && !versions.isError && <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b text-muted-foreground"><th className="p-2">Date d’effet</th><th className="p-2">Pays / devise</th><th className="p-2">Cotisations</th><th className="p-2">Source</th><th className="p-2">État</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {rows.map((v) => <tr key={v.id} className="border-b border-border/60 align-top">
              <td className="p-2 font-medium">{v.effective_from}</td>
              <td className="p-2">{v.country_code} · {v.currency_code}</td>
              <td className="p-2">{v.contributions.map((c) => `${c.code} ${Number(c.employee_rate_pct)} % / ${Number(c.employer_rate_pct)} %`).join(" · ") || "Aucune"}</td>
              <td className="p-2 max-w-[260px]">{v.reference || "—"}{v.archive_reason ? <div className="text-muted-foreground">Archivée : {v.archive_reason}</div> : null}
                {v.status === "draft" && (v.issues ?? []).length > 0 && <ul className="mt-1 list-disc pl-4 text-destructive">{(v.issues ?? []).map((i) => <li key={i}>{i}</li>)}</ul>}</td>
              <td className="p-2"><Badge variant={STATUS[v.status ?? "draft"][1]}>{STATUS[v.status ?? "draft"][0]}</Badge></td>
              <td className="p-2"><div className="flex flex-wrap gap-1">
                {canEdit && v.status === "draft" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDraft({ ...v })}>Modifier</Button>}
                {canValidate && v.status === "draft" && <Button size="sm" className="h-7 text-xs" disabled={validate.isPending || (v.issues ?? []).length > 0} onClick={() => validate.mutate(v.id!)}>Valider</Button>}
                {canEdit && v.status === "draft" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => remove.mutate(v.id!)}>Supprimer</Button>}
                {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDraft(copyOf(v))}>Copier en nouvelle version</Button>}
                {canValidate && v.status === "validated" && <span className="flex gap-1">
                  <Input aria-label={`Motif d’archivage ${v.effective_from}`} placeholder="Motif d’archivage" className="h-7 w-40 text-xs"
                    value={archiveReason[v.id!] ?? ""} onChange={(e) => setArchiveReason((r) => ({ ...r, [v.id!]: e.target.value }))} />
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={(archiveReason[v.id!] ?? "").trim().length < 3}
                    onClick={() => archive.mutate({ id: v.id!, reason: archiveReason[v.id!] })}>Archiver</Button>
                </span>}
              </div></td>
            </tr>)}
            {!rows.length && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Aucune version de règles enregistrée.</td></tr>}
          </tbody>
        </table>
      </div>}
      {!canValidate && <p className="text-[11px] text-muted-foreground">La validation demande le droit « Valider les règles légales de paie ».</p>}
    </section>
  );
}

function VersionEditor({ draft, set, categories, saving, onSave, onCancel }: {
  draft: PayrollRuleVersion; categories: [string, string][]; saving: boolean;
  set: <K extends keyof PayrollRuleVersion>(key: K, value: PayrollRuleVersion[K]) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const updateRow = <K extends "income_tax_bands" | "tax_abatements" | "family_reductions" | "contributions">(
    key: K, index: number, patch: Partial<PayrollRuleVersion[K][number]>) =>
    set(key, draft[key].map((row, i) => (i === index ? { ...row, ...patch } : row)) as PayrollRuleVersion[K]);
  const removeRow = <K extends "income_tax_bands" | "tax_abatements" | "family_reductions" | "contributions">(key: K, index: number) =>
    set(key, draft[key].filter((_, i) => i !== index) as PayrollRuleVersion[K]);

  return (
    <div className="space-y-4 rounded-md border border-primary/30 p-3">
      <h3 className="text-xs font-semibold">{draft.id ? "Modifier le brouillon" : "Nouvelle version (brouillon)"}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <F label="Code pays (ISO 2)" value={draft.country_code} onChange={(v) => set("country_code", v.toUpperCase().slice(0, 2))} />
        <F label="Devise (ISO 3)" value={draft.currency_code} onChange={(v) => set("currency_code", v.toUpperCase().slice(0, 3))} />
        <F label="Date d’effet" type="date" value={draft.effective_from} onChange={(v) => set("effective_from", v)} />
        <div className="space-y-1"><Label htmlFor="rv-proration" className="text-xs">Prorata des entrées / sorties</Label>
          <select id="rv-proration" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={draft.proration_method}
            onChange={(e) => set("proration_method", e.target.value === "thirty_days" ? "thirty_days" : "calendar_days")}>
            <option value="calendar_days">Jours calendaires du mois</option><option value="thirty_days">Mois de 30 jours</option></select></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label htmlFor="rv-reference" className="text-xs">Source officielle (texte, article, date, URL)</Label>
          <Input id="rv-reference" className="h-8 text-xs" value={draft.reference} onChange={(e) => set("reference", e.target.value)} /></div>
        <F label="Arrondi des montants (unité)" type="number" value={txt(draft.rounding_unit)} onChange={(v) => set("rounding_unit", num(v) ?? 0.01)} />
        <div className="space-y-1"><Label htmlFor="rv-rounding-mode" className="text-xs">Sens de l’arrondi</Label>
          <select id="rv-rounding-mode" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={draft.rounding_mode}
            onChange={(e) => set("rounding_mode", e.target.value as PayrollRuleVersion["rounding_mode"])}>
            <option value="nearest">Au plus proche</option><option value="down">Inférieur</option><option value="up">Supérieur</option></select></div>
        <F label="Arrondi de la base imposable (unité inférieure, facultatif)" type="number" value={txt(draft.taxable_rounding_unit)} onChange={(v) => set("taxable_rounding_unit", num(v))} />
      </div>

      <Block title="Cotisations (une ligne par organisme ou branche)" onAdd={() => set("contributions", [...draft.contributions, blankContribution(draft.contributions.length)])} addLabel="Ajouter une cotisation">
        {draft.contributions.map((c, i) => <div key={i} className="grid gap-2 rounded border p-2 sm:grid-cols-3 lg:grid-cols-6">
          <F label={`Code cotisation ${i + 1}`} value={c.code} onChange={(v) => updateRow("contributions", i, { code: v.toUpperCase() })} />
          <F label="Libellé" value={c.label} onChange={(v) => updateRow("contributions", i, { label: v })} />
          <F label="Organisme" value={c.organism ?? ""} onChange={(v) => updateRow("contributions", i, { organism: v || null })} />
          <F label="Taux salarié (%)" type="number" value={txt(c.employee_rate_pct)} onChange={(v) => updateRow("contributions", i, { employee_rate_pct: num(v) ?? 0 })} />
          <F label="Taux employeur (%)" type="number" value={txt(c.employer_rate_pct)} onChange={(v) => updateRow("contributions", i, { employer_rate_pct: num(v) ?? 0 })} />
          <F label="Plancher de base (facultatif)" type="number" value={txt(c.base_floor)} onChange={(v) => updateRow("contributions", i, { base_floor: num(v) })} />
          <F label="Plafond part salariale" type="number" value={txt(c.employee_ceiling)} onChange={(v) => updateRow("contributions", i, { employee_ceiling: num(v) })} />
          <F label="Plafond part patronale" type="number" value={txt(c.employer_ceiling)} onChange={(v) => updateRow("contributions", i, { employer_ceiling: num(v) })} />
          <F label="Compte de l’organisme (facultatif)" value={c.payable_account_code ?? ""} onChange={(v) => updateRow("contributions", i, { payable_account_code: v || null })} />
          <F label="Compte de charge patronale (facultatif)" value={c.employer_account_code ?? ""} onChange={(v) => updateRow("contributions", i, { employer_account_code: v || null })} />
          <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" checked={c.deductible_from_tax} onChange={(e) => updateRow("contributions", i, { deductible_from_tax: e.target.checked })} />Déductible de la base imposable</label>
          <div className="pt-4"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => removeRow("contributions", i)}>Retirer</Button></div>
        </div>)}
      </Block>

      <Block title="Barème progressif de l’impôt (mensuel)" onAdd={() => set("income_tax_bands", [...draft.income_tax_bands, { up_to: null, rate_pct: 0 }])} addLabel="Ajouter une tranche">
        {draft.income_tax_bands.map((b, i) => <div key={i} className="grid max-w-xl grid-cols-[1fr_1fr_auto] items-end gap-2">
          <F label={`Limite supérieure ${i + 1} (vide = sans limite)`} type="number" value={txt(b.up_to)} onChange={(v) => updateRow("income_tax_bands", i, { up_to: num(v) })} />
          <F label="Taux marginal (%)" type="number" value={txt(b.rate_pct)} onChange={(v) => updateRow("income_tax_bands", i, { rate_pct: num(v) ?? 0 })} />
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => removeRow("income_tax_bands", i)}>Retirer</Button>
        </div>)}
      </Block>

      <Block title="Abattement forfaitaire (par catégorie de paie)" onAdd={() => set("tax_abatements", [...draft.tax_abatements, { category: null, basis: "base_salary", rate_pct: 0, min_amount: null, max_amount: null }])} addLabel="Ajouter un abattement">
        {draft.tax_abatements.map((a, i) => <div key={i} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 items-end">
          <div className="space-y-1"><Label htmlFor={`rv-ab-cat-${i}`} className="text-xs">Catégorie {i + 1}</Label>
            <select id={`rv-ab-cat-${i}`} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={a.category ?? ""}
              onChange={(e) => updateRow("tax_abatements", i, { category: e.target.value || null })}>
              <option value="">Toutes les autres catégories</option>{categories.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor={`rv-ab-basis-${i}`} className="text-xs">Base</Label>
            <select id={`rv-ab-basis-${i}`} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={a.basis}
              onChange={(e) => updateRow("tax_abatements", i, { basis: e.target.value === "taxable_gross" ? "taxable_gross" : "base_salary" })}>
              <option value="base_salary">Salaire de base</option><option value="taxable_gross">Brut imposable</option></select></div>
          <F label="Taux (%)" type="number" value={txt(a.rate_pct)} onChange={(v) => updateRow("tax_abatements", i, { rate_pct: num(v) ?? 0 })} />
          <F label="Minimum" type="number" value={txt(a.min_amount)} onChange={(v) => updateRow("tax_abatements", i, { min_amount: num(v) })} />
          <F label="Maximum" type="number" value={txt(a.max_amount)} onChange={(v) => updateRow("tax_abatements", i, { max_amount: num(v) })} />
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => removeRow("tax_abatements", i)}>Retirer</Button>
        </div>)}
        {!categories.length && <p className="text-[11px] text-muted-foreground">Les catégories (cadres, non-cadres…) se créent dans « Référentiels et mouvements ».</p>}
      </Block>

      <Block title="Réduction d’impôt pour charges de famille" onAdd={() => set("family_reductions", [...draft.family_reductions, { dependents: draft.family_reductions.length + 1, reduction_pct: 0 }])} addLabel="Ajouter un palier">
        <div className="max-w-xs"><F label="Nombre maximal de charges retenues (facultatif)" type="number" value={txt(draft.family_max_dependents)} onChange={(v) => set("family_max_dependents", num(v))} /></div>
        {draft.family_reductions.map((f, i) => <div key={i} className="grid max-w-xl grid-cols-[1fr_1fr_auto] items-end gap-2">
          <F label={`À partir de (charges) ${i + 1}`} type="number" value={txt(f.dependents)} onChange={(v) => updateRow("family_reductions", i, { dependents: num(v) ?? 1 })} />
          <F label="Réduction de l’impôt (%)" type="number" value={txt(f.reduction_pct)} onChange={(v) => updateRow("family_reductions", i, { reduction_pct: num(v) ?? 0 })} />
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => removeRow("family_reductions", i)}>Retirer</Button>
        </div>)}
      </Block>

      <div className="flex gap-2">
        <Button size="sm" disabled={saving || !draft.country_code || !draft.currency_code || !draft.effective_from} onClick={onSave}>{saving ? "Enregistrement…" : "Enregistrer le brouillon"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Annuler</Button>
      </div>
    </div>
  );
}

function Block({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd: () => void; addLabel: string }) {
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><h4 className="text-xs font-medium">{title}</h4>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onAdd}>{addLabel}</Button></div>
    {children}
  </div>;
}

function F({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>
    <Input aria-label={label} type={type} step={type === "number" ? "any" : undefined} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" /></div>;
}
