import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import type { AccountSetKind } from "@/lib/account-sets";

/*
 * Jeux de comptes (V105) : par client, fournisseur ou article, le compte de certains rôles de
 * comptabilisation remplace le compte par défaut de la société. Écriture réservée au droit
 * « accounting.account_sets » (RLS) ; les comptes de bilan sont verrouillés par la base tant que des
 * postes ouverts les utilisent (QG026), sauf si le paramètre de verrouillage est désactivé.
 */
const db = supabase as any;

export interface AccountSetLine { role_code: string; gl_account_id: string }
export interface AccountSet {
  id: string; kind: AccountSetKind; code: string; name: string; is_active: boolean;
  lines: AccountSetLine[]; members: number;
}
export interface RoleKind { kind: AccountSetKind; role_code: string; control: boolean }

const MEMBER_TABLE: Record<AccountSetKind, string> = { customer: "customers", supplier: "suppliers", item: "items" };

/** Une mise à jour ou suppression filtrée en silence par la RLS est un refus. */
function touched(data: unknown[] | null, what: string) {
  if (!data || data.length === 0) throw new Error(`${what} : droit « accounting.account_sets » requis, ou élément introuvable.`);
}

export function useRoleKinds() {
  return useQuery({
    queryKey: ["posting-role-set-kinds"],
    staleTime: Infinity,
    queryFn: async (): Promise<RoleKind[]> => {
      const { data, error } = await db.from("posting_role_set_kinds").select("kind, role_code, control").order("role_code");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAccountSets(kind?: AccountSetKind) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["account-sets", tenantId, kind ?? "all"],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: async (): Promise<AccountSet[]> => {
      let q = db.from("posting_account_sets").select("id, kind, code, name, is_active, lines:posting_account_set_lines(role_code, gl_account_id)")
        .eq("tenant_id", tenantId).order("code");
      if (kind) q = q.eq("kind", kind);
      const { data, error } = await q;
      if (error) throw error;
      const sets = (data ?? []) as Omit<AccountSet, "members">[];
      // Nombre de fiches rattachées, par type (une requête par type présent).
      const counts = new Map<string, number>();
      for (const k of [...new Set(sets.map((s) => s.kind))]) {
        const { data: m, error: e } = await db.from(MEMBER_TABLE[k]).select("account_set_id").eq("tenant_id", tenantId).not("account_set_id", "is", null);
        if (e) throw e;
        for (const r of m ?? []) counts.set(r.account_set_id, (counts.get(r.account_set_id) ?? 0) + 1);
      }
      return sets.map((s) => ({ ...s, lines: s.lines ?? [], members: counts.get(s.id) ?? 0 }));
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["account-sets"] });
}

export function useCreateAccountSet() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { kind: AccountSetKind; code: string; name: string }) => {
      const tenant_id = await fetchTenantId();
      const { error } = await db.from("posting_account_sets").insert({ tenant_id, ...input });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Jeu de comptes créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccountSet() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; is_active?: boolean }) => {
      const { data, error } = await db.from("posting_account_sets").update(patch).eq("id", id).select("id");
      if (error) throw error;
      touched(data, "Modification du jeu");
    },
    onSuccess: () => { invalidate(); toast.success("Jeu de comptes mis à jour"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAccountSet() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.from("posting_account_sets").delete().eq("id", id).select("id");
      if (error) throw new Error(/foreign key|violates/i.test(error.message) ? "Jeu utilisé par des fiches : le désactiver, ou retirer d'abord ses fiches." : error.message);
      touched(data, "Suppression du jeu");
    },
    onSuccess: () => { invalidate(); toast.success("Jeu de comptes supprimé"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Compte d'un rôle dans un jeu : `glAccountId` vide = le rôle reprend le compte par défaut de la société. */
export function useSetAccountSetLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ set, role, glAccountId }: { set: AccountSet; role: string; glAccountId: string | null }) => {
      const exists = set.lines.some((l) => l.role_code === role);
      if (!glAccountId) {
        if (!exists) return;
        const { data, error } = await db.from("posting_account_set_lines").delete().eq("set_id", set.id).eq("role_code", role).select("role_code");
        if (error) throw error;
        touched(data, "Retrait du compte");
        return;
      }
      if (exists) {
        const { data, error } = await db.from("posting_account_set_lines").update({ gl_account_id: glAccountId })
          .eq("set_id", set.id).eq("role_code", role).select("role_code");
        if (error) throw error;
        touched(data, "Modification du compte");
      } else {
        const tenant_id = await fetchTenantId();
        const { error } = await db.from("posting_account_set_lines").insert({ set_id: set.id, tenant_id, kind: set.kind, role_code: role, gl_account_id: glAccountId });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast.success("Compte du jeu enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostingLock() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["posting-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await db.from("posting_settings").select("lock_control_accounts").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data?.lock_control_accounts ?? true;
    },
  });
}

export function useSetPostingLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await db.from("posting_settings").upsert({ tenant_id, lock_control_accounts: on }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      touched(data, "Paramètre de verrouillage");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["posting-settings"] }); toast.success("Paramètre enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
