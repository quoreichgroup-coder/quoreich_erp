import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { moduleCan, useMyAccess } from "@/hooks/use-my-access";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import { useTenantRoleMembers } from "@/hooks/use-role-members";

// ===== Types =====
export interface Quotation {
  id: string;
  quote_number: string;
  quote_date: string;
  customer_id: string;
  total: number;
  status: string;
  valid_until: string | null;
  tax_amount?: number;
  total_ttc?: number;
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
  tax_amount?: number;
  total_ttc?: number;
  credit_override_reason?: string | null;
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
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["quotations", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*, customer:customers(name)")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Quotation[];
    },
  });
}

export function useSalesOrders() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["sales-orders", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("*, customer:customers(name), quotation:quotations(quote_number)")
        .eq("tenant_id", tenantId!)
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
      const { data, error } = await (supabase as any).from("so_lines").select(LINE_SELECT).eq("so_id", soId!).order("created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

/** Ligne d'une pièce de vente (devis, commande, livraison) — V43 / V44. */
export interface SalesLine {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_amount: number;
  total: number;
  tax_code_id: string | null;
  quantity_ordered?: number;
  quantity_delivered?: number;
  tax_code?: { code: string } | null;
}

const LINE_SELECT = "*, tax_code:tax_codes(code)";

export function useQuoteLines(quoteId?: string) {
  return useQuery({
    queryKey: ["quote-lines", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("quote_lines").select(LINE_SELECT)
        .eq("quotation_id", quoteId!).order("created_at");
      if (error) throw error;
      return (data || []) as SalesLine[];
    },
  });
}

export function useDnLines(dnId?: string) {
  return useQuery({
    queryKey: ["dn-lines", dnId],
    enabled: !!dnId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("dn_lines").select(LINE_SELECT)
        .eq("dn_id", dnId!).order("created_at");
      if (error) throw error;
      return (data || []) as SalesLine[];
    },
  });
}

/** Encours d'un client : factures émises non soldées (même calcul que le contrôle de crédit, V43). */
export function useCustomerExposure(customerId?: string) {
  return useQuery({
    queryKey: ["customer-exposure", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ar_invoices").select("total, amount_paid, status, due_date")
        .eq("customer_id", customerId!).not("status", "in", "(draft,paid,cancelled)");
      if (error) throw error;
      const rows = data || [];
      const today = new Date().toISOString().split("T")[0];
      return {
        outstanding: rows.reduce((s, r) => s + Number(r.total) - Number(r.amount_paid), 0),
        overdue: rows.filter((r) => r.due_date && r.due_date < today).reduce((s, r) => s + Number(r.total) - Number(r.amount_paid), 0),
        invoices: rows.length,
      };
    },
  });
}

export function useDeliveryNotes() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["delivery-notes", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_notes")
        .select("*, customer:customers(name), sales_order:sales_orders(so_number)")
        .eq("tenant_id", tenantId!)
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
      const { data, error } = await supabase
        .from("sales_settings")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId!)
        .select("tenant_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Seul un administrateur peut modifier ces paramètres, ou la société n'a pas de configuration.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-settings"] });
      toast.success("Paramètres enregistrés");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export type SalesNumberingSeries = {
  tenant_id: string;
  doc_type: "quotation" | "sales_order" | "delivery_note";
  prefix: string;
  format: string;
  next_number: number;
  reset_frequency: "yearly" | "never";
};

export function useSalesNumberingSeries() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["sales-numbering-series", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_numbering_series" as never)
        .select("tenant_id, doc_type, prefix, format, next_number, reset_frequency")
        .eq("tenant_id", tenantId)
        .order("doc_type");
      if (error) throw error;
      return (data ?? []) as SalesNumberingSeries[];
    },
  });
}

export function useUpdateSalesNumberingSeries() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  return useMutation({
    mutationFn: async (series: Pick<SalesNumberingSeries, "doc_type" | "prefix" | "format" | "reset_frequency">) => {
      const { error } = await supabase.from("sales_numbering_series" as never)
        .update({ prefix: series.prefix.trim(), format: series.format.trim(), reset_frequency: series.reset_frequency, updated_at: new Date().toISOString() } as never)
        .eq("tenant_id", tenantId)
        .eq("doc_type", series.doc_type);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-numbering-series", tenantId] });
      toast.success("Série de numérotation enregistrée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useMySalesRoles() {
  // Droits dits par la base (my_access, V27). L'export CSV, action du navigateur sans
  // équivalent au catalogue, reste par rôle.
  const q = useMyAccess();
  const can = moduleCan(q.data, "sales");
  const roles = new Set(q.data?.roles ?? []);
  return {
    ...q,
    data: q.data && {
      isAdmin: roles.has("admin"),
      canCreate: can("create"),
      canConfirm: can("confirm"),
      canDeliver: can("deliver"),
      canInvoice: can("invoice"),
      canExport: roles.has("admin") || roles.has("sales_manager") || roles.has("sales_controller"),
      roles: Array.from(roles),
    },
  };
}

// ===== Mutations =====
export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customer_id: string;
      quote_date: string;
      valid_until: string;
      lines: Array<{ description: string; quantity: number; unit_price: number; discount_pct?: number; tax_code_id?: string | null }>;
    }) => {
      const { error } = await supabase.rpc("create_sales_quotation" as never, {
        _customer_id: input.customer_id,
        _quote_date: input.quote_date,
        _valid_until: input.valid_until,
        _lines: input.lines,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Devis créé");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customer_id: string;
      order_date: string;
      lines: Array<{ description: string; quantity: number; unit_price: number; discount_pct?: number; tax_code_id?: string | null }>;
    }) => {
      const { error } = await supabase.rpc("create_sales_order" as never, {
        _customer_id: input.customer_id,
        _order_date: input.order_date,
        _lines: input.lines,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Commande créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Commande depuis les lignes choisies d'un devis du client (V44). */
export function useCreateOrderFromQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { quoteId: string; orderDate: string; lines: { quote_line_id: string; quantity: number }[] }) => {
      const { data, error } = await (supabase as any).rpc("create_sales_order_from_quote", {
        _quote_id: input.quoteId, _lines: input.lines, _order_date: input.orderDate,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["quote-lines"] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      toast.success("Commande créée depuis le devis");
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
    // V43 : au-delà de la limite de crédit, refus QG010 ; un motif lève le blocage (droit requis).
    mutationFn: async ({ soId, reason }: { soId: string; reason?: string }) => {
      const { error } = await (supabase as any).rpc("confirm_so", { _so_id: soId, _override_reason: reason ?? null });
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
  return useTenantRoleMembers("tenant-sales-roles", SALES_ROLES);
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
      // Droits de l'utilisateur (my_access, V27) et matrice de /settings : le rôle y est recopié.
      qc.invalidateQueries({ queryKey: ["my-access"] });
      qc.invalidateQueries({ queryKey: ["authorizations"] });
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
