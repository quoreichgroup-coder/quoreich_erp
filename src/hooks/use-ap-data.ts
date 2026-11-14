import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

// ─── Types ───
export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: number | null;
  status: string;
  created_at: string;
}

export interface APInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  supplier_id: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  status: string;
  approval_status: string;
  created_by: string;
  created_at: string;
  supplier?: { id: string; name: string; payment_terms: number | null };
}

// tenant_id is now fetched dynamically via fetchTenantId()

// ─── Suppliers ───
export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Omit<Supplier, "id" | "tenant_id" | "created_at">) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await supabase.from("suppliers").insert({
        ...s,
        tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Fournisseur créé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Supplier> & { id: string }) => {
      const { error } = await supabase.from("suppliers").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Fournisseur mis à jour");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Fournisseur supprimé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── AP Invoices ───
export function useAPInvoices() {
  return useQuery({
    queryKey: ["ap-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ap_invoices")
        .select("*, supplier:suppliers(id, name, payment_terms)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as APInvoice[];
    },
  });
}

export function useCreateAPInvoice() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (inv: {
      invoice_number: string;
      supplier_id: string;
      invoice_date: string;
      due_date: string;
      subtotal: number;
      tax_amount: number;
      total: number;
      po_id?: string | null;
    }) => {
      const tenant_id = await fetchTenantId();
      const { data, error } = await supabase.from("ap_invoices").insert({
        ...inv,
        tenant_id,
        created_by: user!.id,
        status: "draft",
        approval_status: "draft",
        amount_paid: 0,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-invoices"] });
      toast.success("Facture AP créée");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useUpdateAPInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; approval_status?: string; amount_paid?: number }) => {
      const { error } = await supabase.from("ap_invoices").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ap-invoices"] }),
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── AP Payments ───
export function useRecordAPPayment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (payment: {
      ap_invoice_id: string;
      amount: number;
      payment_date: string;
      payment_method: string;
      reference: string;
    }) => {
      // DB triggers handle JE posting + invoice recompute. Approval guard enforced server-side.
      const tenant_id = await fetchTenantId();
      const { error: payError } = await supabase.from("payments").insert({
        ...payment,
        tenant_id,
        payment_type: "ap_payment",
        created_by: user!.id,
      });
      if (payError) throw payError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-invoices"] });
      toast.success("Paiement enregistré");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ============================================================
//  AP CONFIG & CONTROL HOOKS — DB-driven
// ============================================================

const sb = supabase as any;

async function ensureAPSeed() {
  const tenant_id = await fetchTenantId();
  await sb.rpc("seed_ap_defaults", { _tenant_id: tenant_id });
  return tenant_id;
}

// General settings
export function useAPGeneralSettings() {
  return useQuery({
    queryKey: ["ap-general-settings"],
    queryFn: async () => {
      const tenant_id = await ensureAPSeed();
      const { data, error } = await sb.from("ap_general_settings").select("*").eq("tenant_id", tenant_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
export function useUpdateAPGeneralSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: any) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ap_general_settings").update({ ...updates, updated_at: new Date().toISOString() }).eq("tenant_id", tenant_id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ap-general-settings"] }); toast.success("Paramètres mis à jour"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// Numbering
export function useAPNumberingSeries() {
  return useQuery({
    queryKey: ["ap-numbering-series"],
    queryFn: async () => {
      await ensureAPSeed();
      const { data, error } = await sb.from("ap_numbering_series").select("*").order("doc_type");
      if (error) throw error;
      return data || [];
    },
  });
}
export function useUpdateAPNumberingSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const { error } = await sb.from("ap_numbering_series").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ap-numbering-series"] }); toast.success("Série mise à jour"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// Payment methods
export function useAPPaymentMethods() {
  return useQuery({
    queryKey: ["ap-payment-methods"],
    queryFn: async () => {
      await ensureAPSeed();
      const { data, error } = await sb.from("ap_payment_methods").select("*").order("code");
      if (error) throw error;
      return data || [];
    },
  });
}
export function useUpsertAPPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: any) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ap_payment_methods").upsert({ ...m, tenant_id }, { onConflict: "tenant_id,code" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ap-payment-methods"] }); toast.success("Mode de paiement enregistré"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// Withholding
export function useAPWithholdingRates() {
  return useQuery({
    queryKey: ["ap-withholding-rates"],
    queryFn: async () => {
      await ensureAPSeed();
      const { data, error } = await sb.from("ap_withholding_rates").select("*").order("category");
      if (error) throw error;
      return data || [];
    },
  });
}
export function useUpsertAPWithholdingRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: any) => {
      const tenant_id = await fetchTenantId();
      const { error } = r.id
        ? await sb.from("ap_withholding_rates").update(r).eq("id", r.id)
        : await sb.from("ap_withholding_rates").insert({ ...r, tenant_id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ap-withholding-rates"] }); toast.success("Taux enregistré"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// Notification rules
export function useAPNotificationRules() {
  return useQuery({
    queryKey: ["ap-notification-rules"],
    queryFn: async () => {
      await ensureAPSeed();
      const { data, error } = await sb.from("ap_notification_rules").select("*").order("created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

// Approval thresholds
export function useAPApprovalThresholds() {
  return useQuery({
    queryKey: ["ap-approval-thresholds"],
    queryFn: async () => {
      await ensureAPSeed();
      const { data, error } = await sb.from("ap_approval_thresholds").select("*").order("sla_hours");
      if (error) throw error;
      return data || [];
    },
  });
}

// Approval queue
export function useAPApprovalQueue() {
  return useQuery({
    queryKey: ["ap-approval-queue"],
    queryFn: async () => {
      const { data, error } = await sb.from("ap_approval_queue").select("*").order("request_date", { ascending: false });
      if (error) throw error;
      return (data || []).map((q: any) => {
        const elapsed_hours = Math.round((Date.now() - new Date(q.created_at).getTime()) / 3_600_000);
        return { ...q, elapsed_hours };
      });
    },
  });
}
export function useResolveAPApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      const { error } = await sb.from("ap_approval_queue").update({ status: decision, resolved_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ap-approval-queue"] }); toast.success("Décision enregistrée"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// AP Audit (reuses gl_audit_logs filtered)
export function useAPAuditTrail(limit = 100) {
  return useQuery({
    queryKey: ["ap-audit-trail", limit],
    queryFn: async () => {
      const { data, error } = await sb
        .from("gl_audit_logs")
        .select("*")
        .ilike("batch_id", "AP%")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },
  });
}

export interface APAgingRow {
  supplier_id: string;
  supplier_name: string;
  total_outstanding: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  invoice_count: number;
  days_overdue: number;
}
export function useAPAging() {
  return useQuery({
    queryKey: ["ap-aging"],
    queryFn: async () => {
      const { data, error } = await sb.from("ap_aging_view").select("*").order("days_overdue", { ascending: false });
      if (error) throw error;
      return (data || []) as APAgingRow[];
    },
  });
}

// ── Cycle de vie des factures fournisseurs (V41) ─────────────────────────
// Brouillon → soumise (contrôles des paramètres : bon de commande, réception, rapprochement à 3
// voies ; niveaux selon les seuils) → approuvée par des tiers habilités (ap.approve_l<n>) →
// comptabilisée ; ou rejetée (motif), de nouveau modifiable. La base refuse toute approbation
// directe : ces fonctions sont le seul chemin.

function invalidateAP(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["ap-invoices"] });
  qc.invalidateQueries({ queryKey: ["ap-invoice-approvals"] });
  qc.invalidateQueries({ queryKey: ["journal-entries"] });
  qc.invalidateQueries({ queryKey: ["gl-batches"] });
}

export type APInvoiceApproval = {
  id: string; invoice_id: string; level_order: number; level_label: string; approver_label: string | null;
  amount: number; status: "pending" | "approved" | "rejected" | "skipped"; decided_by: string | null; decided_at?: string | null; comment: string | null;
};

export function useAPInvoiceApprovals() {
  return useQuery({
    queryKey: ["ap-invoice-approvals"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("ap_invoice_approvals").select("*").order("level_order");
      if (error) throw error;
      return (data ?? []) as APInvoiceApproval[];
    },
  });
}

export function useSubmitAPInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc("ap_invoice_submit", { _id: id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (levels) => { invalidateAP(qc); toast.success(`Facture soumise : ${levels} niveau${levels > 1 ? "x" : ""} d'approbation`); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDecideAPInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ approvalId, approve, comment }: { approvalId: string; approve: boolean; comment?: string }) => {
      const { error } = await (supabase as any).rpc("ap_invoice_decide", {
        _approval_id: approvalId, _approve: approve, _comment: comment ?? null,
      });
      if (error) throw error;
      return approve;
    },
    onSuccess: (approve) => { invalidateAP(qc); toast.success(approve ? "Niveau approuvé" : "Facture rejetée"); },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Suppression d'une facture en brouillon ou rejetée (la base refuse au-delà). */
export function useDeleteAPInvoiceDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).from("ap_invoices").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Facture introuvable ou non supprimable.");
    },
    onSuccess: () => { invalidateAP(qc); toast.success("Facture supprimée"); },
    onError: (e: any) => toast.error(e.message),
  });
}
