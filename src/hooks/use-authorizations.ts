import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId, fetchTenantId } from "@/hooks/use-tenant";
import { apiDelete, apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";
import {
  buildAuthorizations, type Authorizations, type AuthorizationAudit, type Permission,
  type RawRole, type RawSystemRole,
} from "@/lib/authorizations";

/*
 * Matrice des autorisations : deux sources, une forme (voir use-accounting-setup.ts). Côté
 * Supabase, les écritures vont directement dans les tables ; la base impose les règles (V23,
 * V26 : rôle système intouchable, dernier administrateur, rôle à revoir, rôle affecté) et tient
 * le journal (V25). Son message remonte tel quel.
 */
const db = supabase as any;
const source = () => (isApiEnabled() ? "api" : "supabase");

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

/** Sous la RLS, une ligne non autorisée est filtrée sans erreur : zéro ligne touchée est un refus. */
async function checkTouched(p: PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<void> {
  const rows = await check(p);
  if (!rows || rows.length === 0) {
    throw new Error("Modification refusée : élément introuvable ou droits insuffisants dans la société courante");
  }
}

async function fetchFromSupabase(): Promise<Authorizations> {
  const [catalog, roles, systemRoles, rolePermissions, assignments, profiles, canManage] = await Promise.all([
    check<Permission[]>(db.from("erp_permission_catalog").select("code, module, action, label")),
    check<RawRole[]>(db.from("erp_roles").select("id, name, description, code, is_system, needs_review")),
    check<RawSystemRole[]>(db.from("erp_system_roles").select("code, module")),
    check<{ role_id: string; permission_code: string }[]>(db.from("erp_role_permissions").select("role_id, permission_code")),
    check<{ user_id: string; role_id: string }[]>(db.from("user_role_assignments").select("user_id, role_id")),
    check<{ id: string; full_name: string | null }[]>(db.from("profiles").select("id, full_name")),
    check<boolean>(db.rpc("is_tenant_admin")),
  ]);
  return buildAuthorizations({ canManage: Boolean(canManage), catalog, roles, systemRoles, rolePermissions, assignments, profiles });
}

export function useAuthorizations() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["authorizations", tenantId, source()],
    enabled: Boolean(tenantId),
    retry: false,
    queryFn: () => (isApiEnabled() ? apiGet<Authorizations>("/api/v1/authorizations") : fetchFromSupabase()),
  });
}

export function useAuthorizationAudit(enabled: boolean) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["authorizations-audit", tenantId, source()],
    enabled: Boolean(tenantId) && enabled,
    retry: false,
    queryFn: async (): Promise<AuthorizationAudit[]> => {
      if (isApiEnabled()) return apiGet<AuthorizationAudit[]>("/api/v1/authorizations/audit?limit=100");
      const rows = await check<{ created_at: string; action: string; role_name: string | null; permission_code: string | null;
        actor_id: string | null; target_user_id: string | null }[]>(
        db.from("erp_authorization_audit")
          .select("created_at, action, role_name, permission_code, actor_id, target_user_id")
          // seq (V28) : created_at est l'heure de la transaction, commune à tous ses événements.
          .order("seq", { ascending: false }).limit(100),
      );
      const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter(Boolean))] as string[];
      const names = ids.length === 0 ? [] : await check<{ id: string; full_name: string | null }[]>(
        db.from("profiles").select("id, full_name").in("id", ids));
      const nameOf = (id: string | null) => (id ? names.find((n) => n.id === id)?.full_name ?? undefined : undefined);
      return rows.map((r) => ({
        at: r.created_at, action: r.action, roleName: r.role_name ?? undefined, permission: r.permission_code ?? undefined,
        actor: nameOf(r.actor_id), targetUser: nameOf(r.target_user_id),
      }));
    },
  });
}

function useMatrixMutation<I>(run: (i: I) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      qc.invalidateQueries({ queryKey: ["authorizations-audit"] });
      // Les boutons des modules suivent my_access : un changement de rôle doit s'y voir aussitôt.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateRole() {
  return useMatrixMutation(async (r: { name: string; description?: string; copyFromRoleId?: string }) => {
    if (isApiEnabled()) return apiPost("/api/v1/authorizations/roles", { ...r, copyFromRoleId: r.copyFromRoleId || null });
    const [created] = await check<{ id: string }[]>(db.from("erp_roles")
      .insert({ tenant_id: await fetchTenantId(), name: r.name.trim(), description: r.description?.trim() || null }).select("id"));
    if (r.copyFromRoleId) {
      const perms = await check<{ permission_code: string }[]>(
        db.from("erp_role_permissions").select("permission_code").eq("role_id", r.copyFromRoleId));
      if (perms.length > 0) {
        await check(db.from("erp_role_permissions").insert(perms.map((p) => ({ role_id: created.id, permission_code: p.permission_code }))));
      }
    }
    return created;
  }, "Rôle créé");
}

export function useUpdateRole() {
  return useMatrixMutation(async (r: { id: string; name: string; description?: string; active: boolean }) => {
    if (isApiEnabled()) return apiPut(`/api/v1/authorizations/roles/${r.id}`, { name: r.name, description: r.description, active: r.active });
    return checkTouched(db.from("erp_roles")
      .update({ name: r.name.trim(), description: r.description?.trim() || null, ...(r.active ? { needs_review: false } : {}) })
      .eq("id", r.id).eq("is_system", false).select("id"));
  }, "Rôle enregistré");
}

/** Fixe la liste complète des droits d'un rôle sur mesure. */
export function useSetRolePermissions() {
  return useMatrixMutation(async (r: { id: string; permissions: string[]; current: string[] }) => {
    if (isApiEnabled()) return apiPut(`/api/v1/authorizations/roles/${r.id}/permissions`, { permissions: r.permissions });
    const removed = r.current.filter((c) => !r.permissions.includes(c));
    const added = r.permissions.filter((c) => !r.current.includes(c));
    if (removed.length > 0) await check(db.from("erp_role_permissions").delete().eq("role_id", r.id).in("permission_code", removed));
    if (added.length > 0) await check(db.from("erp_role_permissions").insert(added.map((permission_code) => ({ role_id: r.id, permission_code }))));
  }, "Droits enregistrés");
}

export function useDeleteRole() {
  return useMatrixMutation(async (id: string) => {
    if (isApiEnabled()) return apiDelete(`/api/v1/authorizations/roles/${id}`);
    return checkTouched(db.from("erp_roles").delete().eq("id", id).eq("is_system", false).select("id"));
  }, "Rôle supprimé");
}

export function useAssignRole() {
  return useMatrixMutation(async (a: { userId: string; roleId: string }) => {
    if (isApiEnabled()) return apiPost("/api/v1/authorizations/assignments", a);
    const { data: auth } = await supabase.auth.getUser();
    return check(db.from("user_role_assignments")
      .insert({ user_id: a.userId, role_id: a.roleId, tenant_id: await fetchTenantId(), assigned_by: auth.user?.id }).select("id"));
  }, "Rôle affecté");
}

export function useRevokeRole() {
  return useMatrixMutation(async (a: { userId: string; roleId: string }) => {
    if (isApiEnabled()) return apiDelete(`/api/v1/authorizations/assignments/${a.userId}/${a.roleId}`);
    return checkTouched(db.from("user_role_assignments").delete().eq("user_id", a.userId).eq("role_id", a.roleId).select("id"));
  }, "Rôle retiré");
}
