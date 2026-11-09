import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";

// ===== Types =====
export interface Quotation {
  id: string;
  quote_number: string;
  quote_date: string;
  customer_id: string;
  total: number;
  status: string;
  valid_until: string | null;
  created_at: string;
  created_by: string;
  customer?: { name: string };
}

export interface SalesOrder {
  id: string;
  so_number: string;
  order_date: string;
  customer_id: string;
  quotation_id: string | null;
  total: number;
  status: string;
  created_at: string;
  created_by: string;
  customer?: { name: string };
  quotation?: { quote_number: string } | null;
}

export interface DeliveryNote {
  id: string;
  dn_number: string;
  so_id: string;
  customer_id: string;
  delivery_date: string;
  status: string;
  ar_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  customer?: { name: string };
  sales_order?: { so_number: string };
}

export const SALES_ROLES = ["sales_rep", "sales_manager", "sales_controller"] as const;
export type SalesRole = (typeof SALES_ROLES)[number];

// ===== Queries =====
export function useQuotations() {
  return useQuery({
    queryKey: ["quotations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*, customer:customers(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Quotation[];
    },
  });
}

export function useSalesOrders() {
  return useQuery({
    queryKey: ["sales-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("*, customer:customers(name), quotation:quotations(quote_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SalesOrder[];
    },
  });
}

export function useSoLines(soId?: string) {
  return useQuery({
    queryKey: ["so-lines", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data, error } = await supabase.from("so_lines").select("*").eq("so_id", soId!);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useDeliveryNotes() {
  return useQuery({
    queryKey: ["delivery-notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_notes")
        .select("*, customer:customers(name), sales_order:sales_orders(so_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DeliveryNote[];
    },
  });
}

export function useSalesPipeline() {
  return useQuery({
    queryKey: ["sales-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_pipeline_view").select("*");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSalesSLA() {
  return useQuery({
    queryKey: ["sales-sla"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_sla_view").select("*");
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSalesKPIs() {
  return useQuery({
    queryKey: ["sales-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_kpis_view").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSalesAudit() {
  return useQuery({
    queryKey: ["sales-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_audit_view")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSalesSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["sales-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_settings")
        .select("*")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateSalesSettings() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("sales_settings")
        .upsert({ tenant_id: tenantId!, ...updates, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-settings"] });
      toast.success("Paramètres enregistrés");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useMySalesRoles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-sales-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = new Set((data || []).map((r) => r.role as string));
      return {
        isAdmin: roles.has("admin"),
        canCreate: roles.has("admin") || roles.has("sales_rep") || roles.has("sales_manager"),
        canConfirm: roles.has("admin") || roles.has("sales_manager") || roles.has("sales_controller"),
        canDeliver:
          roles.has("admin") ||
          roles.has("sales_rep") ||
          roles.has("sales_manager") ||
          roles.has("sales_controller"),
        canInvoice: roles.has("admin") || roles.has("sales_manager") || roles.has("sales_controller"),
        canExport: roles.has("admin") || roles.has("sales_manager") || roles.has("sales_controller"),
        roles: Array.from(roles),
      };

    },
  });
}

// ===== Mutations =====
export function useCreateQuotation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: {
      customer_id: string;
      quote_number: string;
      quote_date: string;
      valid_until: string;
      total: number;
    }) => {
      const { error } = await supabase
        .from("quotations")
        .insert({ ...input, tenant_id: tenantId!, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Devis créé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; total?: number }) => {
      const { error } = await supabase.from("quotations").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Devis mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (input: {
      customer_id: string;
      so_number: string;
      order_date: string;
      total: number;
      quotation_id?: string;
    }) => {
      const { error } = await supabase.from("sales_orders").insert({
        ...input,
        tenant_id: tenantId!,
        created_by: user!.id,
        quotation_id: input.quotation_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Commande créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string }) => {
      const { error } = await supabase.from("sales_orders").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Commande mise à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Secured RPCs =====
export function useConvertQuoteToSO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.rpc("confirm_quote_to_so", { _quote_id: quoteId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Devis converti en commande");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useConfirmSO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (soId: string) => {
      const { error } = await supabase.rpc("confirm_so", { _so_id: soId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Commande confirmée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      so_id: string;
      lines: Array<{ so_line_id: string; quantity: number }>;
    }) => {
      const { data, error } = await supabase.rpc("post_delivery", {
        _so_id: input.so_id,
        _lines: input.lines as unknown as never,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
      qc.invalidateQueries({ queryKey: ["so-lines"] });
      toast.success("Livraison enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useInvoiceFromDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dnId: string) => {
      const { data, error } = await supabase.rpc("invoice_from_delivery", { _dn_id: dnId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      toast.success("Facture client créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export const SALES_ROLE_LABELS: { value: SalesRole; label: string }[] = [
  { value: "sales_rep", label: "Sales Rep — Création devis/commandes" },
  { value: "sales_manager", label: "Sales Manager — Confirmation, livraison, facturation" },
  { value: "sales_controller", label: "Sales Controller — Audit, contrôle, override" },
];

export function useTenantSalesRoles() {
  return useQuery({
    queryKey: ["tenant-sales-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", SALES_ROLES as unknown as readonly ("sales_rep" | "sales_manager" | "sales_controller")[]);
      if (error) throw error;
      const map = new Map<string, string[]>();
      (data ?? []).forEach((r: { user_id: string; role: string }) => {
        const list = map.get(r.user_id) ?? [];
        list.push(r.role);
        map.set(r.user_id, list);
      });
      return map;
    },
  });
}

export function useSalesRoleAudit() {
  return useQuery({
    queryKey: ["sales-role-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_role_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAssignSalesRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      target_user: string;
      role: SalesRole;
      action: "assign" | "revoke";
      comment?: string;
    }) => {
      const { error } = await supabase.rpc("assign_sales_role", {
        _target_user: input.target_user,
        _role: input.role,
        _action: input.action,
        _comment: input.comment || null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["sales-audit"] });
      qc.invalidateQueries({ queryKey: ["sales-role-audit"] });
      qc.invalidateQueries({ queryKey: ["tenant-sales-roles"] });
      qc.invalidateQueries({ queryKey: ["my-sales-roles"] });
      toast.success(v.action === "assign" ? "Rôle attribué" : "Rôle révoqué");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Reporting aggregation =====
export function useSalesReportingData(opts?: { from?: string; to?: string }) {
  const { from, to } = opts ?? {};
  const { data: quotations = [], isLoading: loadingQ } = useQuotations();
  const { data: orders = [], isLoading: loadingO } = useSalesOrders();
  const { data: arInvoices = [], isLoading: loadingI } = useQuery({
    queryKey: ["ar-invoices-for-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_invoices")
        .select("total, amount_paid, status, invoice_date, customer:customers(name)")
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const { data: cogsMovements = [], isLoading: loadingC } = useQuery({
    queryKey: ["sales-cogs-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("movement_date, total_value, movement_type, reference_type")
        .or("movement_type.in.(delivery,sale,issue),reference_type.eq.delivery_note");
      if (error) throw error;
      return data || [];
    },
  });
  const isLoading = loadingQ || loadingO || loadingI || loadingC;


  const inRange = (d?: string | null) => {
    if (!d) return true;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const fQuotes = quotations.filter((q) => inRange(q.quote_date));
  const fOrders = orders.filter((o) => inRange(o.order_date));
  const fInvoices = arInvoices.filter((i) => inRange((i as { invoice_date?: string }).invoice_date));

  const revenueByCustomer: Record<string, { orders: number; revenue: number }> = {};
  for (const inv of fInvoices) {
    const name = (inv.customer as { name?: string } | null)?.name || "Unknown";
    if (!revenueByCustomer[name]) revenueByCustomer[name] = { orders: 0, revenue: 0 };
    revenueByCustomer[name].orders++;
    revenueByCustomer[name].revenue += Number(inv.total);
  }
  const salesByCustomer = Object.entries(revenueByCustomer)
    .map(([customer, d]) => ({ customer, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Monthly revenue (YYYY-MM) from AR invoices
  const byMonth: Record<string, { revenue: number; count: number }> = {};
  for (const inv of fInvoices) {
    const d = (inv as { invoice_date?: string }).invoice_date;
    if (!d) continue;
    const m = d.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { revenue: 0, count: 0 };
    byMonth[m].revenue += Number(inv.total);
    byMonth[m].count++;
  }
  const monthlyRevenue = Object.entries(byMonth)
    .map(([month, d]) => ({ month, ...d }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const totalQuotes = fQuotes.length;
  const sentQuotes = fQuotes.filter((q) => q.status !== "draft").length;
  const acceptedQuotes = fQuotes.filter(
    (q) => q.status === "accepted" || q.status === "converted"
  ).length;
  const totalOrders = fOrders.length;
  const deliveredOrders = fOrders.filter((o) => o.status === "delivered").length;
  const paidInvoices = fInvoices.filter((i) => i.status === "paid").length;

  const quoteTotal = fQuotes.reduce((s, q) => s + Number(q.total), 0);
  const sentTotal = fQuotes
    .filter((q) => q.status !== "draft")
    .reduce((s, q) => s + Number(q.total), 0);
  const acceptedTotal = fQuotes
    .filter((q) => q.status === "accepted" || q.status === "converted")
    .reduce((s, q) => s + Number(q.total), 0);
  const orderTotal = fOrders.reduce((s, o) => s + Number(o.total), 0);
  const deliveredTotal = fOrders
    .filter((o) => o.status === "delivered")
    .reduce((s, o) => s + Number(o.total), 0);
  const paidTotal = fInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + Number(i.total), 0);

  // Backlog = orders confirmed/partially delivered (carnet de commandes)
  const backlogOrders = fOrders.filter((o) =>
    ["confirmed", "partially_delivered"].includes(o.status)
  );
  const backlogValue = backlogOrders.reduce((s, o) => s + Number(o.total), 0);

  // Marge brute réelle : CA facturé - coût réel des sorties de stock (valorisées au CMP)
  const { revenue: invoicedRevenue, cogs, grossMargin, grossMarginPct } = computeRealGrossMargin(
    fInvoices.map((i) => Number(i.total)),
    cogsMovements.filter((m) => inRange(m.movement_date)).map((m) => m.total_value),
  );

  const conversionFunnel = [
    { stage: "Quotes Created", count: totalQuotes, value: quoteTotal },
    { stage: "Quotes Sent", count: sentQuotes, value: sentTotal },
    { stage: "Quotes Accepted", count: acceptedQuotes, value: acceptedTotal },
    { stage: "Orders Created", count: totalOrders, value: orderTotal },
    { stage: "Orders Delivered", count: deliveredOrders, value: deliveredTotal },
    { stage: "Invoiced & Paid", count: paidInvoices, value: paidTotal },
  ];

  return {
    isLoading,
    salesByCustomer,
    conversionFunnel,
    monthlyRevenue,
    quotations: fQuotes,
    orders: fOrders,
    arInvoices: fInvoices,
    backlogOrders,
    backlogValue,
    grossMargin,
    grossMarginPct,
    cogs,
    invoicedRevenue,
  };
}



/** Marge brute réelle : CA facturé moins coût réel (valeur absolue des sorties de stock au CMP). */
export function computeRealGrossMargin(invoiceTotals: number[], cogsValues: (number | null | undefined)[]) {
  const revenue = invoiceTotals.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  // A missing, zero/default or invalid valuation must never imply free inventory.
  const hasRealCost = cogsValues.length > 0 && cogsValues.every(
    (value) => typeof value === "number" && Number.isFinite(value) && value !== 0,
  );
  if (!hasRealCost) return { revenue, cogs: null, grossMargin: null, grossMarginPct: null };
  const cogs = cogsValues.reduce<number>((sum, value) => sum + Math.abs(value ?? 0), 0);
  const grossMargin = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossMargin / revenue) * 100 : 0;
  return { revenue, cogs, grossMargin, grossMarginPct };
}
