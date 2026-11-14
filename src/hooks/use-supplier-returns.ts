import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";

/*
 * Retours et avoirs fournisseurs (V52). Les tables sont en lecture seule pour l'application :
 * tout passe par create_supplier_return, credit_supplier_return et create_ap_credit_note, qui
 * numérotent, mouvementent le stock, comptabilisent et imputent sur la facture.
 */

export type SupplierReturnLine = {
  id: string; gr_line_id: string; po_line_id: string; item_id: string | null; description: string | null;
  quantity: number; unit_cost: number; replacement_expected: boolean;
};
export type SupplierReturn = {
  id: string; return_number: string; gr_id: string; po_id: string; supplier_id: string; return_date: string; reason: string;
  replacement_expected: boolean; total_value: number; credit_note_id: string | null;
  supplier_name: string; gr_number: string; po_number: string; credit_note_number: string | null;
  lines: SupplierReturnLine[];
};
export type APCreditNote = {
  id: string; credit_note_number: string; invoice_id: string; invoice_number: string; supplier_id: string; supplier_name: string;
  supplier_reference: string | null; credit_date: string; reason: string; subtotal: number; tax_amount: number; total: number;
  amount_allocated: number; return_number: string | null;
};

const INVALIDER = ["supplier-returns", "goods-receipts", "purchase-orders", "items", "ap-invoices", "ap-payments",
  "ap-credit-notes", "journal-entries", "procurement-kpis", "gl-batches"];

export function useSupplierReturns() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["supplier-returns", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<SupplierReturn[]> => {
      const { data, error } = await (supabase as any).from("supplier_returns")
        .select("*, supplier:suppliers(name), gr:goods_receipts(gr_number), po:purchase_orders(po_number),"
          + " credit_note:ap_credit_notes!supplier_returns_credit_note_id_fkey(credit_note_number), lines:supplier_return_lines(*)")
        .order("return_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r, total_value: Number(r.total_value), supplier_name: r.supplier?.name ?? "", gr_number: r.gr?.gr_number ?? "",
        po_number: r.po?.po_number ?? "", credit_note_number: r.credit_note?.credit_note_number ?? null,
        lines: (r.lines ?? []).map((l: any) => ({ ...l, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })),
      }));
    },
  });
}

export function useCreateSupplierReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      grId: string; reason: string; date: string; lines: { gr_line_id: string; quantity: number }[];
      replacement: boolean; invoiceId: string | null; supplierReference: string;
    }) => {
      const { data, error } = await (supabase as any).rpc("create_supplier_return", {
        _gr_id: p.grId, _reason: p.reason, _return_date: p.date, _lines: p.lines, _replacement_expected: p.replacement,
        _ap_invoice_id: p.invoiceId, _supplier_reference: p.supplierReference || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, p) => {
      for (const k of INVALIDER) qc.invalidateQueries({ queryKey: [k] });
      toast.success(p.invoiceId ? "Retour enregistré, avoir fournisseur comptabilisé" : "Retour fournisseur enregistré");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreditSupplierReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { returnId: string; invoiceId: string; supplierReference: string; date: string }) => {
      const { error } = await (supabase as any).rpc("credit_supplier_return", {
        _return_id: p.returnId, _invoice_id: p.invoiceId, _supplier_reference: p.supplierReference || null, _credit_date: p.date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of INVALIDER) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Avoir fournisseur comptabilisé et imputé sur la facture");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAPCreditNotes(invoiceId?: string) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["ap-credit-notes", tenantId, invoiceId ?? "all"],
    enabled: !!tenantId,
    queryFn: async (): Promise<APCreditNote[]> => {
      let q = (supabase as any).from("ap_credit_notes")
        .select("*, invoice:ap_invoices(invoice_number), supplier:suppliers(name),"
          + " supplier_return:supplier_returns!ap_credit_notes_supplier_return_id_fkey(return_number)")
        .order("credit_date", { ascending: false }).order("created_at", { ascending: false });
      if (invoiceId) q = q.eq("invoice_id", invoiceId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r, subtotal: Number(r.subtotal), tax_amount: Number(r.tax_amount), total: Number(r.total),
        amount_allocated: Number(r.amount_allocated), invoice_number: r.invoice?.invoice_number ?? "",
        supplier_name: r.supplier?.name ?? "", return_number: r.supplier_return?.return_number ?? null,
      }));
    },
  });
}

export function useCreateAPCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { invoiceId: string; reason: string; date: string; subtotal: number; tax: number; supplierReference: string }) => {
      const { error } = await (supabase as any).rpc("create_ap_credit_note", {
        _invoice_id: p.invoiceId, _reason: p.reason, _credit_date: p.date, _subtotal: p.subtotal, _tax_amount: p.tax,
        _supplier_reference: p.supplierReference || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of INVALIDER) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Avoir fournisseur comptabilisé et imputé sur la facture");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
