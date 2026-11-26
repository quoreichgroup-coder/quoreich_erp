import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  tryPayrollFormula, useHrPayrollBases, useHrPayrollComponents, useHrPayrollSettings, useSaveHrPayrollBase,
  useSaveHrPayrollComponent, type HrPayrollBase, type HrPayrollComponent,
} from "@/hooks/use-hr-data";
import { hrErrorMessage } from "@/lib/hr-error-message";

type Form = Omit<HrPayrollComponent, "id" | "tenant_id">;
type Method = Form["calculation_method"];
const blank: Form = {
  code: "", label: "", kind: "earning", calculation_method: "fixed", amount: 0, cap: null,
  effective_from: new Date().toISOString().slice(0, 10), effective_to: null,
  gl_account_code: null, printable: true, active: true, sort_order: 0,
  taxable: false, subject_employee_social: false, subject_employer_social: false, prorated: false,
  tax_exempt_pct: null, tax_exempt_cap: null,
  priority: 100, base_code: null, formula: null, scale: null, scale_mode: null,
};

const METHODS: [Method, string][] = [
  ["fixed", "Montant fixe"], ["percent_base", "% d’une base"], ["quantity_rate", "Quantité × taux"],
  ["scale", "Barème par tranches"], ["formula", "Formule"],
];
const usesAmount = (m: Method) => m === "fixed" || m === "percent_base" || m === "quantity_rate";
const amountLabel = (m: Method) => (m === "percent_base" ? "Taux (%)" : m === "quantity_rate" ? "Taux unitaire (prix d’une unité)" : "Montant");

const FORMULA_HELP = "Variables : BASE (salaire de base du mois), GROSS (gains déjà calculés), QTY (quantité), RATE (taux), "
  + "DAYS_PRESENT, DAYS_TOTAL, RATIO, DEPENDENTS, SENIORITY_MONTHS ; rubrique ou base calculée avant : [code] ; "
  + "fonctions MIN, MAX, ROUND(x, décimales), FLOOR, CEIL, ABS, IF(condition, si vrai, si faux) ; décimales avec un point. "
  + "Exemple : ROUND(BASE / 173.33 * 1.25 * QTY, 0).";

