import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";

/*
 * Contrôles du grand livre (V106) : fonctions SECURITY INVOKER de la base (la RLS limite à la société),
 * paramètres par société (droit « accounting.controls »), examens tracés des anomalies.
 * Pas de nouvelle tentative automatique : une erreur s'affiche et l'utilisateur relance.
 */
const db = supabase as any;

export interface GlFinding {
  check_code: string; severity: "critical" | "warning" | "info"; entry_id: string; piece_number: string | null;
  entry_date: string; amount: number; detail: string; reviewed: boolean; review_comment: string | null;
}
export interface GlIntegrityCheck { check_code: string; label: string; status: "pass" | "warning" | "fail"; issues: number; detail: string }
export interface GlReconciliation { area: string; label: string; subledger: number; ledger: number; difference: number; status: "pass" | "warning"; detail: string }
export interface GlControlSettings {
  large_entry_threshold: number | null; duplicate_window_days: number; backdating_days: number | null;
  subledger_tolerance: number; disabled_checks: string[];
}

export const CHECK_LABELS: Record<string, string> = {
  UNBALANCED: "Écriture déséquilibrée",
  EMPTY_POSTED: "Écriture sans ligne",
  LARGE_ENTRY: "Montant au-delà du seuil",
  DUPLICATE: "Doublon probable",
  SOD: "Saisie et comptabilisation par la même personne",
  BACKDATED: "Comptabilisation tardive",
  INACTIVE_ACCOUNT: "Compte devenu inactif",
};
/** Contrôles désactivables (anomalies, intégrité, concordances). */
export const DISABLEABLE_CHECKS: [string, string][] = [
  ...Object.entries(CHECK_LABELS).filter(([c]) => !["UNBALANCED", "EMPTY_POSTED"].includes(c)),
  ["PIECE_SEQUENCE", "Continuité de la numérotation"], ["AUDIT_TRAIL", "Trace d'audit des écritures"], ["CHART", "Conformité du plan comptable"],
  ["RECON_AR", "Concordance clients"], ["RECON_ADVANCES", "Concordance acomptes clients"], ["RECON_AP", "Concordance fournisseurs"],
  ["RECON_TRE", "Concordance trésorerie"], ["RECON_STK", "Concordance stock"],
];

export function useGlFindings(from: string, to: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-findings", tenantId, from, to],
    enabled: Boolean(tenantId && from && to),
    retry: false,
    queryFn: async (): Promise<GlFinding[]> => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>(`/api/v1/gl/controls/findings?from=${from}&to=${to}`), error: null }
        : await db.rpc("gl_control_findings", { _from: from, _to: to });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
    },
  });
}

export function useGlIntegrity() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-integrity", tenantId],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<GlIntegrityCheck[]> => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>("/api/v1/gl/controls/integrity"), error: null } : await db.rpc("gl_integrity_checks");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, issues: Number(r.issues) }));
    },
  });
}

export function useGlReconciliation(asOf: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-reconciliation", tenantId, asOf],
    enabled: Boolean(tenantId && asOf),
    retry: false,
    queryFn: async (): Promise<GlReconciliation[]> => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any[]>(`/api/v1/gl/controls/reconciliation?asOf=${asOf}`), error: null }
        : await db.rpc("gl_subledger_reconciliation", { _as_of: asOf });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, subledger: Number(r.subledger), ledger: Number(r.ledger), difference: Number(r.difference) }));
    },
  });
}

export function useGlControlSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-control-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<GlControlSettings> => {
      const { data, error } = isApiEnabled() ? { data: await apiGet<any>("/api/v1/gl/controls/settings"), error: null }
        : await db.from("gl_control_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return {
        large_entry_threshold: data?.large_entry_threshold == null ? null : Number(data.large_entry_threshold),
        duplicate_window_days: data?.duplicate_window_days ?? 3,
        backdating_days: data?.backdating_days ?? null,
        subledger_tolerance: Number(data?.subledger_tolerance ?? 0),
        disabled_checks: data?.disabled_checks ?? [],
      };
    },
  });
}

function useInvalidateControls() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["gl-findings", "gl-integrity", "gl-reconciliation", "gl-control-settings"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useSaveGlControlSettings() {
  const invalidate = useInvalidateControls();
  return useMutation({
    mutationFn: async (s: GlControlSettings) => {
      const tenant_id = await fetchTenantId();
      if (isApiEnabled()) { await apiPut("/api/v1/gl/controls/settings", s); return; }
      const { data, error } = await db.from("gl_control_settings").upsert({ tenant_id, ...s, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Droit « accounting.controls » requis pour modifier les contrôles.");
    },
    onSuccess: () => { invalidate(); toast.success("Paramètres des contrôles enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReviewFinding() {
  const invalidate = useInvalidateControls();
  return useMutation({
    mutationFn: async ({ check, entryId, comment }: { check: string; entryId: string; comment: string }) => {
      const tenant_id = await fetchTenantId();
      const { error } = isApiEnabled() ? (await apiPost("/api/v1/gl/controls/reviews", { check_code: check, entry_id: entryId, comment }), { error: null })
        : await db.from("gl_control_reviews").insert({ tenant_id, check_code: check, entry_id: entryId, comment });
      if (error) throw new Error(/row-level security/i.test(error.message) ? "Droit « accounting.controls » requis pour examiner une anomalie." : error.message);
    },
    onSuccess: () => { invalidate(); toast.success("Examen enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface GlAuditRow { id: string; created_at: string; action: string; user_name: string | null; details: string | null; piece_number: string | null; entry_id: string | null }

/** Piste d'audit comptable : toutes les pages, plus récent d'abord (lecture seule depuis V106). */
export function useGlAuditTrail(from: string, to: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-audit-trail", tenantId, from, to],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<GlAuditRow[]> => {
      const all: GlAuditRow[] = [];
      for (let start = 0; ; start += 1000) {
        if (isApiEnabled()) { all.push(...await apiGet<any[]>(`/api/v1/gl/audit-logs?from=${from}&to=${to}`)); break; }
        // Pas de jointure : la piste garde une référence historique (V121, plus de clé vers journal_entries). Le numéro de
        // pièce vient de l'instantané enregistré avec l'événement (V120), sinon d'une lecture des écritures encore présentes.
        const { data, error } = await db.from("gl_audit_logs")
          .select("id, seq, created_at, action, user_name, details, entry_id, snapshot")
          .eq("tenant_id", tenantId).gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59.999`)
          .order("seq", { ascending: false }).range(start, start + 999);
        if (error) throw error;
        const rows = (data ?? []) as any[];
        const missing = [...new Set(rows.filter((r) => !r.snapshot?.piece_number && r.entry_id).map((r) => r.entry_id as string))];
        const pieces = new Map<string, string | null>();
        for (let i = 0; i < missing.length; i += 200) {
          const { data: je, error: jeErr } = await db.from("journal_entries").select("id, piece_number").in("id", missing.slice(i, i + 200));
          if (jeErr) throw jeErr;
          for (const e of je ?? []) pieces.set(e.id, e.piece_number);
        }
        all.push(...rows.map((r) => ({ ...r, piece_number: r.snapshot?.piece_number ?? pieces.get(r.entry_id) ?? null })));
        if (rows.length < 1000) break;
      }
      return all;
    },
  });
}
