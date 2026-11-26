import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";

/** V149 — une cotisation (CNSS par branche, autre organisme…) d'une version de règles. */
export type PayrollContribution = {
  id?: string;
  code: string;
  label: string;
  organism: string | null;
  employee_rate_pct: number;
  employer_rate_pct: number;
  base_floor: number | null;
  employee_ceiling: number | null;
  employer_ceiling: number | null;
  deductible_from_tax: boolean;
  payable_account_code: string | null;
  employer_account_code: string | null;
  sort_order: number;
};

export type TaxBand = { up_to: number | null; rate_pct: number };
/** Abattement forfaitaire : catégorie de paie (vide = toutes les autres), base, taux, minimum, maximum. */
export type TaxAbatement = {
  category: string | null;
  basis: "base_salary" | "taxable_gross";
  rate_pct: number;
  min_amount: number | null;
  max_amount: number | null;
};
/** Réduction d'impôt : à partir de N charges de famille, x % de l'impôt. */
export type FamilyReduction = { dependents: number; reduction_pct: number };

export type PayrollRuleVersion = {
  id?: string;
  country_code: string;
  currency_code: string;
  effective_from: string;
  reference: string;
  notes: string | null;
  proration_method: "calendar_days" | "thirty_days";
  rounding_unit: number;
  rounding_mode: "nearest" | "down" | "up";
  taxable_rounding_unit: number | null;
  income_tax_bands: TaxBand[];
  tax_abatements: TaxAbatement[];
  family_reductions: FamilyReduction[];
  family_max_dependents: number | null;
  contributions: PayrollContribution[];
  status?: "draft" | "validated" | "archived";
  validated_at?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  issues?: string[];
};

const KEY = "payroll-rule-versions";

export function usePayrollRuleVersions() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: [KEY, tenantId, source],
    enabled: !!tenantId,
    retry: false,
    queryFn: async (): Promise<PayrollRuleVersion[]> => {
      if (isApiEnabled()) return apiGet<PayrollRuleVersion[]>("/api/v1/hr/payroll/rule-versions");
      const { data, error } = await (supabase as any).rpc("list_payroll_rule_versions");
      if (error) throw error;
      return (data ?? []) as PayrollRuleVersion[];
    },
  });
}

function useRuleMutation<A>(run: (args: A) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [KEY, tenantId] });
      await qc.invalidateQueries({ queryKey: ["hr-payroll-settings", tenantId] });
      toast.success(success);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data;
}

export function useSavePayrollRuleVersion() {
  return useRuleMutation(async (version: PayrollRuleVersion) => {
    const { status: _s, validated_at: _v, archived_at: _a, archive_reason: _r, issues: _i, ...input } = version;
    if (isApiEnabled()) return apiPost<{ id: string }>("/api/v1/hr/payroll/rule-versions", input);
    return rpc("save_payroll_rule_version", { _input: input });
  }, "Version des règles enregistrée (brouillon).");
}

export function useValidatePayrollRuleVersion() {
  return useRuleMutation(async (id: string) => {
    if (isApiEnabled()) return apiPost(`/api/v1/hr/payroll/rule-versions/${encodeURIComponent(id)}/validate`, {});
    return rpc("validate_payroll_rule_version", { _id: id });
  }, "Version validée : elle s'applique aux cycles à partir de sa date d'effet.");
}

export function useArchivePayrollRuleVersion() {
  return useRuleMutation(async ({ id, reason }: { id: string; reason: string }) => {
    if (isApiEnabled()) return apiPost(`/api/v1/hr/payroll/rule-versions/${encodeURIComponent(id)}/archive`, { reason });
    return rpc("archive_payroll_rule_version", { _id: id, _reason: reason });
  }, "Version archivée.");
}

export function useDeletePayrollRuleVersion() {
  return useRuleMutation(async (id: string) => {
    if (isApiEnabled()) return apiPost(`/api/v1/hr/payroll/rule-versions/${encodeURIComponent(id)}/delete`, {});
    return rpc("delete_payroll_rule_version", { _id: id });
  }, "Brouillon supprimé.");
}
