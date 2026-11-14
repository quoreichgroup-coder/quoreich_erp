import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { isApiEnabled } from "@/api/client";

/*
 * Crédits clients (V49) : acomptes reçus (compte 4191) et surplus d'avoirs non imputés ; imputation
 * sur une facture du même client, remboursement ; lettrage des factures soldées. Toutes les
 * écritures passent par les fonctions contrôlées de la base. Sur site : à venir (API).
 */
const sb = supabase as any;

export interface CustomerCredit {
  kind: "advance" | "credit_note";
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  date: string;
  total: number;
  available: number;
  label: string;
}

export function useCustomerCredits(customerId?: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["customer-credits", tenantId, customerId ?? "all"],
    enabled: !!tenantId && !isApiEnabled(),
    queryFn: async (): Promise<CustomerCredit[]> => {
      let qa = sb.from("ar_customer_advances").select("id, advance_number, customer_id, received_date, amount, amount_applied, amount_refunded, reference, customer:customers(name)")
        .eq("tenant_id", tenantId).order("received_date");
      let qc = sb.from("ar_credit_notes").select("id, credit_note_number, customer_id, credit_date, total, amount_allocated, amount_refunded, reason, customer:customers(name)")
        .eq("tenant_id", tenantId).order("credit_date");
      if (customerId) { qa = qa.eq("customer_id", customerId); qc = qc.eq("customer_id", customerId); }
      const [{ data: adv, error: ea }, { data: cns, error: ec }] = await Promise.all([qa, qc]);
      if (ea) throw ea;
      if (ec) throw ec;
      const out: CustomerCredit[] = [];
      for (const a of adv ?? []) {
        const available = Number(a.amount) - Number(a.amount_applied) - Number(a.amount_refunded);
        if (available > 0) out.push({ kind: "advance", id: a.id, number: a.advance_number, customer_id: a.customer_id, customer_name: a.customer?.name ?? "",
          date: a.received_date, total: Number(a.amount), available, label: `Acompte${a.reference ? ` · ${a.reference}` : ""}` });
      }
      for (const c of cns ?? []) {
        const available = Number(c.total) - Number(c.amount_allocated) - Number(c.amount_refunded);
        if (available > 0) out.push({ kind: "credit_note", id: c.id, number: c.credit_note_number, customer_id: c.customer_id, customer_name: c.customer?.name ?? "",
          date: c.credit_date, total: Number(c.total), available, label: `Avoir non imputé · ${c.reason}` });
      }
      return out.sort((x, y) => x.date.localeCompare(y.date));
    },
  });
}

/**
 * Codes de lettrage des factures soldées (invoice_id → code). `paidKey` = identifiants des factures
 * soldées : la liste se relit dès qu'une facture devient soldée, quel que soit le moyen (encaissement,
 * imputation, avoir), ou redevient due.
 */
export function useARLetterings(paidKey = "") {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["ar-letterings", tenantId, paidKey],
    enabled: !!tenantId && !isApiEnabled(),
    queryFn: async () => {
      const { data, error } = await sb.from("ar_letterings").select("invoice_id, code, gl_lettered").eq("tenant_id", tenantId);
      if (error) throw error;
      return new Map<string, { code: string; gl: boolean }>((data ?? []).map((l: any) => [l.invoice_id, { code: l.code, gl: l.gl_lettered }]));
    },
  });
}

function useCreditMutation<T>(fn: (i: T) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of ["customer-credits", "ar-invoices", "ar-payments", "ar-letterings", "ar-credit-notes", "customer-statement", "customer-exposure"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
};

export const useRecordAdvance = () => useCreditMutation(
  (i: { customerId: string; date: string; method: string; reference: string; amount: number; salesOrderId?: string | null }) =>
    rpc("record_customer_advance", { _customer_id: i.customerId, _received_date: i.date, _payment_method: i.method,
      _reference: i.reference || null, _amount: i.amount, _sales_order_id: i.salesOrderId || null }),
  "Acompte enregistré et comptabilisé (banque / avances clients)");

export const useApplyCredit = () => useCreditMutation(
  (i: { invoiceId: string; kind: "advance" | "credit_note"; sourceId: string; amount: number; date: string }) =>
    rpc("apply_customer_credit", { _invoice_id: i.invoiceId, _source_type: i.kind, _source_id: i.sourceId, _amount: i.amount, _apply_date: i.date }),
  "Crédit imputé sur la facture");

export const useRefundCredit = () => useCreditMutation(
  (i: { kind: "advance" | "credit_note"; sourceId: string; amount: number; date: string; method: string; reference: string }) =>
    rpc("refund_customer_credit", { _source_type: i.kind, _source_id: i.sourceId, _amount: i.amount, _refund_date: i.date,
      _payment_method: i.method, _reference: i.reference || null }),
  "Remboursement enregistré et comptabilisé");
