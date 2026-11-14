import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";

/*
 * Référentiels comptables versionnés et règles de qualité (V64, lot PC-3). Les référentiels, versions
 * et règles sont des données de plateforme en lecture seule ; la société n'en règle que l'activation
 * et la gravité (tenant_quality_rules, droit accounting.chart_admin).
 */
export type Framework = {
  code: string; name: string; short_label: string | null; kind: string; country: string | null; version: string | null;
  is_validated: boolean; notes: string | null;
};
export type FrameworkVersion = { framework_code: string; version: string; effective_from: string; status: string; notes: string | null };
export type QualityRule = { framework_code: string; rule_code: string; label: string; severity: Severity; enabled: boolean; params: Record<string, unknown> };
export type TenantRule = { rule_code: string; enabled: boolean; severity: Severity | null };
export type Severity = "error" | "warning" | "info";
export type OperationalChart = { id: string; name: string; framework_code: string | null; framework_version: string | null };

const db = supabase as any;

export function useFrameworks() {
  return useQuery({
    queryKey: ["accounting-frameworks"],
    queryFn: async () => {
      const [f, v, n] = await Promise.all([
        db.from("accounting_frameworks").select("*").order("code"),
        db.from("framework_versions").select("*").order("effective_from", { ascending: false }),
        db.from("framework_reference_accounts").select("framework_code"),
      ]);
      for (const r of [f, v, n]) if (r.error) throw r.error;
      const counts: Record<string, number> = {};
      for (const r of n.data ?? []) counts[r.framework_code] = (counts[r.framework_code] ?? 0) + 1;
      return { frameworks: (f.data ?? []) as Framework[], versions: (v.data ?? []) as FrameworkVersion[], referenceCounts: counts };
    },
  });
}

export function useOperationalChart() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["operational-chart", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("charts").select("id, name, framework_code, framework_version")
        .eq("tenant_id", tenantId).eq("kind", "operational").eq("status", "active").maybeSingle();
      if (error) throw error;
      return data as OperationalChart | null;
    },
  });
}

/** Référentiel effectif : celui du plan opérationnel, sinon SYSCOHADA (même règle que chart_framework). */
export const effectiveFramework = (chart: OperationalChart | null | undefined) => chart?.framework_code ?? "SYSCOHADA_REVISE";

export function useQualityRules(framework: string | undefined) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["quality-rules", tenantId, framework],
    enabled: !!tenantId && !!framework,
    queryFn: async () => {
      const [r, t] = await Promise.all([
        db.from("framework_quality_rules").select("*").eq("framework_code", framework).order("rule_code"),
        db.from("tenant_quality_rules").select("rule_code, enabled, severity").eq("tenant_id", tenantId),
      ]);
      if (r.error) throw r.error;
      if (t.error) throw t.error;
      return { rules: (r.data ?? []) as QualityRule[], overrides: (t.data ?? []) as TenantRule[] };
    },
  });
}

/** Activation et gravité effectives (miroir de quality_rule_severity). */
export function effectiveRule(rule: QualityRule, override: TenantRule | undefined): { enabled: boolean; severity: Severity } {
  if (override) return { enabled: override.enabled, severity: override.severity ?? rule.severity };
  return { enabled: rule.enabled, severity: rule.severity };
}

/** Motif des codes de compte imposé par le référentiel (null = règle désactivée ou absente). */
export function useCodePattern(): RegExp | null {
  const { data: chart } = useOperationalChart();
  const { data } = useQualityRules(effectiveFramework(chart));
  const rule = data?.rules.find((r) => r.rule_code === "CODE_FORMAT");
  if (!rule) return null;
  const eff = effectiveRule(rule, data?.overrides.find((o) => o.rule_code === "CODE_FORMAT"));
  const pattern = typeof rule.params?.pattern === "string" ? rule.params.pattern : null;
  if (!eff.enabled || eff.severity !== "error" || !pattern) return null;
  try { return new RegExp(pattern); } catch { return null; }
}

export function useSetQualityRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { rule_code: string; enabled: boolean; severity: Severity | null } | { rule_code: string; reset: true }) => {
      const tenantId = await fetchTenantId();
      if ("reset" in v) {
        const { error } = await db.from("tenant_quality_rules").delete().eq("tenant_id", tenantId).eq("rule_code", v.rule_code);
        if (error) throw error;
        return;
      }
      const { data, error } = await db.from("tenant_quality_rules")
        .upsert({ tenant_id: tenantId, rule_code: v.rule_code, enabled: v.enabled, severity: v.severity, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id,rule_code" }).select("rule_code");
      if (error) throw error;
      if (!data?.length) throw new Error("Refusé : droit « Administrer le plan comptable » requis.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality-rules"] });
      qc.invalidateQueries({ queryKey: ["chart-issues"] });
      toast.success("Règle de qualité enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