export function HrPayrollComponentsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("hr.manage_payroll_components");
  const { data = [], isLoading, isError, error, refetch } = useHrPayrollComponents();
  const { data: bases = [] } = useHrPayrollBases();
  const { data: payrollSettings } = useHrPayrollSettings();
  const currency = payrollSettings?.currency_code?.trim() || "";
  const save = useSaveHrPayrollComponent();
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [trial, setTrial] = useState<string>("");
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((old) => ({ ...old, [key]: value }));
  const edit = (row: HrPayrollComponent) => {
    const { id, tenant_id: _tenant, ...values } = row;
    setEditing(id);
    setTrial("");
    setForm({ ...blank, ...values, prorated: values.prorated ?? false });
  };
  const method = form.calculation_method;
  const valid = !!form.code.trim() && !!form.label.trim() && !!form.effective_from
    && (!usesAmount(method) || (form.amount > 0 && (method !== "percent_base" || form.amount <= 100)))
    && (method !== "formula" || !!form.formula?.trim())
    && (method !== "scale" || (!!form.scale?.length && !!form.scale_mode));
  const submit = () => {
    if (!valid) return;
    // Les paramètres d'une autre méthode sont effacés ; l'exonération partielle ne vaut que pour un gain imposable.
    const exemptionApplies = form.kind === "earning" && form.taxable;
    const payload: Form = {
      ...form,
      amount: usesAmount(method) ? form.amount : 0,
      base_code: method === "percent_base" || method === "scale" ? form.base_code || null : null,
      formula: method === "formula" ? form.formula : null,
      scale: method === "scale" ? form.scale : null,
      scale_mode: method === "scale" ? form.scale_mode : null,
      prorated: method === "fixed" ? form.prorated : false,
      tax_exempt_pct: exemptionApplies ? form.tax_exempt_pct : null,
      tax_exempt_cap: exemptionApplies ? form.tax_exempt_cap : null,
    };
    save.mutate(editing ? { ...payload, id: editing } : payload, { onSuccess: () => { setForm(blank); setEditing(null); setTrial(""); } });
  };
  const runTrial = async () => {
    try {
      const value = await tryPayrollFormula(form.formula ?? "", { BASE: 100000, GROSS: 100000, QTY: 1, RATE: form.amount || 0,
        DAYS_PRESENT: 30, DAYS_TOTAL: 30, RATIO: 1, DEPENDENTS: 0, SENIORITY_MONTHS: 12 });
      setTrial(`Résultat avec BASE = 100 000, QTY = 1, ancienneté 12 mois (références à 0) : ${value.toLocaleString("fr-FR")}`);
    } catch (e) {
      setTrial(hrErrorMessage(e) || (e instanceof Error ? e.message : "Formule invalide"));
    }
  };
  const describe = (row: HrPayrollComponent) => {
    const base = row.base_code ? `base « ${row.base_code} »` : "salaire de base";
    switch (row.calculation_method) {
      case "percent_base": return `${row.amount}% de ${base}`;
      case "quantity_rate": return `Quantité × ${row.amount.toLocaleString("fr-FR")} ${currency}`;
      case "scale": return `Barème (${row.scale_mode === "percent" ? "%" : "montant"}) sur ${base}`;
      case "formula": return `Formule : ${row.formula}`;
      default: return `${row.amount.toLocaleString("fr-FR")} ${currency || "(devise à configurer)"}`;
    }
  };

  return <section aria-label="Rubriques de paie" className="mt-4 space-y-4 rounded-lg border border-border bg-card p-4">
    <div>
      <h2 className="text-sm font-semibold">Rubriques et éléments de rémunération</h2>
      <p className="mt-1 text-xs text-muted-foreground">Définissez les gains, retenues et charges, leur méthode de calcul, leur ordre de calcul, leurs dates d’effet et leurs comptes. Une rubrique n’utilise que des rubriques calculées avant elle (ordre plus petit). Aucune rubrique ni règle légale n’est préremplie.</p>
    </div>
    {isError && <div role="alert" className="flex items-center justify-between rounded border border-destructive/30 p-3 text-xs text-destructive">
      <span>Impossible de charger les rubriques{hrErrorMessage(error) ? ` : ${hrErrorMessage(error)}` : "."}</span>
      <Button size="sm" variant="outline" onClick={() => void refetch()}>Réessayer</Button>
    </div>}
    {canEdit && <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Code" value={form.code} disabled={isError} onChange={(v) => set("code", v.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} />
      <Field label="Libellé" value={form.label} disabled={isError} onChange={(v) => set("label", v)} />
      <SelectField label="Nature" value={form.kind} disabled={isError} onChange={(v) => set("kind", v as Form["kind"])} options={[["earning", "Gain"], ["deduction", "Retenue"], ["employer_charge", "Charge employeur"]]} />
      <SelectField label="Calcul" value={method} disabled={isError} onChange={(v) => set("calculation_method", v as Method)} options={METHODS} />
      {usesAmount(method) && <Field label={amountLabel(method)} value={String(form.amount)} type="number" disabled={isError} onChange={(v) => set("amount", Number(v))} />}
      {(method === "percent_base" || method === "scale") && <SelectField label="Base de calcul" value={form.base_code ?? ""} disabled={isError}
        onChange={(v) => set("base_code", v || null)} options={[["", "Salaire de base"], ...bases.filter((b) => b.active).map((b) => [b.code, `${b.label} (${b.code})`] as [string, string])]} />}
      <Field label="Ordre de calcul (1 = en premier)" value={String(form.priority ?? 100)} type="number" disabled={isError} onChange={(v) => set("priority", Number(v) || 100)} />
      <Field label="Plafond (facultatif)" value={form.cap == null ? "" : String(form.cap)} type="number" disabled={isError} onChange={(v) => set("cap", v ? Number(v) : null)} />
      <Field label="Date d’effet" value={form.effective_from} type="date" disabled={isError} onChange={(v) => set("effective_from", v)} />
      <Field label="Fin d’effet (facultatif)" value={form.effective_to ?? ""} type="date" disabled={isError} onChange={(v) => set("effective_to", v || null)} />
      <Field label="Compte comptable (facultatif)" value={form.gl_account_code ?? ""} disabled={isError} onChange={(v) => set("gl_account_code", v || null)} />
      <Field label="Ordre d’affichage" value={String(form.sort_order)} type="number" disabled={isError} onChange={(v) => set("sort_order", Number(v))} />

      {method === "formula" && <div className="space-y-1 sm:col-span-2 lg:col-span-4">
        <Label htmlFor="hr-component-formula" className="text-xs">Formule</Label>
        <textarea id="hr-component-formula" value={form.formula ?? ""} disabled={isError} rows={2} maxLength={500}
          onChange={(e) => { set("formula", e.target.value); setTrial(""); }}
          className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs" />
        <p className="text-[11px] text-muted-foreground">{FORMULA_HELP}</p>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!form.formula?.trim()} onClick={() => void runTrial()}>Tester la formule</Button>
          {trial && <span role="status" className="text-xs">{trial}</span>}
        </div>
      </div>}

      {method === "scale" && <div className="space-y-2 sm:col-span-2 lg:col-span-4">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label="Résultat de la tranche" value={form.scale_mode ?? ""} disabled={isError} onChange={(v) => set("scale_mode", (v || null) as Form["scale_mode"])}
            options={[["", "Choisir…"], ["amount", "Montant"], ["percent", "% de la base"]]} />
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => set("scale", [...(form.scale ?? []), { up_to: null, value: 0 }])}>Ajouter une tranche</Button>
        </div>
        {(form.scale ?? []).map((row, i) => <div key={i} className="grid max-w-xl grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label={`Jusqu’à (tranche ${i + 1}, vide = au-delà)`} type="number" value={row.up_to == null ? "" : String(row.up_to)}
            onChange={(v) => set("scale", (form.scale ?? []).map((r, j) => (j === i ? { ...r, up_to: v === "" ? null : Number(v) } : r)))} />
          <Field label={form.scale_mode === "percent" ? "Taux (%)" : "Montant"} type="number" value={String(row.value)}
            onChange={(v) => set("scale", (form.scale ?? []).map((r, j) => (j === i ? { ...r, value: Number(v) || 0 } : r)))} />
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => set("scale", (form.scale ?? []).filter((_, j) => j !== i))}>Retirer</Button>
        </div>)}
      </div>}

      <div className="flex items-center gap-2 pt-5"><Switch checked={form.printable} onCheckedChange={(v) => set("printable", v)} disabled={isError} /><Label className="text-xs">Afficher sur bulletin</Label></div>
      <div className="flex items-center gap-2 pt-5"><Switch checked={form.active} onCheckedChange={(v) => set("active", v)} disabled={isError} /><Label className="text-xs">Actif</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.taxable} onCheckedChange={(v) => set("taxable", v)} disabled={isError} /><Label className="text-xs">Inclus dans la base imposable</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.subject_employee_social} onCheckedChange={(v) => set("subject_employee_social", v)} disabled={isError} /><Label className="text-xs">Soumis à cotisation salariale</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.subject_employer_social} onCheckedChange={(v) => set("subject_employer_social", v)} disabled={isError} /><Label className="text-xs">Soumis à cotisation employeur</Label></div>
      {form.kind === "earning" && form.taxable && <>
        <Field label="Exonération : % du salaire de base (facultatif)" value={form.tax_exempt_pct == null ? "" : String(form.tax_exempt_pct)} type="number" disabled={isError} onChange={(v) => set("tax_exempt_pct", v ? Number(v) : null)} />
        <Field label="Exonération : plafond (facultatif)" value={form.tax_exempt_cap == null ? "" : String(form.tax_exempt_cap)} type="number" disabled={isError} onChange={(v) => set("tax_exempt_cap", v ? Number(v) : null)} />
      </>}
      {method === "fixed" && <div className="flex items-center gap-2"><Switch aria-label="Proratiser selon les jours de présence" checked={!!form.prorated} onCheckedChange={(v) => set("prorated", v)} disabled={isError} /><Label className="text-xs">Proratiser selon les jours de présence</Label></div>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button size="sm" disabled={isError || save.isPending || !valid} onClick={submit}>{editing ? "Enregistrer" : "Ajouter la rubrique"}</Button>
        {editing && <Button size="sm" variant="outline" onClick={() => { setEditing(null); setForm(blank); setTrial(""); }}>Annuler</Button>}
      </div>
    </div>}
    {isLoading ? <p className="text-xs text-muted-foreground">Chargement…</p> : !isError && <div className="overflow-x-auto">
      <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Ordre</th><th className="p-2">Code / libellé</th><th className="p-2">Nature</th><th className="p-2">Calcul</th><th className="p-2">Dates d’effet</th><th className="p-2">Statut</th>{canEdit && <th className="p-2">Action</th>}</tr></thead>
        <tbody>{[...data].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.code.localeCompare(b.code)).map((row) => <tr key={row.id} className="border-b border-border/60"><td className="p-2">{row.priority ?? 100}</td><td className="p-2"><strong>{row.code}</strong><div>{row.label}</div></td><td className="p-2">{row.kind === "earning" ? "Gain" : row.kind === "deduction" ? "Retenue" : "Charge employeur"}<div className="text-[10px] text-muted-foreground">{[row.taxable && "Imposable", row.subject_employee_social && "Cotisation salariale", row.subject_employer_social && "Cotisation employeur"].filter(Boolean).join(" · ") || "Aucune assiette"}</div></td><td className="p-2 max-w-[320px] break-words">{describe(row)}{row.cap == null ? "" : ` · plafond ${row.cap.toLocaleString("fr-FR")} ${currency}`}{row.prorated ? " · proratisé" : ""}</td><td className="p-2">{row.effective_from}{row.effective_to ? ` → ${row.effective_to}` : " → sans fin"}</td><td className="p-2"><Badge variant={row.active ? "default" : "outline"}>{row.active ? "Active" : "Inactive"}</Badge></td>{canEdit && <td className="p-2"><Button size="sm" variant="outline" onClick={() => edit(row)}>Modifier</Button></td>}</tr>)}
          {!data.length && <tr><td colSpan={canEdit ? 7 : 6} className="p-4 text-center text-muted-foreground">Aucune rubrique configurée pour cette société.</td></tr>}
        </tbody></table>
    </div>}
    {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Configurer les rubriques de paie » est requis pour modifier.</p>}
    {!isError && <PayrollBasesSection canEdit={canEdit} components={data} bases={bases} />}
  </section>;
}

