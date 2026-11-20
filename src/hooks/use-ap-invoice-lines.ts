import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { saveDocumentAnalytics, saveLineAnalytics, type LineAnalytics } from "@/hooks/use-document-analytics";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenantId } from "@/hooks/use-tenant";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, isApiEnabled } from "@/api/client";

/*
 * Factures fournisseurs à lignes (V72) : en-tête puis lignes (l'en-tête est recalculé par la base) ;
 * si les lignes sont refusées à la création, l'en-tête est supprimé pour ne pas laisser de facture vide.
 */
const db = supabase as any;

export type APLineInput = {
  description: string; quantity: number; unit_price: number; discount_pct: number; tax_code_id: string | null;
  po_line_id: string | null; expense_account_id?: string | null; analytics?: LineAnalytics;
  /** Facture en devise (V124) : prix unitaire en devise ; la base calcule la contre-valeur au cours de la facture. */
  fx_unit_price?: number | null;
};
export type APInvoiceHeader = {
  supplier_id: string; po_id: string | null; invoice_number: string; invoice_date: string; due_date: string; control_total: number | null;
  /** Devise de la facture (vide = devise de la société) et cours (vide = cours enregistré à la date de la facture). */
  currency?: string | null; exchange_rate?: number | null;
};
export type APInvoiceLine = Omit<APLineInput, "analytics"> & { id: string; line_no: number; net_amount: number; tax_amount: number; grni_cleared: number };
export type POLineToInvoice = { po_line_id: string; description: string; unit_cost: number; ordered: number; received: number; invoiced: number; remaining: number };

/** Identifiants des lignes enregistrées, dans l'ordre des numéros de ligne. */
const lineIds = (data: { id: string; line_no: number }[] | null) => [...(data ?? [])].sort((a, b) => a.line_no - b.line_no).map((r) => r.id);

const rows = (invoiceId: string, tenantId: string, lines: APLineInput[]) => lines.map((l, i) => ({
  tenant_id: tenantId, invoice_id: invoiceId, line_no: i + 1, description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price,
  discount_pct: l.discount_pct || 0, tax_code_id: l.tax_code_id || null, po_line_id: l.po_line_id || null, expense_account_id: l.expense_account_id || null,
  fx_unit_price: l.fx_unit_price ?? null,
}));

export function useAPInvoiceLines(invoiceId: string | null) {
  return useQuery({
    queryKey: ["ap-invoice-lines", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      if (isApiEnabled()) return apiGet<APInvoiceLine[]>(`/api/v1/ap/invoices/${invoiceId}/lines`);
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
      const { data, error } = isApiEnabled()
        ? { data: await apiGet<any[]>(`/api/v1/ap/purchase-orders/${poId}/lines-to-invoice${exceptInvoice ? `?except=${exceptInvoice}` : ""}`), error: null }
        : await db.rpc("ap_po_lines_to_invoice", { _po: poId, _except: exceptInvoice ?? null });
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
    mutationFn: async (v: { id?: string; header: APInvoiceHeader; lines: APLineInput[]; analytics?: Record<string, string> }) => {
      if (v.lines.length === 0) throw new Error("Au moins une ligne de facture");
      if (isApiEnabled()) {
        // Sur site : en-tête, lignes et sections en une transaction (un refus n'en laisse rien).
        const body = { header: v.header, analytics: v.analytics ?? null, lines: v.lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity,
          unit_price: l.unit_price, discount_pct: l.discount_pct || 0, tax_code_id: l.tax_code_id || null, po_line_id: l.po_line_id || null,
          expense_account_id: l.expense_account_id || null, fx_unit_price: l.fx_unit_price ?? null, analytics: l.analytics ?? null })) };
        const r = v.id ? await apiPut<{ id: string }>(`/api/v1/ap/invoices/${v.id}/with-lines`, body) : await apiPost<{ id: string }>("/api/v1/ap/invoices/with-lines", body);
        return r.id;
      }
      const tenantId = await fetchTenantId();
      if (v.id) {
        const { data, error } = await db.from("ap_invoices").update(v.header).eq("id", v.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Refusé : droit « Saisir et modifier les factures fournisseurs » requis.");
        const del = await db.from("ap_invoice_lines").delete().eq("invoice_id", v.id);
        if (del.error) throw del.error;
        const ins = await db.from("ap_invoice_lines").insert(rows(v.id, tenantId, v.lines)).select("id, line_no");
        if (ins.error) throw ins.error;
        await saveDocumentAnalytics("AP", v.id, v.analytics);
        await saveLineAnalytics("AP", lineIds(ins.data), v.lines.map((l) => l.analytics));
        return v.id;
      }
      const { data: inv, error } = await db.from("ap_invoices").insert({
        ...v.header, tenant_id: tenantId, created_by: user!.id, status: "draft", approval_status: "draft", amount_paid: 0, subtotal: 0, tax_amount: 0, total: 0,
      }).select("id").single();
      if (error) throw error;
      const ins = await db.from("ap_invoice_lines").insert(rows(inv.id, tenantId, v.lines)).select("id, line_no");
      if (ins.error) {
        await db.from("ap_invoices").delete().eq("id", inv.id);
        throw ins.error;
      }
      // Sans choix explicite, la base reprend les sections de la commande citée (V77).
      try {
        await saveDocumentAnalytics("AP", inv.id, v.analytics);
        await saveLineAnalytics("AP", lineIds(ins.data), v.lines.map((l) => l.analytics));
      } catch (e) {
        await db.from("ap_invoices").delete().eq("id", inv.id);
        throw e;
      }
      return inv.id as string;
    },
    onSuccess: (_d, v) => {
      for (const k of ["ap-invoices", "ap-invoice-lines", "ap-po-lines-to-invoice", "document-analytics"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(v.id ? "Facture fournisseur modifiée" : "Facture fournisseur créée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
