import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
          total: l.quantity * l.estimated_unit_cost,
          item_id: l.item_id || null,
        }));
        const { error: lineErr } = await supabase.from("requisition_lines").insert(lineRows);
        if (lineErr) throw lineErr;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      toast.success("Requisition created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useApproveRequisition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approved_by }: { id: string; approved_by: string }) => {
      const { error } = await supabase
        .from("purchase_requisitions")
        .update({ status: "approved", approved_by, approved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      toast.success("Requisition approved");
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
      total: number;
      tenant_id: string;
      created_by: string;
      requisition_id?: string;
      lines: { description: string; quantity: number; unit_cost: number; item_id?: string }[];
    }) => {
      const { lines, requisition_id, ...header } = input;
      const { data, error } = await supabase
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
          total: l.quantity * l.unit_cost,
          item_id: l.item_id || null,
        }));
        const { error: lineErr } = await supabase.from("po_lines").insert(lineRows);
        if (lineErr) throw lineErr;
      }

      // Link requisition to PO
      if (requisition_id) {
        await supabase
          .from("purchase_requisitions")
          .update({ po_id: data.id, status: "converted" })
          .eq("id", requisition_id);
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-requisitions"] });
      toast.success("Purchase order created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useApprovePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approved_by }: { id: string; approved_by: string }) => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "approved", approved_by })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("PO approved");
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
    mutationFn: async (input: {
      gr_number: string;
      po_id: string;
      tenant_id: string;
      received_by: string;
      status: string;
      lines: { po_line_id?: string; item_id?: string; quantity_received: number; quantity_rejected?: number }[];
    }) => {
      const { lines, ...header } = input;
      const { data, error } = await supabase
        .from("goods_receipts")
        .insert(header)
        .select()
        .single();
      if (error) throw error;

      if (lines.length > 0) {
        const lineRows = lines.map((l) => ({
          gr_id: data.id,
          po_line_id: l.po_line_id || null,
          item_id: l.item_id || null,
          quantity_received: l.quantity_received,
          quantity_rejected: l.quantity_rejected || 0,
        }));
        const { error: lineErr } = await supabase.from("gr_lines").insert(lineRows);
        if (lineErr) throw lineErr;
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      toast.success("Goods receipt recorded");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCompleteGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("goods_receipts")
        .update({ status: "completed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("GR completed — stock updated & PO status changed");
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
  return useQuery({
    queryKey: ["tenant-procurement-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", PROCUREMENT_ROLES.map((r) => r.value) as any);
      if (error) throw error;
      const map = new Map<string, string[]>();
      (data ?? []).forEach((r: any) => {
        const list = map.get(r.user_id) ?? [];
        list.push(r.role);
        map.set(r.user_id, list);
      });
      return map;
    },
  });
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
      qc.invalidateQueries({ queryKey: ["my-procurement-roles"] });
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

