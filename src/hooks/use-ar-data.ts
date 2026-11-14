import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";
import type { ApiSchemas } from "@/api";
import { toARInvoice } from "@/lib/ar-api-mapping";

// ============================================================
//  AR CONFIG HOOKS — DB-driven (no mocks)
// ============================================================

const sb = supabase as any;

// ─── Payment Terms ───
export interface ARPaymentTerm {
  id: string;
  tenant_id: string;
  code: string;
  label: string;
  days: number;
  discount_percent: number;
  is_active: boolean;
}

export function useARPaymentTerms() {
  return useQuery({
    queryKey: ["ar-payment-terms"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_payment_terms").select("*").order("days");
      if (error) throw error;
      return (data || []) as ARPaymentTerm[];
    },
  });
}

export function useUpsertARPaymentTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (term: Partial<ARPaymentTerm> & { code: string; label: string; days: number }) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ar_payment_terms").upsert({ ...term, tenant_id }, { onConflict: "tenant_id,code" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ar-payment-terms"] }); toast.success("Terme enregistré"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Numbering Series ───
export interface ARNumberingSeries {
  id: string;
  tenant_id: string;
  doc_type: string;
  prefix: string;
  format: string;
  next_number: number;
  reset_frequency: string;
}

export function useARNumberingSeries() {
  return useQuery({
    queryKey: ["ar-numbering-series"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_numbering_series").select("*").order("doc_type");
      if (error) throw error;
      return (data || []) as ARNumberingSeries[];
    },
  });
}

export function useUpdateARNumberingSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ARNumberingSeries> & { id: string }) => {
      const { error } = await sb.from("ar_numbering_series").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ar-numbering-series"] }); toast.success("Série mise à jour"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Dunning Rules ───
export interface ARDunningRule {
  id: string;
  tenant_id: string;
  level: number;
  days_overdue: number;
  action: string;
  fee_amount: number;
  template: string | null;
  is_active: boolean;
}

export function useARDunningRules() {
  return useQuery({
    queryKey: ["ar-dunning-rules"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_dunning_rules").select("*").order("level");
      if (error) throw error;
      return (data || []) as ARDunningRule[];
    },
  });
}

export function useUpsertARDunningRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<ARDunningRule> & { level: number; days_overdue: number; action: string }) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ar_dunning_rules").upsert({ ...rule, tenant_id }, { onConflict: "tenant_id,level" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ar-dunning-rules"] }); toast.success("Niveau de relance enregistré"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Notification Rules ───
export interface ARNotificationRule {
  id: string;
  tenant_id: string;
  trigger_condition: string;
  channel: string;
  recipients: string;
  is_active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
}

export function useARNotificationRules() {
  return useQuery({
    queryKey: ["ar-notification-rules"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_notification_rules").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ARNotificationRule[];
    },
  });
}

export function useUpsertARNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<ARNotificationRule> & { trigger_condition: string; channel: string; recipients: string }) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ar_notification_rules").upsert({ ...rule, tenant_id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ar-notification-rules"] }); toast.success("Règle enregistrée"); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useToggleARNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await sb.from("ar_notification_rules").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ar-notification-rules"] }),
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Notification Log ───
export interface ARNotificationLogEntry {
  id: string;
  tenant_id: string;
  rule_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  channel: string;
  detail: string | null;
  status: string;
  sent_at: string;
}

export function useARNotificationLog(limit = 50) {
  return useQuery({
    queryKey: ["ar-notification-log", limit],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_notification_log").select("*").order("sent_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data || []) as ARNotificationLogEntry[];
    },
  });
}

// ─── Period Locks ───
export interface PeriodLock {
  id: string;
  tenant_id: string;
  period: string;
  module: string;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
}

export function usePeriodLocks(module?: string) {
  return useQuery({
    queryKey: ["period-locks", module],
    queryFn: async () => {
      let q = sb.from("period_locks").select("*").order("period", { ascending: false });
      if (module) q = q.eq("module", module);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PeriodLock[];
    },
  });
}

/**
 * Clôture d'une période pour un module, par le calendrier fiscal central (V33) : la base vérifie
 * le droit, l'exercice et l'ordre de clôture. La réouverture, qui exige un motif, se fait dans
 * Paramètres → Exercices et périodes. (Avant V33 l'écran écrivait directement dans period_locks,
 * ce que n'importe quel membre de la société pouvait faire.)
 */
