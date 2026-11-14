import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { exportToCSV } from "@/lib/csv-export";

/*
 * Suivi des livraisons fournisseurs (V56 ; SAP confirmations de commande et relances, Sage suivi des
 * retards) : commandes ouvertes avec leur reste à recevoir, date promise et retard ; accusé de
 * réception (référence et date confirmées par le fournisseur) et replanification motivée, journalisés.
 */
const fmt = (n: number) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split("T")[0];
const STATES: Record<string, [string, string]> = {
  late: ["error", "En retard"], unconfirmed: ["warning", "À confirmer"], on_time: ["success", "Dans les délais"], complete: ["neutral", "Soldée"],
};

function useFollowup() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["purchase-followup", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("purchase_order_followup_view").select("*")
        .eq("tenant_id", tenantId).order("promised_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function useFollowupAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { kind: "ack" | "reschedule"; poId: string; date: string; text: string }) => {
      const { error } = a.kind === "ack"
        ? await (supabase as any).rpc("acknowledge_purchase_order", { _po_id: a.poId, _supplier_reference: a.text || null, _confirmed_date: a.date })
        : await (supabase as any).rpc("reschedule_purchase_order", { _po_id: a.poId, _new_date: a.date, _reason: a.text });
      if (error) throw error;
    },
    onSuccess: (_d, a) => {
      for (const k of ["purchase-followup", "purchase-orders"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(a.kind === "ack" ? "Accusé de réception enregistré" : "Commande replanifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function PurchaseFollowupPanel() {
  const { data: rows = [], isLoading } = useFollowup();
  const { data: access } = useMyAccess();
  const roles = new Set(access?.roles ?? []);
  const canAct = ["admin", "procurement_controller", "procurement_l1", "procurement_l2", "procurement_l3"].some((r) => roles.has(r));
  const action = useFollowupAction();
  const [dlg, setDlg] = useState<{ kind: "ack" | "reschedule"; row: any } | null>(null);
  const [date, setDate] = useState(today());
  const [text, setText] = useState("");
  const [filtre, setFiltre] = useState<string>("");
  const shown = rows.filter((r) => !filtre || r.followup_state === filtre);
  const count = (s: string) => rows.filter((r) => r.followup_state === s).length;
  const open = (kind: "ack" | "reschedule", row: any) => { setDlg({ kind, row }); setText(""); setDate(row.promised_date ?? today()); };

  return (
    <section aria-label="Suivi des livraisons" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Filtrer par état">
          {[["", `Toutes (${rows.length})`], ["late", `En retard (${count("late")})`], ["unconfirmed", `À confirmer (${count("unconfirmed")})`],
            ["on_time", `Dans les délais (${count("on_time")})`]].map(([v, l]) => (
            <Button key={v} size="sm" variant={filtre === v ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFiltre(v)}>{l}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(shown.map((r) => ({
          commande: r.po_number, fournisseur: r.supplier_name, date: r.order_date, promise: r.promised_date, retard: r.days_late,
          reste: Number(r.value_remaining), etat: STATES[r.followup_state]?.[1] ?? r.followup_state, ref: r.supplier_reference ?? "",
        })), [{ key: "commande", header: "Commande" }, { key: "fournisseur", header: "Fournisseur" }, { key: "date", header: "Date de commande" },
          { key: "promise", header: "Livraison promise" }, { key: "retard", header: "Retard (j)" }, { key: "reste", header: "Reste à recevoir" },
          { key: "etat", header: "État" }, { key: "ref", header: "Réf. fournisseur" }], "suivi-livraisons-fournisseurs")}>Exporter</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/30 text-muted-foreground">
            <th className="text-left p-2">Commande</th><th className="text-left">Fournisseur</th><th className="text-left">Incoterm</th>
            <th className="text-left">Commandée le</th><th className="text-left">Livraison promise</th><th className="text-right">Retard</th>
            <th className="text-right">Reste à recevoir</th><th className="text-left pl-3">Réf. fournisseur</th><th className="text-left">État</th><th />
          </tr></thead>
          <tbody>
            {shown.length === 0 ? <tr><td colSpan={10} className="text-center text-muted-foreground py-6">{isLoading ? "Chargement…" : "Aucune commande ouverte."}</td></tr>
              : shown.map((r) => {
                const [st, lbl] = STATES[r.followup_state] ?? ["neutral", r.followup_state];
                return (
                  <tr key={r.po_id} data-testid="po-followup-row" className="border-t border-border/50">
                    <td className="p-2 font-mono">{r.po_number}</td><td>{r.supplier_name}</td><td>{r.incoterm ?? "—"}</td>
                    <td className="tabular-nums">{r.order_date}</td>
                    <td className="tabular-nums">{r.promised_date ?? "—"}{r.supplier_confirmed_date ? " (confirmée)" : ""}</td>
                    <td className="text-right tabular-nums">{r.days_late > 0 ? `${r.days_late} j` : "—"}</td>
                    <td className="text-right tabular-nums">{fmt(r.value_remaining)}</td>
                    <td className="pl-3">{r.supplier_reference ?? "—"}</td>
                    <td><StatusBadge status={st} label={lbl} /></td>
                    <td className="whitespace-nowrap">{canAct && (
                      <>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => open("ack", r)}>Accusé de réception</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => open("reschedule", r)}>Replanifier</Button>
                      </>
                    )}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {dlg && (
        <Dialog open onOpenChange={(o) => { if (!o) setDlg(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">{dlg.kind === "ack" ? "Accusé de réception" : "Replanifier"} — commande {dlg.row.po_number}</DialogTitle>
              <DialogDescription className="text-xs">
                {dlg.kind === "ack" ? "Référence et date de livraison confirmées par le fournisseur ; une commande approuvée passe « commandée »."
                  : "Nouvelle date de livraison ; le motif est conservé dans l'historique de la commande."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="fu-date">{dlg.kind === "ack" ? "Date confirmée" : "Nouvelle date"}</Label>
                <Input id="fu-date" type="date" className="h-8 text-xs" min={dlg.row.order_date} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="fu-text">{dlg.kind === "ack" ? "Référence du fournisseur" : "Motif (obligatoire)"}</Label>
                <Input id="fu-text" className="h-8 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDlg(null)}>Annuler</Button>
              <Button size="sm" disabled={!date || (dlg.kind === "reschedule" && !text.trim()) || action.isPending}
                onClick={() => action.mutate({ kind: dlg.kind, poId: dlg.row.po_id, date, text: text.trim() }, { onSuccess: () => setDlg(null) })}>
                Enregistrer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