function PayrollBasesSection({ canEdit, components, bases }: { canEdit: boolean; components: HrPayrollComponent[]; bases: HrPayrollBase[] }) {
  const save = useSaveHrPayrollBase();
  const empty: HrPayrollBase = { code: "", label: "", include_base_salary: true, component_codes: [], active: true };
  const [form, setForm] = useState<HrPayrollBase>(empty);
  const toggle = (code: string) => setForm((f) => ({ ...f, component_codes: f.component_codes.includes(code)
    ? f.component_codes.filter((c) => c !== code) : [...f.component_codes, code] }));
  return <div className="space-y-2 border-t border-border pt-4">
    <h3 className="text-xs font-semibold">Bases de calcul</h3>
    <p className="text-[11px] text-muted-foreground">Une base additionne le salaire de base (si coché) et les rubriques choisies (ex. « brut cotisable »). Une rubrique en % ou par barème peut s’appliquer à une base, et une formule peut la citer : [code].</p>
    <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Code</th><th className="p-2">Libellé</th><th className="p-2">Composition</th>{canEdit && <th className="p-2">Action</th>}</tr></thead>
      <tbody>{bases.map((b) => <tr key={b.id ?? b.code} className="border-b border-border/60"><td className="p-2 font-mono">{b.code}</td><td className="p-2">{b.label}{b.active ? "" : " (inactive)"}</td>
        <td className="p-2">{[b.include_base_salary && "Salaire de base", ...b.component_codes].filter(Boolean).join(" + ") || "—"}</td>
        {canEdit && <td className="p-2"><Button size="sm" variant="outline" onClick={() => setForm({ ...b })}>Modifier</Button></td>}</tr>)}
        {!bases.length && <tr><td colSpan={canEdit ? 4 : 3} className="p-3 text-center text-muted-foreground">Aucune base définie.</td></tr>}
      </tbody></table>
    {canEdit && <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
      <Field label="Code de la base" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toLowerCase().replace(/[^a-z0-9._-]/g, "") }))} />
      <Field label="Libellé de la base" value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} />
      <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" checked={form.include_base_salary} onChange={(e) => setForm((f) => ({ ...f, include_base_salary: e.target.checked }))} />Inclure le salaire de base</label>
      <div className="flex flex-wrap gap-3 sm:col-span-3">{components.map((c) => <label key={c.id} className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={form.component_codes.includes(c.code)} onChange={() => toggle(c.code)} />{c.code}</label>)}</div>
      <div className="flex gap-2 sm:col-span-3">
        <Button size="sm" disabled={save.isPending || !form.code || !form.label.trim()} onClick={() => save.mutate(form, { onSuccess: () => setForm(empty) })}>{form.id ? "Enregistrer la base" : "Ajouter la base"}</Button>
        {form.id && <Button size="sm" variant="outline" onClick={() => setForm(empty)}>Annuler</Button>}
      </div>
    </div>}
  </div>;
}

function Field({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} value={value} disabled={disabled} step={type === "number" ? "0.01" : undefined} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs" /></div>;
}

function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>;
}