export function useTogglePeriodLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ period, module, close, reason }: { period: string; module: string; close: boolean; reason?: string }) => {
      const { error } = await sb.rpc("set_period_status", {
        _period: period, _module: module, _status: close ? "closed" : "open", _reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["period-locks"] });
      qc.invalidateQueries({ queryKey: ["fiscal-calendar"] });
      toast.success("Période mise à jour");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── AR General Settings ───
export interface ARGeneralSettings {
  tenant_id: string;
  default_payment_term_code: string;
  default_currency: string;
  default_credit_limit: number;
  auto_numbering: boolean;
  late_payment_interest_pct: number;
  grace_period_days: number;
}

export function useARGeneralSettings() {
  return useQuery({
    queryKey: ["ar-general-settings"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_general_settings").select("*").maybeSingle();
      if (error) throw error;
      return data as ARGeneralSettings | null;
    },
  });
}

export function useUpdateARGeneralSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<ARGeneralSettings>) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("ar_general_settings").upsert({ tenant_id, ...updates });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ar-general-settings"] }); toast.success("Paramètres enregistrés"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Credit Exposure ───
export interface ARCreditExposureRow {
  tenant_id: string;
  customer_id: string;
  customer_name: string;
  credit_limit: number;
  outstanding: number;
  overdue: number;
  dso: number;
  risk_score: number;
}

export function useARCreditExposure() {
  return useQuery({
    queryKey: ["ar-credit-exposure"],
    queryFn: async () => {
      const { data, error } = await sb.from("ar_credit_exposure_view").select("*").order("outstanding", { ascending: false });
      if (error) throw error;
      return (data || []) as ARCreditExposureRow[];
    },
  });
}

// ─── Report Templates ───
export interface ReportTemplate {
  id: string;
  tenant_id: string;
  module: string;
  name: string;
  data_source: string;
  columns: string[];
  filters: Record<string, any>;
  group_by: string | null;
  status: string;
  permission: string | null;
  created_by: string | null;
  created_at: string;
}

export function useReportTemplates(module: string) {
  return useQuery({
    queryKey: ["report-templates", module],
    queryFn: async () => {
      const { data, error } = await sb.from("report_templates").select("*").eq("module", module).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ReportTemplate[];
    },
  });
}

export function useSaveReportTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (tpl: Partial<ReportTemplate> & { module: string; name: string; data_source: string }) => {
      const tenant_id = await fetchTenantId();
      const { error } = await sb.from("report_templates").insert({ ...tpl, tenant_id, created_by: user?.id });
      if (error) throw error;
    },
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ["report-templates", vars.module] }); toast.success("Modèle sauvegardé"); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("report_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-templates"] }); toast.success("Modèle supprimé"); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Types ───
export interface ARInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  status: string;
  created_by: string;
  created_at: string;
  customer?: { id: string; name: string; credit_limit: number; payment_terms: number };
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  credit_limit: number;
  payment_terms: number;
  status: string;
  created_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  payment_type: string;
  ar_invoice_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  created_by: string;
  created_at: string;
  /** V42 : une annulation est une ligne négative liée au règlement d'origine. */
  reversal_of?: string | null;
  reversal_reason?: string | null;
}

// tenant_id is now fetched dynamically via fetchTenantId()

