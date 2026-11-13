import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CrmPerms, CrmRole, CrmStage } from "@/lib/crm-roles";
import { ALL_CRM_ROLES } from "@/lib/crm-roles";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

export type CrmContact = {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  owner_id: string | null;
  status: string;
  source: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmOpportunity = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  customer_id: string | null;
  converted_quotation_id: string | null;
  name: string;
  stage: CrmStage;
  amount: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  owner_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};


export type CrmActivity = {
  id: string;
  tenant_id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  type: string;
  subject: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
};

export type CrmRoleAuditRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  target_user_id: string;
  role: string;
  action: "grant" | "revoke";
  performed_by: string | null;
  reason: string | null;
};

// ───── Contacts ─────
export function useCrmContacts(search = "") {
  return useQuery({
    queryKey: ["crm-contacts", search],
    queryFn: async () => {
      let q = supabase.from("crm_contacts" as never).select("*").order("created_at", { ascending: false }).limit(500);
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`full_name.ilike.${s},email.ilike.${s},company.ilike.${s},phone.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CrmContact[];
    },
  });
}

export function useUpsertContact() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<CrmContact> & { full_name: string }) => {
      const payload = {
        ...input,
        tenant_id: tenantId!,
        created_by: input.id ? undefined : user?.id ?? null,
      } as Record<string, unknown>;
      const { error } = await supabase.from("crm_contacts" as never).upsert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success("Contact enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crm_contacts" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success("Contact supprimé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Opportunities ─────
export function useCrmOpportunities() {
  return useQuery({
    queryKey: ["crm-opportunities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_opportunities" as never)
        .select("*")
        .order("expected_close_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as CrmOpportunity[];
    },
  });
}

export function useUpsertOpportunity() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<CrmOpportunity> & { name: string }) => {
      const payload = {
        ...input,
        tenant_id: tenantId!,
        created_by: input.id ? undefined : user?.id ?? null,
      } as Record<string, unknown>;
      const { error } = await supabase.from("crm_opportunities" as never).upsert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
      toast.success("Opportunité enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateOpportunityStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; stage: CrmStage; probability?: number }) => {
      const { error } = await supabase
        .from("crm_opportunities" as never)
        .update({ stage: input.stage, probability: input.probability ?? null } as never)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crm_opportunities" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-opportunities"] });
      toast.success("Opportunité supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Activities ─────
export function useCrmActivities(opportunityId: string | null) {
  return useQuery({
    queryKey: ["crm-activities", opportunityId],
    enabled: !!opportunityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_activities" as never)
        .select("*")
        .eq("opportunity_id", opportunityId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CrmActivity[];
    },
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<CrmActivity> & { subject: string }) => {
      const payload = {
        ...input,
        tenant_id: tenantId!,
        created_by: user?.id ?? null,
      } as Record<string, unknown>;
      const { error } = await supabase.from("crm_activities" as never).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["crm-activities", v.opportunity_id ?? null] });
      toast.success("Activité enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Bulk actions on opportunities ─────
export function useBulkUpdateOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ids: string[];
      patch: Partial<Pick<CrmOpportunity, "stage" | "owner_id" | "status" | "probability">>;
    }) => {
      if (input.ids.length === 0) return;
      const { error } = await supabase
        .from("crm_opportunities" as never)
        .update(input.patch as never)
        .in("id", input.ids);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["crm-opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
      toast.success(`${v.ids.length} opportunité(s) mises à jour`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Bulk contact import ─────
export function useBulkInsertContacts() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (rows: Array<Partial<CrmContact> & { full_name: string }>) => {
      if (rows.length === 0) return { inserted: 0 };
      const payload = rows.map((r) => ({ ...r, tenant_id: tenantId! })) as unknown as never;
      const { error } = await supabase.from("crm_contacts" as never).insert(payload);
      if (error) throw error;
      return { inserted: rows.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast.success(`${r?.inserted ?? 0} contact(s) importé(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Reminders (activities with due_at, tenant-wide) ─────
export function useCrmReminders() {
  return useQuery({
    queryKey: ["crm-reminders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_activities" as never)
        .select("*")
        .not("due_at", "is", null)
        .order("due_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as CrmActivity[];
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("crm_activities" as never)
        .update({ completed_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-reminders"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
      toast.success("Rappel marqué comme terminé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───── Stage-change audit (tenant-wide) ─────
export type CrmStageAuditRow = CrmActivity;
export function useCrmStageAudit() {
  return useQuery({
    queryKey: ["crm-stage-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_activities" as never)
        .select("*")
        .eq("type", "stage_change")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as CrmStageAuditRow[];
    },
  });
}

// ───── RBAC ─────
export function useMyCrmRoles(): CrmPerms {
  // Droits dits par la base (my_access, V27) ; seul le paramétrage du module reste par rôle,
  // faute d'équivalent au catalogue.
  const { data: access } = useMyAccess();
  const can = moduleCan(access, "crm");
  const roles = access?.roles ?? [];
  return {
    canView:            can("view"),
    canCreate:          can("create"),
    canEdit:            can("edit"),
    canDelete:          can("delete"),
    canApproveDiscount: can("approve_discount"),
    canConvert:         can("convert"),
    canExport:          can("export"),
    canViewSensitive:   can("view_sensitive"),
    canAudit:           can("audit"),
    canManageSettings:  roles.includes("admin") || roles.includes("crm_admin"),
  };
}

export function useTenantCrmRoles() {
  return useTenantRoleMembers("tenant-crm-roles", ALL_CRM_ROLES);
}

export function useAssignCrmRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: CrmRole; action: "grant" | "revoke"; reason?: string }) => {
      const { error } = await supabase.rpc("assign_crm_role" as never, {
        p_target_user: input.target_user,
        p_role: input.role,
        p_action: input.action,
        p_reason: input.reason ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["tenant-crm-roles"] });
      qc.invalidateQueries({ queryKey: ["crm-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(v.action === "grant" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => {
      const msg = e.message?.includes("SOD")
        ? "Conflit de séparation des tâches (Agent ⇄ Manager)"
        : e.message?.includes("FORBIDDEN")
        ? "Réservé aux administrateurs CRM"
        : e.message || "Erreur lors de l'attribution";
      toast.error(msg);
    },
  });
}

export function useCrmRoleAudit() {
  return useQuery({
    queryKey: ["crm-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_role_audit" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as CrmRoleAuditRow[];
    },
  });
}

// ───── Conversion opportunité → devis ─────
export function useConvertOpportunityToQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { opportunityId: string; customerId?: string | null; validUntil?: string | null }) => {
      const { data, error } = await supabase.rpc("convert_opportunity_to_quote" as never, {
        _opp_id: input.opportunityId,
        _customer_id: input.customerId ?? null,
        _valid_until: input.validUntil ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Opportunité convertie en devis");
    },
    onError: (e: Error) => {
      const m = e.message || "";
      const msg =
        m.includes("opportunity_not_won") ? "L'opportunité doit être au stade « Gagnée »" :
        m.includes("customer_required") ? "Sélectionnez un client pour la conversion" :
        m.includes("customer_invalid_tenant") ? "Client invalide pour ce tenant" :
        m.includes("insufficient_role") ? "Action réservée aux Manager/Admin CRM" :
        m.includes("opportunity_not_found") ? "Opportunité introuvable" :
        m || "Échec de la conversion";
      toast.error(msg);
    },
  });
}

// ───── Conversion devis → bon de commande ─────
export function useConvertQuoteToSo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.rpc("convert_quote_to_so" as never, { _quote_id: quoteId } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["sales_orders"] });
      qc.invalidateQueries({ queryKey: ["crm-opp-quote"] });
      qc.invalidateQueries({ queryKey: ["crm-activities"] });
      toast.success("Devis converti en bon de commande");
    },
    onError: (e: Error) => {
      const m = e.message || "";
      const msg =
        m.includes("quote_status_invalid") ? "Statut devis invalide pour conversion" :
        m.includes("insufficient_role") ? "Permission ventes requise (confirm)" :
        m.includes("quote_not_found") ? "Devis introuvable" :
        m.includes("tenant_mismatch") ? "Tenant invalide" :
        m || "Échec de la conversion";
      toast.error(msg);
    },
  });
}

// ───── Audit export (CSV/PDF) ─────
export function useLogCrmExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { opportunityId: string | null; format: "csv" | "pdf"; kind: string; recordId?: string | null }) => {
      const { error } = await supabase.rpc("log_crm_export" as never, {
        _opportunity_id: input.opportunityId,
        _format: input.format,
        _kind: input.kind,
        _record_id: input.recordId ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["crm-activities", v.opportunityId ?? null] });
      qc.invalidateQueries({ queryKey: ["crm-stage-audit"] });
    },
  });
}

