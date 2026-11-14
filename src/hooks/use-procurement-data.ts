import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

// ── Requisitions ──────────────────────────────────────────────────────────

export function useRequisitions() {
  return useQuery({
    queryKey: ["purchase-requisitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_requisitions")
        .select("*, lines:requisition_lines(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateRequisition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pr_number: string;
      description: string;
      estimated_total: number;
      tenant_id: string;
      requested_by: string;
      lines: { description: string; quantity: number; estimated_unit_cost: number; item_id?: string }[];
    }) => {
      const { lines, ...header } = input;
      const { data, error } = await supabase
        .from("purchase_requisitions")
        .insert(header)
        .select()
        .single();
      if (error) throw error;

      if (lines.length > 0) {
        const lineRows = lines.map((l) => ({
          requisition_id: data.id,
          description: l.description,
          quantity: l.quantity,
          estimated_unit_cost: l.estimated_unit_cost,
          // total : colonne calculée par la base (quantité × coût), jamais envoyée.
          item_id: l.item_id || null,
        }));
        const { error: lineErr } = await supabase.from("requisition_lines").insert(lineRows);
        if (lineErr) {
          // En-tête puis lignes : sans ses lignes, la demande n'existe pas.
          await supabase.from("purchase_requisitions").delete().eq("id", data.id);
          throw lineErr;
        }
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      toast.success("Demande d'achat créée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}


// ── Purchase Orders ──────────────────────────────────────────────────────

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*, supplier:suppliers(name), lines:po_lines(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      po_number: string;
      supplier_id: string;
      order_date?: string;
      expected_date?: string | null;
      incoterm?: string | null;
      total: number;
      tenant_id: string;
      created_by: string;
      lines: { description: string; quantity: number; unit_cost: number; item_id?: string }[];
    }) => {
      // En-tête puis lignes ; le total d'en-tête est recalculé par la base (recompute_po_total).
      const { lines, ...header } = input;
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .insert(header)
        .select()
        .single();
      if (error) throw error;

      if (lines.length > 0) {
        const lineRows = lines.map((l) => ({
          po_id: data.id,
          description: l.description,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          // total : colonne calculée par la base, jamais envoyée.
          item_id: l.item_id || null,
        }));
        const { error: lineErr } = await supabase.from("po_lines").insert(lineRows);
        if (lineErr) {
          await supabase.from("purchase_orders").delete().eq("id", data.id);
          throw lineErr;
        }
      }

      // Une demande devient commande par convert_pr_to_po (V35 : approbation vérifiée, lignes
      // reprises, une seule conversion) — plus de rattachement après coup depuis ce formulaire.

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      toast.success("Commande créée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}


// ── Goods Receipts ──────────────────────────────────────────────────────

export function useGoodsReceipts() {
  return useQuery({
    queryKey: ["goods-receipts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("*, po:purchase_orders(po_number, supplier:suppliers(name)), lines:gr_lines(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    // En-tête puis lignes (V34) : la réception naît « en attente », reçoit ses lignes, puis se
    // valide si on le demande — la base refuse une réception créée d'emblée validée.
    mutationFn: async (input: {
      gr_number: string;
      po_id: string;
      tenant_id: string;
      received_by: string;
      receipt_date?: string;
      complete?: boolean;
      lines: { po_line_id: string; item_id?: string; quantity_received: number; quantity_rejected?: number }[];
    }) => {
      const { lines, complete, ...header } = input;
      if (lines.length === 0) throw new Error("Une réception comporte au moins une ligne.");
      const { data, error } = await supabase
        .from("goods_receipts")
        .insert({ ...header, status: "pending" })
        .select()
        .single();
      if (error) throw error;

      const lineRows = lines.map((l) => ({
        gr_id: data.id,
        po_line_id: l.po_line_id,
        item_id: l.item_id || null,
        quantity_received: l.quantity_received,
        quantity_rejected: l.quantity_rejected || 0,
      }));
      const { error: lineErr } = await supabase.from("gr_lines").insert(lineRows);
      if (lineErr) {
        // Pas de réception sans lignes : l'en-tête en attente est retiré.
        await supabase.from("goods_receipts").delete().eq("id", data.id);
        throw lineErr;
      }

      if (complete) {
        const { error: doneErr } = await supabase
          .from("goods_receipts")
          .update({ status: "completed" })
          .eq("id", data.id);
        if (doneErr) throw new Error(`Réception enregistrée en attente, validation refusée : ${doneErr.message}`);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Réception enregistrée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCompleteGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .update({ status: "completed" })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Réception introuvable ou non modifiable.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Réception validée : stock mis à jour, statut de la commande recalculé");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── 3-Way Match ──────────────────────────────────────────────────────────

export type ThreeWayMatchRow = {
  po_id: string;
  tenant_id: string;
  po_number: string;
  order_date: string;
  po_status: string;
  supplier_name: string | null;
  po_total: number;
  gr_value: number;
  gr_qty: number;
  ap_value: number;
  ap_invoice_count: number;
  po_vs_gr_diff: number;
  gr_vs_ap_diff: number;
  match_status: "pending" | "matched" | "discrepancy";
};

export function useThreeWayMatch(filter?: "all" | "discrepancy" | "matched" | "pending") {
  return useQuery({
    queryKey: ["three-way-match", filter ?? "all"],
    queryFn: async () => {
      let q = supabase.from("three_way_match_view" as any).select("*").order("order_date", { ascending: false });
      if (filter && filter !== "all") q = q.eq("match_status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ThreeWayMatchRow[];
    },
  });
}

export function useProcurementKpis() {
  return useQuery({
    queryKey: ["procurement-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("procurement_kpis_view" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as unknown as {
        pr_open: number; po_pending: number; gr_today: number;
        tw_discrepancies: number; po_value_mtd: number;
      } | null;
    },
  });
}

// ── Procurement Settings ─────────────────────────────────────────────────

export function useProcurementSettings() {
  return useQuery({
    queryKey: ["procurement-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("procurement_settings" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useUpdateProcurementSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, any> & { id: string }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("procurement_settings" as any).update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["procurement-settings"] });
      qc.invalidateQueries({ queryKey: ["three-way-match"] });
      toast.success("Paramètres mis à jour");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useProcurementThresholds(docType?: "PR" | "PO") {
  return useQuery({
    queryKey: ["procurement-thresholds", docType ?? "all"],
    queryFn: async () => {
      let q = supabase.from("procurement_approval_thresholds" as any).select("*").order("max_amount", { ascending: true, nullsFirst: false });
      if (docType) q = q.eq("doc_type", docType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ── Approval queue ───────────────────────────────────────────────────────

export function useApprovalQueue(docType?: "PR" | "PO", status: string = "pending") {
  return useQuery({
    queryKey: ["procurement-approvals", docType ?? "all", status],
    queryFn: async () => {
      let q = supabase.from("procurement_approvals" as any).select("*").order("created_at", { ascending: false });
      if (docType) q = q.eq("doc_type", docType);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useApproveStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => {
      const { error } = await supabase.rpc("approve_procurement_step" as any, { _approval_id: id, _comment: comment ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["procurement-approvals"] });
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Étape approuvée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRejectStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const { error } = await supabase.rpc("reject_procurement_step" as any, { _approval_id: id, _comment: comment });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["procurement-approvals"] });
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Étape rejetée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Convert PR → PO ──────────────────────────────────────────────────────

export function useConvertPRToPO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pr_id, supplier_id }: { pr_id: string; supplier_id: string }) => {
      const { data, error } = await supabase.rpc("convert_pr_to_po" as any, { _pr_id: pr_id, _supplier_id: supplier_id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("PR convertie en PO");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── 3WM decisions ────────────────────────────────────────────────────────

export function useRecordMatchDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ po_id, decision, reason }: { po_id: string; decision: "accepted" | "revision_requested"; reason: string }) => {
      const { error } = await supabase.rpc("record_match_decision" as any, { _po_id: po_id, _decision: decision, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-decisions"] });
      qc.invalidateQueries({ queryKey: ["three-way-match"] });
      toast.success("Décision enregistrée");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useMatchDecisions(poId?: string) {
  return useQuery({
    queryKey: ["match-decisions", poId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("procurement_match_decisions" as any).select("*").order("created_at", { ascending: false });
      if (poId) q = q.eq("po_id", poId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ── SLA dashboard ────────────────────────────────────────────────────────

export function useProcurementSLA() {
  return useQuery({
    queryKey: ["procurement-sla"],
    queryFn: async () => {
      const { data, error } = await supabase.from("procurement_sla_view" as any).select("*").order("po_date", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ── Audit trail ──────────────────────────────────────────────────────────

export function useProcurementAudit(filters?: { dateFrom?: string; dateTo?: string; eventType?: string }) {
  return useQuery({
    queryKey: ["procurement-audit", filters],
    queryFn: async () => {
      let q = supabase.from("procurement_audit_view" as any).select("*").order("event_at", { ascending: false }).limit(500);
      if (filters?.dateFrom) q = q.gte("event_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("event_at", filters.dateTo);
      if (filters?.eventType && filters.eventType !== "all") q = q.eq("event_type", filters.eventType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ── Current user procurement permissions ─────────────────────────────────

export function useMyProcurementRoles() {
  // Droits dits par la base (my_access, V27), dans la société courante.
  const q = useMyAccess();
  const can = moduleCan(q.data, "procurement");
  return {
    ...q,
    data: q.data && {
      roles: q.data.roles,
      canApproveL1: can("approve_l1"),
      canApproveL2: can("approve_l2"),
      canApproveL3: can("approve_l3"),
      canConvert: can("convert"),
      can3WM: can("3wm"),
    },
  };
}

// ── Procurement Role Management (admin) ──────────────────────────────────

export const PROCUREMENT_ROLES = [
  { value: "procurement_l1", label: "L1 — Approbateur niveau 1" },
  { value: "procurement_l2", label: "L2 — Approbateur niveau 2" },
  { value: "procurement_l3", label: "L3 — Approbateur niveau 3" },
  { value: "procurement_controller", label: "Contrôleur Procurement" },
  { value: "procurement_3wm_approver", label: "Approbateur 3-Way Match" },
] as const;

export function useTenantProcurementRoles() {
  return useTenantRoleMembers("tenant-procurement-roles", PROCUREMENT_ROLES.map((r) => r.value));
}

export function useAssignProcurementRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user: string; role: string; action: "assign" | "revoke"; comment?: string }) => {
      const { error } = await supabase.rpc("assign_procurement_role" as any, {
        _target_user: input.target_user,
        _role: input.role,
        _action: input.action,
        _comment: input.comment ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["tenant-procurement-roles"] });
      qc.invalidateQueries({ queryKey: ["procurement-role-audit"] });
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
      toast.success(v.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useProcurementRoleAudit() {
  return useQuery({
    queryKey: ["procurement-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procurement_role_audit" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}


// ── Cycle de vie des pièces d'achat (V39) ───────────────────────────────
// Brouillon → soumis (file selon les seuils de la société) → approuvé niveau par niveau par des
// tiers habilités (useApproveStep / useRejectStep) → ou rejeté, de nouveau modifiable. Le statut
// ne change que par ces fonctions : la base refuse une mise à jour directe.

export type ProcurementDocType = "PR" | "PO";
const TABLE: Record<ProcurementDocType, string> = { PR: "purchase_requisitions", PO: "purchase_orders" };

function invalidateProcurement(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["procurement-approvals"] });
  qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
  qc.invalidateQueries({ queryKey: ["purchase-orders"] });
}

export function useSubmitProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, id }: { docType: ProcurementDocType; id: string }) => {
      const { data, error } = await supabase.rpc("procurement_submit" as any, { _doc_type: docType, _doc_id: id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (levels) => {
      invalidateProcurement(qc);
      toast.success(`Pièce soumise : ${levels} niveau${levels > 1 ? "x" : ""} d'approbation`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCancelProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, id, reason }: { docType: ProcurementDocType; id: string; reason: string }) => {
      const { error } = await supabase.rpc("procurement_cancel" as any, { _doc_type: docType, _doc_id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidateProcurement(qc); toast.success("Pièce annulée"); },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Suppression d'un brouillon ou d'une pièce rejetée (la base refuse au-delà). */
export function useDeleteProcurementDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, id }: { docType: ProcurementDocType; id: string }) => {
      const { data, error } = await (supabase as any).from(TABLE[docType]).delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Pièce introuvable ou non supprimable.");
    },
    onSuccess: () => { invalidateProcurement(qc); toast.success("Pièce supprimée"); },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Modification d'un brouillon ou d'une pièce rejetée : en-tête puis lignes remplacées. */
export function useUpdateProcurementDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      docType: ProcurementDocType; id: string; header: Record<string, unknown>;
      lines: { description: string; quantity: number; unitPrice: number }[];
    }) => {
      const db = supabase as any;
      const { data, error } = await db.from(TABLE[input.docType]).update(input.header).eq("id", input.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Pièce introuvable ou non modifiable.");
      const lineTable = input.docType === "PR" ? "requisition_lines" : "po_lines";
      const parent = input.docType === "PR" ? "requisition_id" : "po_id";
      const { error: delErr } = await db.from(lineTable).delete().eq(parent, input.id);
      if (delErr) throw delErr;
      const rows = input.lines.map((l) => input.docType === "PR"
        ? { requisition_id: input.id, description: l.description, quantity: l.quantity, estimated_unit_cost: l.unitPrice }
        : { po_id: input.id, description: l.description, quantity: l.quantity, unit_cost: l.unitPrice });
      const { error: insErr } = await db.from(lineTable).insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: () => { invalidateProcurement(qc); toast.success("Pièce modifiée"); },
    onError: (e: any) => toast.error(e.message),
  });
}
