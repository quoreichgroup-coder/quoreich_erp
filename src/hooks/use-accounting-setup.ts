import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";
import {
  buildAccountingSetup,
  toFramework,
  toGlAccountOption,
  type AccountingFramework,
  type AccountingSetup,
  type GlAccountOption,
  type RawFramework,
  type RawGlAccount,
  type RawMapping,
  type RawPostingRole,
  type RawRoleDefault,
} from "@/lib/accounting-setup";

/*
 * Paramétrage comptable. Deux sources, une seule forme de données : l'API Java quand
 * VITE_QERP_API_URL est définie, sinon Supabase (les tables V18 ne sont pas encore dans les
 * types générés, d'où `supabase as any`). La source fait partie de la clé de cache, comme pour
 * les factures AR, et la société aussi : un changement de société ne sert jamais le paramétrage
 * d'une autre.
 *
 * retry: false — un paramétrage illisible doit se voir tout de suite, pas après trois essais.
 */
const db = supabase as any;
const source = () => (isApiEnabled() ? "api" : "supabase");

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

async function fetchSetupFromSupabase(): Promise<AccountingSetup> {
  const [settings, roles, mappings, accounts, canEdit] = await Promise.all([
    check<{ accounting_frameworks: RawFramework }[]>(
      db.from("tenant_accounting_settings").select("accounting_frameworks(code, name, scope, version, is_validated)"),
    ),
    check<RawPostingRole[]>(db.from("posting_roles").select("code, label, module, description")),
    check<RawMapping[]>(db.from("tenant_posting_accounts").select("role_code, gl_account_id")),
    check<RawGlAccount[]>(db.from("gl_accounts").select("id, code, name, account_type, is_active")),
    check<boolean>(db.rpc("is_tenant_admin")),
  ]);
  const framework = settings[0]?.accounting_frameworks ?? null;
  const defaults = framework
    ? await check<RawRoleDefault[]>(
        db.from("accounting_framework_role_defaults").select("role_code, account_code").eq("framework_code", framework.code),
      )
    : [];
  return buildAccountingSetup({ framework, canEdit: Boolean(canEdit), roles, mappings, accounts, defaults });
}

export function useAccountingSetup() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["accounting-setup", tenantId, source()],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: () =>
      isApiEnabled() ? apiGet<AccountingSetup>("/api/v1/accounting/setup") : fetchSetupFromSupabase(),
  });
}

export function useAccountingFrameworks() {
  return useQuery({
    queryKey: ["accounting-frameworks", source()],
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<AccountingFramework[]> =>
      isApiEnabled()
        ? apiGet<AccountingFramework[]>("/api/v1/accounting/frameworks")
        : (await check<RawFramework[]>(
            db.from("accounting_frameworks").select("code, name, scope, version, is_validated").order("code"),
          )).map(toFramework),
  });
}

/** Comptes du plan de la société, pour choisir le compte d'un rôle. */
export function useGlAccountOptions() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["accounting-gl-accounts", tenantId, source()],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<GlAccountOption[]> =>
      isApiEnabled()
        ? apiGet<GlAccountOption[]>("/api/v1/accounting/gl-accounts")
        : (await check<RawGlAccount[]>(
            db.from("gl_accounts").select("id, code, name, account_type, is_active").order("code"),
          )).map(toGlAccountOption),
  });
}

function useInvalidateSetup() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["accounting-setup"] });
    qc.invalidateQueries({ queryKey: ["accounting-gl-accounts"] });
  };
}

export function useApplyAccountingFramework() {
  const invalidate = useInvalidateSetup();
  return useMutation({
    mutationFn: async (framework: string) => {
      if (isApiEnabled()) {
        return apiPost<{ accountsCreated: number; rolesAssigned: number }>(
          `/api/v1/accounting/frameworks/${encodeURIComponent(framework)}/apply`, {},
        );
      }
      const r = await check<{ comptes_crees: number; roles_parametres: number }>(
        db.rpc("apply_accounting_framework", { _framework: framework }),
      );
      return { accountsCreated: r.comptes_crees, rolesAssigned: r.roles_parametres };
    },
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.rolesAssigned === 0 && r.accountsCreated === 0
          ? "Référentiel déjà appliqué : rien n'a changé"
          : `Référentiel appliqué : ${r.accountsCreated} compte(s) créé(s), ${r.rolesAssigned} rôle(s) paramétré(s)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssignPostingAccount() {
  const invalidate = useInvalidateSetup();
  return useMutation({
    mutationFn: async ({ role, glAccountId }: { role: string; glAccountId: string }) => {
      if (isApiEnabled()) {
        return apiPut(`/api/v1/accounting/posting-accounts/${encodeURIComponent(role)}`, { glAccountId });
      }
      const [tenant_id, { data: auth }] = await Promise.all([fetchTenantId(), supabase.auth.getUser()]);
      // La politique RLS « Administrateur de la société » et la clé composite (compte de la
      // société) sont la barrière réelle ; une ligne filtrée remonte ici en erreur.
      return check(
        db
          .from("tenant_posting_accounts")
          .upsert(
            { tenant_id, role_code: role, gl_account_id: glAccountId, updated_by: auth.user?.id, updated_at: new Date().toISOString() },
            { onConflict: "tenant_id,role_code" },
          )
          .select("role_code"),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success("Compte de comptabilisation enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
