import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { useHrPayrollSettings } from "@/hooks/use-hr-data";
import { validatePayrollRules, type PayrollRules } from "@/lib/payroll-engine";
import { apiPost, apiPut, isApiEnabled } from "@/api/client";

type StoredTaxBand = { up_to: number | null; rate_pct: number };
type TaxBandInput = { upTo: string; ratePct: string };
function inputsFromStored(bands?: StoredTaxBand[] | null): TaxBandInput[] {
  if (!bands?.length) return [{ upTo: "", ratePct: "" }];
  return bands.map((band) => ({
    upTo: band.up_to == null ? "" : String(band.up_to),
    ratePct: String(band.rate_pct),
  }));
}

function sameTaxBands(a: StoredTaxBand[], b: StoredTaxBand[] | null | undefined): boolean {
  return !!b && a.length === b.length && a.every((band, index) =>
    band.up_to === b[index].up_to && band.rate_pct === b[index].rate_pct);
}

export function PayrollSettingsCard() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("hr.payroll_settings");
  const { data, isLoading, isError, error, refetch } = useHrPayrollSettings();

  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [employeeRate, setEmployeeRate] = useState("");
  const [employeeCap, setEmployeeCap] = useState("");
  const [employerRate, setEmployerRate] = useState("");
  const [employerCap, setEmployerCap] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reference, setReference] = useState("");
  const [bands, setBands] = useState<TaxBandInput[]>([{ upTo: "", ratePct: "" }]);
  const [proration, setProration] = useState<"calendar_days" | "thirty_days">("calendar_days");

  useEffect(() => {
    setProration(data?.proration_method === "thirty_days" ? "thirty_days" : "calendar_days");
    setCountry(data?.country_code?.trim() ?? "");
    setCurrency(data?.currency_code?.trim() ?? "");
    setEmployeeRate(data?.employee_contribution_pct == null ? "" : String(data.employee_contribution_pct));
    setEmployeeCap(data?.employee_contribution_cap == null ? "" : String(data.employee_contribution_cap));
    // V63 préremplissait 16,4 % ; ne jamais présenter cette ancienne valeur comme un taux vérifié.
    setEmployerRate(!data?.country_code || data.employer_contribution_pct == null ? "" : String(data.employer_contribution_pct));
    setEmployerCap(data?.employer_contribution_cap == null ? "" : String(data.employer_contribution_cap));
    setEffectiveFrom(data?.rules_effective_from ?? "");
    setReference(data?.rules_reference ?? "");
    setBands(inputsFromStored(data?.income_tax_bands));
  }, [data]);

  const parsedBands = useMemo(() => bands.map((band) => ({
    up_to: band.upTo.trim() ? Number(band.upTo) : null,
    rate_pct: Number(band.ratePct),
  })), [bands]);
  const rules: PayrollRules = {
    employeeSocialRate: Number(employeeRate) / 100,
    employerSocialRate: Number(employerRate) / 100,
    employeeSocialCap: employeeCap.trim() ? Number(employeeCap) : null,
    employerSocialCap: employerCap.trim() ? Number(employerCap) : null,
    taxBands: parsedBands.map((band) => ({ upTo: band.up_to, rate: band.rate_pct / 100 })),
  };
  const valid = /^[A-Z]{2}$/.test(country.trim().toUpperCase())
    && /^[A-Z]{3}$/.test(currency.trim().toUpperCase())
    && employeeRate.trim() !== ""
    && employerRate.trim() !== ""
    && bands.every((band) => band.ratePct.trim() !== "" && (!band.upTo.trim() || Number(band.upTo) > 0))
    && !!effectiveFrom
    && !!reference.trim()
    && validatePayrollRules(rules);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        country_code: country.trim().toUpperCase(),
        currency_code: currency.trim().toUpperCase(),
        employee_contribution_pct: Number(employeeRate),
        employee_contribution_cap: employeeCap.trim() ? Number(employeeCap) : null,
        employer_contribution_pct: Number(employerRate),
        employer_contribution_cap: employerCap.trim() ? Number(employerCap) : null,
        income_tax_bands: parsedBands,
        rules_effective_from: effectiveFrom,
        rules_reference: reference.trim(),
        proration_method: proration,
      };
      if (isApiEnabled()) return apiPut("/api/v1/hr/payroll/settings", payload);
      const { data: row, error } = await (supabase as any).from("hr_payroll_settings").upsert({
        tenant_id: tenantId,
        country_code: country.trim().toUpperCase(),
        currency_code: currency.trim().toUpperCase(),
        employee_contribution_pct: Number(employeeRate),
        employee_contribution_cap: employeeCap.trim() ? Number(employeeCap) : null,
        employer_contribution_pct: Number(employerRate),
        employer_contribution_cap: employerCap.trim() ? Number(employerCap) : null,
        income_tax_bands: parsedBands,
        rules_effective_from: effectiveFrom,
        rules_reference: reference.trim(),
        proration_method: proration,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!row?.length) throw new Error("Droit « Modifier les paramètres de paie » requis.");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hr-payroll-settings", tenantId] });
      toast.success("Barèmes enregistrés. Confirmez-les après vérification de la source officielle.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (isApiEnabled()) return apiPost("/api/v1/hr/payroll/settings/confirm", {});
      const { error } = await (supabase as any).rpc("confirm_payroll_rules");
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hr-payroll-settings", tenantId] });
      toast.success("Barèmes confirmés pour les prochains calculs de paie.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isDirty = !!data && (
    country.trim().toUpperCase() !== data.country_code?.trim()
    || currency.trim().toUpperCase() !== data.currency_code?.trim()
    || Number(employeeRate) !== Number(data.employee_contribution_pct)
    || (employeeCap.trim() ? Number(employeeCap) : null) !== data.employee_contribution_cap
    || Number(employerRate) !== Number(data.employer_contribution_pct)
    || (employerCap.trim() ? Number(employerCap) : null) !== data.employer_contribution_cap
    || effectiveFrom !== data.rules_effective_from
    || reference.trim() !== (data.rules_reference ?? "")
    || !sameTaxBands(parsedBands, data.income_tax_bands)
    || proration !== (data.proration_method === "thirty_days" ? "thirty_days" : "calendar_days")
  );
  const ready = !!data?.rules_validated_at && !isDirty;

  return (
    <section aria-label="Barèmes de paie par pays" className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Règles actuelles (format initial)</h2>
          <p className="text-xs text-muted-foreground mt-1">Utilisées tant qu’aucune version datée n’est validée ci-dessus. Chaque cycle conserve une photographie des règles appliquées.</p>
        </div>
        {ready
          ? <Badge className="bg-success/10 text-success">Confirmés · {data?.country_code}</Badge>
          : <Badge variant="outline">À configurer ou confirmer</Badge>}
      </div>

      {isError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
        <span className="text-destructive">Les paramètres de paie n’ont pas pu être chargés{error instanceof Error ? ` : ${error.message}` : "."} Enregistrement bloqué pour éviter d’écraser des règles existantes.</span>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void refetch()}>Réessayer</Button>
      </div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="pay-country-code" label="Code pays (ISO 3166-1 alpha-2)" value={country} disabled={!canEdit || isLoading || isError} onChange={(v) => setCountry(v.toUpperCase().slice(0, 2))} placeholder="Ex. BF" />
        <Field id="pay-currency-code" label="Devise (ISO 4217)" value={currency} disabled={!canEdit || isLoading || isError} onChange={(v) => setCurrency(v.toUpperCase().slice(0, 3))} placeholder="Ex. XOF" />
        <Field id="pay-employee-rate" label="Cotisation salariale (%)" value={employeeRate} disabled={!canEdit || isLoading || isError} onChange={setEmployeeRate} type="number" />
        <Field id="pay-employee-cap" label="Plafond salarié (facultatif)" value={employeeCap} disabled={!canEdit || isLoading || isError} onChange={setEmployeeCap} type="number" />
        <Field id="pay-employer-rate" label="Cotisation employeur (%)" value={employerRate} disabled={!canEdit || isLoading || isError} onChange={setEmployerRate} type="number" />
        <Field id="pay-employer-cap" label="Plafond employeur (facultatif)" value={employerCap} disabled={!canEdit || isLoading || isError} onChange={setEmployerCap} type="number" />
        <Field id="pay-effective-from" label="Date d’effet" value={effectiveFrom} disabled={!canEdit || isLoading || isError} onChange={setEffectiveFrom} type="date" />
        <div className="space-y-1.5">
          <Label htmlFor="pay-proration-method" className="text-xs">Prorata des entrées et sorties en cours de mois</Label>
          <select id="pay-proration-method" value={proration} disabled={!canEdit || isLoading || isError}
            onChange={(e) => setProration(e.target.value === "thirty_days" ? "thirty_days" : "calendar_days")}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
            <option value="calendar_days">Jours calendaires du mois</option>
            <option value="thirty_days">Mois de 30 jours</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pay-rules-reference" className="text-xs">Source officielle / référence juridique</Label>
          <Input id="pay-rules-reference" value={reference} disabled={!canEdit || isLoading || isError} onChange={(e) => setReference(e.target.value)} className="h-8 text-xs" placeholder="Autorité, texte et article ou URL officielle" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-medium">Impôt progressif sur le salaire imposable</h3>
            <p className="text-[11px] text-muted-foreground">Saisissez les limites supérieures dans l’ordre. Laissez vide la limite de la dernière tranche.</p>
          </div>
          {canEdit && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={isError} onClick={() => setBands((rows) => [...rows, { upTo: "", ratePct: "" }])}>Ajouter une tranche</Button>}
        </div>
        <div className="space-y-2">
          {bands.map((band, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end max-w-xl">
              <Field id={`pay-band-up-to-${index}`} label={`Limite supérieure ${index + 1} (vide = sans limite)`} value={band.upTo} disabled={!canEdit || isError} onChange={(v) => setBands((rows) => rows.map((row, i) => i === index ? { ...row, upTo: v } : row))} type="number" />
              <Field id={`pay-band-rate-${index}`} label="Taux marginal (%)" value={band.ratePct} disabled={!canEdit || isError} onChange={(v) => setBands((rows) => rows.map((row, i) => i === index ? { ...row, ratePct: v } : row))} type="number" />
              {canEdit && bands.length > 1 && <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" aria-label={`Supprimer la tranche ${index + 1}`} onClick={() => setBands((rows) => rows.filter((_, i) => i !== index))}>Retirer</Button>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-muted-foreground">
        Aucun taux légal n’est prérempli. La personne responsable doit saisir les règles applicables et vérifier la source officielle avant de les confirmer. Toute modification retire la confirmation ; les cycles existants conservent leurs règles d’origine.
      </div>

      {canEdit && <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-8 text-xs" disabled={!valid || isError || !tenantId || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Enregistrement…" : "Enregistrer les règles"}</Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!valid || isError || !data || isDirty || ready || confirm.isPending || save.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "Confirmation…" : "Confirmer les barèmes"}</Button>
      </div>}
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres de paie » est requis.</p>}
      {data?.rules_validated_at && <p className="text-[11px] text-muted-foreground">Confirmés le {new Date(data.rules_validated_at).toLocaleString("fr-FR")} · référence enregistrée sur chaque cycle calculé.</p>}
    </section>
  );
}

function Field({ id, label, value, onChange, disabled, type = "text", placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  disabled?: boolean; type?: string; placeholder?: string;
}) {
  return <div className="space-y-1.5">
    <Label htmlFor={id} className="text-xs">{label}</Label>
    <Input id={id} type={type} step={type === "number" ? "0.01" : undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-xs" />
  </div>;
}
