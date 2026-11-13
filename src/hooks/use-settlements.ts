import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiPost, isApiEnabled } from "@/api/client";
import type { Allocation, SettlementKind } from "@/lib/settlement";

export type SettlementInput = {
  partyId: string;
  paymentDate: string;
  paymentMethod: string;
  reference: string;
  allocations: Allocation[];
};

/**
 * Règlement d'un tiers réparti sur ses factures : record_settlement (V36), une transaction, tout
 * ou rien, tiers contrôlé en base. Sur site, l'API Java n'expose encore que l'encaissement
 * facture par facture (Lot 2) : les imputations y partent une à une, et un refus en cours de
 * route est signalé avec ce qui a déjà été enregistré.
 */
export function useRecordSettlement(kind: SettlementKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: SettlementInput) => {
      if (kind === "ar" && isApiEnabled()) {
        let faites = 0;
        for (const a of s.allocations) {
          try {
            await apiPost(`/api/v1/ar/invoices/${a.invoice_id}/payments`, {
              amount: a.amount, paymentDate: s.paymentDate, paymentMethod: s.paymentMethod, reference: s.reference,
            });
            faites += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(faites ? `${faites} imputation(s) enregistrée(s), puis refus : ${msg}` : msg);
          }
        }
        return;
      }
      const { error } = await (supabase as any).rpc("record_settlement", {
        _kind: kind,
        _party_id: s.partyId,
        _payment_date: s.paymentDate,
        _payment_method: s.paymentMethod,
        _reference: s.reference,
        _allocations: s.allocations,
      });
      if (error) throw error;
    },
    onSuccess: (_d, s) => {
      qc.invalidateQueries({ queryKey: [kind === "ar" ? "ar-invoices" : "ap-invoices"] });
      qc.invalidateQueries({ queryKey: [kind === "ar" ? "ar-payments" : "ap-payments"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast.success(`${kind === "ar" ? "Encaissement" : "Paiement"} enregistré sur ${s.allocations.length} facture(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