// ─── AR Invoices ───
export function useARInvoices() {
  return useQuery({
    // L'origine des données fait partie de la clé : basculer VITE_QERP_API_URL ne doit pas
    // servir au front le cache de l'autre source.
    queryKey: ["ar-invoices", isApiEnabled() ? "api" : "supabase"],
    queryFn: async () => {
      if (isApiEnabled()) {
        const [invoices, customers] = await Promise.all([
          apiGet<ApiSchemas["ArInvoiceView"][]>("/api/v1/ar/invoices"),
          apiGet<ApiSchemas["CustomerView"][]>("/api/v1/customers"),
        ]);
        const byId = new Map(customers.map((c) => [c.id, c]));
        return invoices.map((i) => toARInvoice(i, byId)) as ARInvoice[];
      }
      const { data, error } = await supabase
        .from("ar_invoices")
        .select("*, customer:customers(id, name, credit_limit, payment_terms)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ARInvoice[];
    },
  });
}

export function useCreateARInvoice() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (inv: {
      invoice_number: string;
      customer_id: string;
      invoice_date: string;
      due_date: string;
      subtotal: number;
      tax_amount: number;
      total: number;
      /** Section choisie par axe ({ axisId: valueId }) ; l'emporte sur le défaut du client. */
      analytics?: Record<string, string>;
      /** Lignes (V21) : la base calcule HT et TVA ; l'en-tête devient leur somme. */
      lines?: { description: string; quantity: number; unit_price: number; discount_pct: number; tax_code_id?: string }[];
    }) => {
      const { analytics: chosen = {}, lines = [], ...given } = inv;
      // Numéro facultatif (V22) : en numérotation automatique, la base attribue le définitif à
      // l'émission ; un brouillon sans numéro reçoit un numéro provisoire unique.
      const fields = {
        ...given,
        invoice_number: given.invoice_number.trim() || `BROUILLON-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      };
      const analytics = Object.entries(chosen).filter(([, valueId]) => Boolean(valueId));
      if (isApiEnabled()) {
        // Le total est recalculé côté base (HT + TVA) : on n'envoie que les composantes.
        return apiPost("/api/v1/ar/invoices", {
          invoiceNumber: inv.invoice_number.trim() || null,
          customerId: inv.customer_id,
          invoiceDate: inv.invoice_date,
          dueDate: inv.due_date,
          subtotal: inv.subtotal,
          taxAmount: inv.tax_amount,
          analytics: analytics.map(([axisId, valueId]) => ({ axisId, valueId })),
          ...(lines.length > 0 ? {
            lines: lines.map((l) => ({
              description: l.description, quantity: l.quantity, unitPrice: l.unit_price,
              discountPct: l.discount_pct, taxCodeId: l.tax_code_id || null,
            })),
          } : {}),
        });
      }
      const tenant_id = await fetchTenantId();
      if (analytics.length > 0 || lines.length > 0) {
        // Les sections se posent sur une facture en brouillon (V19), lues à l'émission. Sans
        // transaction entre appels PostgREST, un refus à l'émission (section inactive, règle)
        // laisserait un brouillon orphelin : on le retire avant de rendre l'erreur d'origine.
        const { data: draft, error: draftError } = await supabase.from("ar_invoices").insert({
          ...fields, tenant_id, created_by: user!.id, status: "draft", amount_paid: 0,
          // Avec des lignes, l'en-tête part de zéro : la base le recalcule à chaque ligne.
          ...(lines.length > 0 ? { subtotal: 0, tax_amount: 0, total: 0 } : {}),
        }).select().single();
        if (draftError) throw draftError;
        const db = supabase as any;
        const { error: lineError } = lines.length > 0
          ? await db.from("ar_invoice_lines").insert(lines.map((l, i) => ({
              tenant_id, invoice_id: draft.id, line_no: i + 1, description: l.description, quantity: l.quantity,
              unit_price: l.unit_price, discount_pct: l.discount_pct, tax_code_id: l.tax_code_id || null,
            })))
          : { error: null };
        const { error: anaError } = lineError
          ? { error: lineError }
          : analytics.length > 0
            ? await db.from("ar_invoice_analytics").insert(
                analytics.map(([axis_id, value_id]) => ({ tenant_id, invoice_id: draft.id, axis_id, value_id })))
            : { error: null };
        const { data: sent, error: sentError } = anaError
          ? { data: null, error: anaError }
          : await supabase.from("ar_invoices").update({ status: "sent" }).eq("id", draft.id).select().single();
        if (anaError || sentError) {
          await supabase.from("ar_invoices").delete().eq("id", draft.id);
          throw anaError ?? sentError;
        }
        return sent;
      }
      // status='sent' triggers the JE auto-post (DR 4110 / CR 4000 + 4310)
      const { data, error } = await supabase.from("ar_invoices").insert({
        ...fields,
        tenant_id,
        created_by: user!.id,
        status: "sent",
        amount_paid: 0,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      toast.success("Facture créée");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

/* V42 : une facture émise est figée en base ; seul un brouillon s'émet, se complète ou se supprime. */
export function useEmitARInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ar_invoices").update({ status: "sent" }).eq("id", id).eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      qc.invalidateQueries({ queryKey: ["ar-invoice-lines"] });
      toast.success("Facture émise et comptabilisée");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useDeleteARDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ar_invoices").delete().eq("id", id).eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      toast.success("Brouillon supprimé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

/** Code TVA d'une ligne de brouillon : la base recalcule la ligne et le pied (V21). */
export function useSetARDraftLineTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, taxCodeId }: { lineId: string; taxCodeId: string | null }) => {
      const { error } = await (supabase as any).from("ar_invoice_lines").update({ tax_code_id: taxCodeId }).eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      qc.invalidateQueries({ queryKey: ["ar-invoice-lines"] });
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── Payments ───
export function useARPayments(invoiceId?: string) {
  return useQuery({
    queryKey: ["ar-payments", invoiceId],
    queryFn: async () => {
      let q = supabase.from("payments").select("*").eq("payment_type", "ar_receipt");
      if (invoiceId) q = q.eq("ar_invoice_id", invoiceId);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Payment[];
    },
    enabled: !!invoiceId || invoiceId === undefined,
  });
}

/** Règlements d'une facture, annulations comprises (API sur site, sinon Supabase). */
export function useARInvoicePayments(invoiceId: string | undefined) {
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["ar-payments", invoiceId, source],
    enabled: !!invoiceId,
    queryFn: async (): Promise<Payment[]> => {
      if (source === "api") {
        const rows = await apiGet<ApiSchemas["ArPaymentView"][]>(`/api/v1/ar/invoices/${invoiceId}/payments`);
        return rows.map((r) => ({
          id: r.id, tenant_id: "", ar_invoice_id: invoiceId ?? null,
          amount: Number(r.amount), payment_date: r.paymentDate, payment_method: r.paymentMethod,
          reference: r.reference ?? null, created_by: "", created_at: r.paymentDate,
          reversal_of: r.reversalOf ?? null, reversal_reason: r.reversalReason ?? null,
          payment_type: r.paymentType,
        }));
      }
      const { data, error } = await supabase.from("payments").select("*")
        .in("payment_type", ["ar_receipt", "ar_credit"]).eq("ar_invoice_id", invoiceId!).order("created_at");
      if (error) throw error;
      return (data || []) as unknown as Payment[];
    },
  });
}

/** Annulation d'un encaissement (V42) : contre-passation, motif obligatoire. */
export function useReverseARReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, paymentId, reason, date }: { invoiceId: string; paymentId: string; reason: string; date: string }) => {
      if (isApiEnabled()) {
        await apiPost(`/api/v1/ar/invoices/${invoiceId}/payments/${paymentId}/reversal`, { reason, reversalDate: date });
        return;
      }
      const { error } = await (supabase as any).rpc("reverse_settlement", {
        _payment_id: paymentId, _reason: reason, _reversal_date: date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      qc.invalidateQueries({ queryKey: ["ar-payments"] });
      toast.success("Encaissement annulé (écriture contre-passée)");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── Avoirs clients (V45) ───
export interface ARCreditNote {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  credit_date: string;
  reason: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_allocated: number;
  lines: { line_no: number; description: string; quantity: number; unit_price: number; discount_pct: number;
    tax_code: string | null; net_amount: number; tax_amount: number }[];
}

export function useARCreditNotes(invoiceId?: string) {
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["ar-credit-notes", invoiceId ?? "all", source],
    queryFn: async (): Promise<ARCreditNote[]> => {
      if (source === "api") {
        const rows = await apiGet<ApiSchemas["ArCreditNoteView"][]>(
          `/api/v1/ar/invoices/credit-notes${invoiceId ? `?invoiceId=${invoiceId}` : ""}`);
        return rows.map((r) => ({
          id: r.id, credit_note_number: r.creditNoteNumber, invoice_id: r.invoiceId, invoice_number: r.invoiceNumber,
          customer_id: r.customerId, customer_name: r.customerName, credit_date: r.creditDate, reason: r.reason,
          subtotal: Number(r.subtotal), tax_amount: Number(r.taxAmount), total: Number(r.total),
          amount_allocated: Number(r.amountAllocated),
          lines: r.lines.map((l) => ({
            line_no: Number(l.lineNo), description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unitPrice),
            discount_pct: Number(l.discountPct), tax_code: l.taxCode ?? null, net_amount: Number(l.netAmount), tax_amount: Number(l.taxAmount),
          })),
        }));
      }
      let q = (supabase as any).from("ar_credit_notes")
        .select("*, invoice:ar_invoices(invoice_number), customer:customers(name), lines:ar_credit_note_lines(line_no, description, quantity, unit_price, discount_pct, net_amount, tax_amount, tax_code:tax_codes(code))")
        .order("credit_date", { ascending: false });
      if (invoiceId) q = q.eq("invoice_id", invoiceId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, credit_note_number: r.credit_note_number, invoice_id: r.invoice_id, invoice_number: r.invoice?.invoice_number ?? "",
        customer_id: r.customer_id, customer_name: r.customer?.name ?? "", credit_date: r.credit_date, reason: r.reason,
        subtotal: Number(r.subtotal), tax_amount: Number(r.tax_amount), total: Number(r.total), amount_allocated: Number(r.amount_allocated),
        lines: (r.lines ?? []).sort((a: any, b: any) => a.line_no - b.line_no).map((l: any) => ({
          line_no: l.line_no, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct), tax_code: l.tax_code?.code ?? null, net_amount: Number(l.net_amount), tax_amount: Number(l.tax_amount),
        })),
      }));
    },
  });
}

/** Émission d'un avoir : motif, date, lignes [{invoice_line_id, quantity}] ou rien (tout le reste). */
export function useCreateARCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, reason, date, lines }: {
      invoiceId: string; reason: string; date: string; lines: { invoice_line_id: string; quantity: number }[] | null;
    }) => {
      if (isApiEnabled()) {
        await apiPost(`/api/v1/ar/invoices/${invoiceId}/credit-notes`, {
          reason, creditDate: date,
          lines: lines ? lines.map((l) => ({ invoiceLineId: l.invoice_line_id, quantity: l.quantity })) : null,
        });
        return;
      }
      const { error } = await (supabase as any).rpc("create_ar_credit_note", {
        _invoice_id: invoiceId, _reason: reason, _credit_date: date, _lines: lines,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of ["ar-invoices", "ar-payments", "ar-credit-notes", "ar-invoice-lines"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Avoir émis et comptabilisé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useRecordARPayment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (payment: {
      ar_invoice_id: string;
      amount: number;
      payment_date: string;
      payment_method: string;
      reference: string;
    }) => {
      if (isApiEnabled()) {
        await apiPost(`/api/v1/ar/invoices/${payment.ar_invoice_id}/payments`, {
          amount: payment.amount,
          paymentDate: payment.payment_date,
          paymentMethod: payment.payment_method,
          reference: payment.reference,
        });
        return;
      }
      // Insert payment — DB triggers will:
      //  • post the bank/clients JE (on_ap_payment_recorded)
      //  • recompute invoice amount_paid + status (recompute_ar_invoice_from_payment)
      const tenant_id = await fetchTenantId();
      const { error: payError } = await supabase.from("payments").insert({
        ...payment,
        tenant_id,
        payment_type: "ar_receipt",
        created_by: user!.id,
      });
      if (payError) throw payError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      qc.invalidateQueries({ queryKey: ["ar-payments"] });
      toast.success("Paiement enregistré");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── Customers ───
export function useCustomers() {
  // Sur site, la fiche client vient de l'API (base locale), comme les factures : sinon le front
  // mêlait les clients du nuage et les factures de la base locale.
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["customers", source],
    queryFn: async () => {
      if (source === "api") {
        const rows = await apiGet<ApiSchemas["CustomerView"][]>("/api/v1/customers");
        return rows.map(customerFromApi);
      }
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data || []) as Customer[];
    },
  });
}

function customerFromApi(c: ApiSchemas["CustomerView"]): Customer {
  return {
    id: c.id, tenant_id: "", name: c.name, email: c.email ?? null, phone: c.phone ?? null,
    address: c.address ?? null, tax_id: c.taxId ?? null, credit_limit: Number(c.creditLimit ?? 0),
    payment_terms: Number(c.paymentTerms ?? 30), status: c.status, created_at: "",
  };
}

function customerToApi(c: Partial<Customer>) {
  return {
    name: c.name, email: c.email ?? null, phone: c.phone ?? null, address: c.address ?? null,
    taxId: c.tax_id ?? null, creditLimit: c.credit_limit ?? 0, paymentTerms: c.payment_terms ?? 30,
  };
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Omit<Customer, "id" | "tenant_id" | "created_at">) => {
      if (isApiEnabled()) return apiPost("/api/v1/customers", customerToApi(c));
      const tenant_id = await fetchTenantId();
      const { data, error } = await supabase.from("customers").insert({
        ...c,
        tenant_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Client créé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Customer> & { id: string }) => {
      if (isApiEnabled()) { await apiPut(`/api/v1/customers/${id}`, customerToApi(updates)); return; }
      const { error } = await supabase.from("customers").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Client mis à jour");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (isApiEnabled()) throw new Error("Sur site, un client ne se supprime pas : ses pièces y restent rattachées.");
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Client supprimé");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

// ─── AR Aging (server-side via view) ───
export interface ARAgingRow {
  tenant_id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string | null;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  outstanding: number;
  days_overdue: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
  status: string;
}

export function useARAging() {
  return useQuery({
    queryKey: ["ar-aging"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ar_aging_view")
        .select("*")
        .order("days_overdue", { ascending: false });
      if (error) throw error;
      return (data || []) as ARAgingRow[];
    },
  });
}

// ── Lignes d'une facture client (vue de détail : en-tête, lignes, pied) ──
export type ARInvoiceLineRow = {
  /** Supabase seulement : identifiant et code TVA modifiables sur un brouillon. */
  id?: string;
  tax_code_id?: string | null;
  /** Quantité déjà créditée par des avoirs (V45). */
  credited_quantity?: number;
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_code: string | null;
  net_amount: number;
  tax_amount: number;
};

export function useARInvoiceLines(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["ar-invoice-lines", invoiceId, isApiEnabled() ? "api" : "supabase"],
    enabled: !!invoiceId,
    queryFn: async (): Promise<ARInvoiceLineRow[]> => {
      if (isApiEnabled()) {
        const rows = await apiGet<ApiSchemas["ArInvoiceLineView"][]>(`/api/v1/ar/invoices/${invoiceId}/lines`);
        return rows.map((r) => ({
          id: r.id, credited_quantity: Number(r.creditedQuantity ?? 0),
          line_no: Number(r.lineNo), description: r.description, quantity: Number(r.quantity),
          unit_price: Number(r.unitPrice), discount_pct: Number(r.discountPct ?? 0), tax_code: r.taxCode ?? null,
          net_amount: Number(r.netAmount), tax_amount: Number(r.taxAmount),
        }));
      }
      const { data, error } = await (supabase as any)
        .from("ar_invoice_lines")
        .select("id, tax_code_id, line_no, description, quantity, unit_price, discount_pct, net_amount, tax_amount, tax_code:tax_codes(code)")
        .eq("invoice_id", invoiceId)
        .order("line_no");
      if (error) throw error;
      const ids = (data ?? []).map((r: any) => r.id);
      const credited = new Map<string, number>();
      if (ids.length > 0) {
        const { data: cl, error: ce } = await (supabase as any).from("ar_credit_note_lines")
          .select("invoice_line_id, quantity").in("invoice_line_id", ids);
        if (ce) throw ce;
        for (const c of cl ?? []) credited.set(c.invoice_line_id, (credited.get(c.invoice_line_id) ?? 0) + Number(c.quantity));
      }
      return (data ?? []).map((r: any) => ({
        id: r.id, tax_code_id: r.tax_code_id ?? null, credited_quantity: credited.get(r.id) ?? 0,
        line_no: r.line_no, description: r.description, quantity: Number(r.quantity), unit_price: Number(r.unit_price),
        discount_pct: Number(r.discount_pct ?? 0), tax_code: r.tax_code?.code ?? null,
        net_amount: Number(r.net_amount), tax_amount: Number(r.tax_amount),
      }));
    },
  });
}
