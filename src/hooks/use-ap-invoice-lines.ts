import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";

/*
 * Factures fournisseurs à lignes (V72) : en-tête puis lignes (l'en-tête est recalculé par la base) ;
 * si les lignes sont refusées à la création, l'en-tête est supprimé pour ne pas laisser de facture vide.
 */
const db = supabase as any;

export type APLineInput = {
  description: string; quantity: number; unit_price: number; discount_pct: number; tax_code_id: string | null;
  po_line_id: string | null; expense_account_id?: string | null;
};
export type APInvoiceHeader = {
  supplier_id: string; po_id: string | null; invoice_number: string; invoice_date: string; due_date: string; control_total: number | null;
};
export type APInvoiceLine = APLineInput & { id: string; line_no: number; net_amount: number; tax_amount: number; grni_cleared: number };
export type POLineToInvoice = { po_line_id: string; description: string; unit_cost: number; ordered: number; received: number; invoiced: number; remaining: number };

const rows = (invoiceId: string, tenantId: string, lines: APLineInput[]) => lines.map((l, i) => ({
  tenant_id: tenantId, invoice_id: invoiceId, line_no: i + 1, description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price,
  discount_pct: l.discount_pct || 0, tax_code_id: l.tax_code_id || null, po_line_id: l.po_line_id || null, expense_account_id: l.expense_account_id || null,
}));

export function useAPInvoiceLines(invoiceId: string | null) {
  return useQuery({
    queryKey: ["ap-invoice-lines", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await db.from("ap_invoice_lines").select("*").eq("invoice_id", invoiceId).order("line_no");
      if (error) throw error;
      return (data ?? []) as APInvoiceLine[];
    },
  });
}

export function usePOLinesToInvoice(poId: string | null, exceptInvoice?: string | null) {
  return useQuery({
    queryKey: ["ap-po-lines-to-invoice", poId, exceptInvoice ?? null],
    enabled: !!poId,
    queryFn: async () => {
      const { data, error } = await db.rpc("ap_po_lines_to_invoice", { _po: poId, _except: exceptInvoice ?? null });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, unit_cost: Number(r.unit_cost), ordered: Number(r.ordered), received: Number(r.received),
        invoiced: Number(r.invoiced), remaining: Number(r.remaining) })) as POLineToInvoice[];
    },
  });
}

export function useSaveAPInvoiceWithLines() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { id?: string; header: APInvoiceHeader; lines: APLineInput[] }) => {
      const tenantId = await fetchTenantId();
      if (v.lines.length === 0) throw new Error("Au moins une ligne de facture");
      if (v.id) {
        const { data, error } = await db.from("ap_invoices").update(v.header).eq("id", v.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Refusé : droit « Saisir et modifier les factures fournisseurs » requis.");
        const del = await db.from("ap_invoice_lines").delete().eq("invoice_id", v.id);
        if (del.error) throw del.error;
        const ins = await db.from("ap_invoice_lines").insert(rows(v.id, tenantId, v.lines));
        if (ins.error) throw ins.error;
        return v.id;
      }
      const { data: inv, error } = await db.from("ap_invoices").insert({
        ...v.header, tenant_id: tenantId, created_by: user!.id, status: "draft", approval_status: "draft", amount_paid: 0, subtotal: 0, tax_amount: 0, total: 0,
      }).select("id").single();
      if (error) throw error;
      const ins = await db.from("ap_invoice_lines").insert(rows(inv.id, tenantId, v.lines));
      if (ins.error) {
        await db.from("ap_invoices").delete().eq("id", inv.id);
        throw ins.error;
      }
      return inv.id as string;
    },
    onSuccess: (_d, v) => {
      for (const k of ["ap-invoices", "ap-invoice-lines", "ap-po-lines-to-invoice"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(v.id ? "Facture fournisseur modifiée" : "Facture fournisseur créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
