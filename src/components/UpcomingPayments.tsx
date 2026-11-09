import { CalendarClock, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export function UpcomingPayments() {
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["upcoming-ap-payments"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("ap_invoices")
        .select("id, invoice_number, due_date, total, amount_paid, supplier:suppliers(name)")
        .neq("status", "paid")
        .gte("due_date", today)
        .order("due_date", { ascending: true })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-card-foreground">Paiements à venir</h3>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : invoices.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">Aucun paiement à venir</div>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <CalendarClock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-card-foreground">{(inv.supplier as any)?.name || inv.invoice_number}</p>
                  <p className="text-[11px] text-muted-foreground">{format(parseISO(inv.due_date), "d MMM yyyy", { locale: fr })}</p>
                </div>
              </div>
              <span className="text-xs font-medium text-card-foreground tabular-nums">{fmt(inv.total - inv.amount_paid)} XOF</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
