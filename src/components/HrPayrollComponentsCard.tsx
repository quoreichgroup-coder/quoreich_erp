import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMyAccess } from "@/hooks/use-my-access";
import { useHrPayrollComponents, useHrPayrollSettings, useSaveHrPayrollComponent, type HrPayrollComponent } from "@/hooks/use-hr-data";
import { hrErrorMessage } from "@/lib/hr-error-message";

type Form = Omit<HrPayrollComponent, "id" | "tenant_id">;
const blank: Form = {
  code: "", label: "", kind: "earning", calculation_method: "fixed", amount: 0, cap: null,
  effective_from: new Date().toISOString().slice(0, 10), effective_to: null,
  gl_account_code: null, printable: true, active: true, sort_order: 0,
  taxable: false, subject_employee_social: false, subject_employer_social: false,
};

export function HrPayrollComponentsCard() {
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("hr.manage_payroll_components");
  const { data = [], isLoading, isError, error, refetch } = useHrPayrollComponents();
  const { data: payrollSettings } = useHrPayrollSettings();
  const currency = payrollSettings?.currency_code?.trim() || "";
  const save = useSaveHrPayrollComponent();
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((old) => ({ ...old, [key]: value }));
  const edit = (row: HrPayrollComponent) => {
    const { id, tenant_id: _tenant, ...values } = row;
    setEditing(id);
    setForm(values);
  };
  const submit = () => {
    if (!form.code.trim() || !form.label.trim() || form.amount <= 0
      || (form.calculation_method === "percent_base" && form.amount > 100) || !form.effective_from) return;
    save.mutate(form, { onSuccess: () => { setForm(blank); setEditing(null); } });
  };

  return <section aria-label="Rubriques de paie" className="mt-4 space-y-4 rounded-lg border border-border bg-card p-4">
    <div>
      <h2 className="text-sm font-semibold">Rubriques et éléments de rémunération</h2>
      <p className="mt-1 text-xs text-muted-foreground">Définissez les gains, retenues et charges, leurs dates d’effet et leurs comptes. Aucune rubrique ni règle légale n’est préremplie.</p>
    </div>
    {isError && <div role="alert" className="flex items-center justify-between rounded border border-destructive/30 p-3 text-xs text-destructive">
      <span>Impossible de charger les rubriques{hrErrorMessage(error) ? ` : ${hrErrorMessage(error)}` : "."}</span>
      <Button size="sm" variant="outline" onClick={() => void refetch()}>Réessayer</Button>
    </div>}
    {canEdit && <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Code" value={form.code} disabled={isError} onChange={(v) => set("code", v.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} />
      <Field label="Libellé" value={form.label} disabled={isError} onChange={(v) => set("label", v)} />
      <SelectField label="Nature" value={form.kind} disabled={isError} onChange={(v) => set("kind", v as Form["kind"])} options={[["earning", "Gain"], ["deduction", "Retenue"], ["employer_charge", "Charge employeur"]]} />
      <SelectField label="Calcul" value={form.calculation_method} disabled={isError} onChange={(v) => set("calculation_method", v as Form["calculation_method"])} options={[["fixed", "Montant fixe"], ["percent_base", "% du salaire de base"]]} />
      <Field label={form.calculation_method === "fixed" ? "Montant" : "Taux (%)"} value={String(form.amount)} type="number" disabled={isError} onChange={(v) => set("amount", Number(v))} />
      <Field label="Plafond (facultatif)" value={form.cap == null ? "" : String(form.cap)} type="number" disabled={isError} onChange={(v) => set("cap", v ? Number(v) : null)} />
      <Field label="Date d’effet" value={form.effective_from} type="date" disabled={isError} onChange={(v) => set("effective_from", v)} />
      <Field label="Fin d’effet (facultatif)" value={form.effective_to ?? ""} type="date" disabled={isError} onChange={(v) => set("effective_to", v || null)} />
      <Field label="Compte comptable (facultatif)" value={form.gl_account_code ?? ""} disabled={isError} onChange={(v) => set("gl_account_code", v || null)} />
      <Field label="Ordre d’affichage" value={String(form.sort_order)} type="number" disabled={isError} onChange={(v) => set("sort_order", Number(v))} />
      <div className="flex items-center gap-2 pt-5"><Switch checked={form.printable} onCheckedChange={(v) => set("printable", v)} disabled={isError} /><Label className="text-xs">Afficher sur bulletin</Label></div>
      <div className="flex items-center gap-2 pt-5"><Switch checked={form.active} onCheckedChange={(v) => set("active", v)} disabled={isError} /><Label className="text-xs">Actif</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.taxable} onCheckedChange={(v) => set("taxable", v)} disabled={isError} /><Label className="text-xs">Inclus dans la base imposable</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.subject_employee_social} onCheckedChange={(v) => set("subject_employee_social", v)} disabled={isError} /><Label className="text-xs">Soumis à cotisation salariale</Label></div>
      <div className="flex items-center gap-2"><Switch checked={form.subject_employer_social} onCheckedChange={(v) => set("subject_employer_social", v)} disabled={isError} /><Label className="text-xs">Soumis à cotisation employeur</Label></div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button size="sm" disabled={isError || save.isPending || !form.code.trim() || !form.label.trim() || form.amount <= 0 || (form.calculation_method === "percent_base" && form.amount > 100)} onClick={submit}>{editing ? "Enregistrer" : "Ajouter la rubrique"}</Button>
        {editing && <Button size="sm" variant="outline" onClick={() => { setEditing(null); setForm(blank); }}>Annuler</Button>}
      </div>
    </div>}
    {isLoading ? <p className="text-xs text-muted-foreground">Chargement…</p> : !isError && <div className="overflow-x-auto">
      <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Code / libellé</th><th className="p-2">Nature</th><th className="p-2">Calcul</th><th className="p-2">Dates d’effet</th><th className="p-2">Statut</th>{canEdit && <th className="p-2">Action</th>}</tr></thead>
        <tbody>{data.map((row) => <tr key={row.id} className="border-b border-border/60"><td className="p-2"><strong>{row.code}</strong><div>{row.label}</div></td><td className="p-2">{row.kind === "earning" ? "Gain" : row.kind === "deduction" ? "Retenue" : "Charge employeur"}<div className="text-[10px] text-muted-foreground">{[row.taxable && "Imposable", row.subject_employee_social && "Cotisation salariale", row.subject_employer_social && "Cotisation employeur"].filter(Boolean).join(" · ") || "Aucune assiette"}</div></td><td className="p-2">{row.calculation_method === "fixed" ? `${row.amount.toLocaleString("fr-FR")} ${currency || "(devise à configurer)"}` : `${row.amount}% du salaire de base`}{row.cap == null ? "" : ` · plafond ${row.cap.toLocaleString("fr-FR")} ${currency}`}</td><td className="p-2">{row.effective_from}{row.effective_to ? ` → ${row.effective_to}` : " → sans fin"}</td><td className="p-2"><Badge variant={row.active ? "default" : "outline"}>{row.active ? "Active" : "Inactive"}</Badge></td>{canEdit && <td className="p-2"><Button size="sm" variant="outline" onClick={() => edit(row)}>Modifier</Button></td>}</tr>)}
          {!data.length && <tr><td colSpan={canEdit ? 6 : 5} className="p-4 text-center text-muted-foreground">Aucune rubrique configurée pour cette société.</td></tr>}
        </tbody></table>
    </div>}
    {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Configurer les rubriques de paie » est requis pour modifier.</p>}
  </section>;
}

function Field({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} value={value} disabled={disabled} step={type === "number" ? "0.01" : undefined} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs" /></div>;
}

function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>;
}
