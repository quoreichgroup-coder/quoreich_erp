import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import type { InvitationRow } from "@/lib/invitations";

/*
 * Invitations à rejoindre la société (V31). Lecture : tenant_invitations, que la RLS réserve
 * aux administrateurs de la société. Écriture : uniquement par les fonctions
 * create_tenant_invitation / revoke_tenant_invitation, qui vérifient les droits et la société.
 */
const db = supabase as any;

export function useInvitations(enabled: boolean) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["tenant-invitations", tenantId],
    enabled: Boolean(tenantId) && enabled,
    retry: false,
    queryFn: async (): Promise<InvitationRow[]> => {
      const { data, error } = await db.from("tenant_invitations")
        .select("id, code, role_id, note, created_at, expires_at, used_at, used_by, revoked_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as InvitationRow[];
    },
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { roleId?: string; validDays: number; note?: string }) => {
      const { data, error } = await db.rpc("create_tenant_invitation", {
        _role_id: i.roleId || null, _valid_days: i.validDays, _note: i.note?.trim() || null,
      });
      if (error) throw error;
      return data as { id: string; code: string; expires_at: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-invitations"] });
      toast.success("Invitation créée : transmettez le code à la personne invitée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("revoke_tenant_invitation", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-invitations"] });
      toast.success("Invitation révoquée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