// ───── Lecture devis liés à une opportunité ─────
export function useQuoteForOpportunity(opportunityId: string | null) {
  return useQuery({
    enabled: !!opportunityId,
    queryKey: ["crm-opp-quote", opportunityId],
    queryFn: async () => {
      const { data: opp, error: e1 } = await supabase
        .from("crm_opportunities" as never)
        .select("converted_quotation_id")
        .eq("id", opportunityId!)
        .maybeSingle();
      if (e1) throw e1;
      const qid = (opp as { converted_quotation_id: string | null } | null)?.converted_quotation_id;
      if (!qid) return null;
      const { data: quote, error: e2 } = await supabase
        .from("quotations")
        .select("id, quote_number, customer_id, quote_date, valid_until, total, status")
        .eq("id", qid)
        .maybeSingle();
      if (e2) throw e2;
      if (!quote) return null;
      const { data: lines, error: e3 } = await supabase
        .from("quote_lines")
        .select("id, description, quantity, unit_price, total")
        .eq("quotation_id", qid);
      if (e3) throw e3;
      const { data: so } = await supabase
        .from("sales_orders")
        .select("id, so_number, status")
        .eq("quotation_id", qid)
        .maybeSingle();
      return { quote, lines: lines ?? [], salesOrder: so ?? null };
    },
  });
}


