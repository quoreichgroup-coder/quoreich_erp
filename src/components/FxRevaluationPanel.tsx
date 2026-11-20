import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { cn } from "@/lib/utils";

/*
 * Réévaluation de clôture des créances et dettes en devise (V128) : aperçu au cours de clôture, écriture (478 / 479 sur
 * les comptes de tiers) contre-passée le lendemain, provision des pertes latentes (697 / 194) avec reprise de la
 * précédente (194 / 797). Droit currency.revaluation.
 */
const db = supabase as any;
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

interface Item { kind: "ar" | "ap"; invoice_id: string; invoice_number: string; party_name: string; currency: string; invoice_rate: number;
  fx_outstanding: number; book_value: number; closing_rate: number | null; closing_value: number | null; difference: number | null }
interface Run { id: string; revaluation_date: string; reason: string; gains: number; losses: number; provision_amount: number }

export function FxRevaluationPanel() {
  const { data: tenantId } = useTenantId();
  const qc = useQueryClient();
  const access = useMyAccess();
  const canPost = access.data?.permissions.includes("currency.revaluation") ?? false;
  const [date, setDate] = useState(`${new Date().getFullYear() - 1}-12-31`);
  const [reason, setReason] = useState("Clôture de l'exercice");
  const items = useQuery({
    queryKey: ["fx-revaluation-items", tenantId, date],
    enabled: Boolean(tenantId && date),
    retry: false,
    queryFn: async (): Promise<Item[]> => {
      if (isApiEnabled()) return apiGet<Item[]>(`/api/v1/fx-revaluation/items?date=${date}`);
      const { data, error } = await db.rpc("fx_revaluation_items", { _date: date });
      if (error) throw error;
      return data ?? [];
    },
  });
  const runs = useQuery({
    queryKey: ["fx-revaluation-runs", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<Run[]> => {
      if (isApiEnabled()) return apiGet<Run[]>("/api/v1/fx-revaluation/runs");
      const { data, error } = await db.from("fx_revaluation_runs").select("id, revaluation_date, reason, gains, losses, provision_amount").order("revaluation_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const post = useMutation({
    mutationFn: async () => {
      if (isApiEnabled()) { await apiPost("/api/v1/fx-revaluation/runs", { date, reason }); return; }
      const { error } = await db.rpc("post_fx_revaluation", { _date: date, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of ["fx-revaluation-runs", "fx-revaluation-items", "journal-entries"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success("Réévaluation enregistrée (contre-passée à l'ouverture)");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = items.data ?? [];
  const gains = rows.reduce((t, r) => t + Math.max(Number(r.difference ?? 0), 0), 0);
  const losses = rows.reduce((t, r) => t + Math.max(-Number(r.difference ?? 0), 0), 0);
  const missing = [...new Set(rows.filter((r) => r.closing_rate == null).map((r) => r.currency))];
  const done = (runs.data ?? []).some((r) => r.revaluation_date === date);

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="fx-revaluation">
      <div>
        <h3 className="text-sm font-semibold">Réévaluation de clôture des créances et dettes en devise</h3>
        <p className="text-xs text-muted-foreground">Au cours de clôture : perte latente en 478 (provisionnée en 194 / 697), gain latent en 479 sans produit ;
          l'écriture est contre-passée le lendemain, les factures gardent leur valeur d'origine. La provision précédente est reprise (797).</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs" htmlFor="fx-rev-date">Date de clôture</Label>
          <Input id="fx-rev-date" type="date" className="h-8 text-xs w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1 flex-1 min-w-[200px]"><Label className="text-xs" htmlFor="fx-rev-reason">Motif</Label>
          <Input id="fx-rev-reason" className="h-8 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {canPost && <Button size="sm" className="h-8 text-xs" data-testid="fx-revaluation-post"
          disabled={post.isPending || done || missing.length > 0 || !reason.trim() || rows.length === 0} onClick={() => post.mutate()}>
          {post.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Réévaluer au {new Date(date).toLocaleDateString("fr-FR")}</Button>}
      </div>
      {missing.length > 0 && <p className="text-xs text-destructive" role="alert">Cours de clôture manquant pour : {missing.join(", ")}.</p>}
      {done && <p className="text-xs text-muted-foreground">Une réévaluation existe déjà à cette date.</p>}
      {items.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : items.error ? <p className="text-xs text-destructive">{(items.error as Error).message}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="fx-revaluation-items">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">Pièce</th><th className="text-left">Tiers</th><th className="text-right">Reste dû</th>
              <th className="text-right">Cours d'origine</th><th className="text-right">Cours de clôture</th><th className="text-right">Valeur comptable</th>
              <th className="text-right">Valeur à la clôture</th><th className="text-right pr-2">Écart</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="p-3 text-muted-foreground">Aucune créance ni dette en devise ouverte à cette date.</td></tr>}
              {rows.map((r) => (
                <tr key={r.invoice_id} className="border-t border-border/50">
                  <td className="p-2">{r.kind === "ar" ? "Client" : "Fournisseur"} · {r.invoice_number}</td><td>{r.party_name}</td>
                  <td className="text-right tabular-nums">{fmt(r.fx_outstanding)} {r.currency}</td>
                  <td className="text-right tabular-nums">{fmt(r.invoice_rate)}</td><td className="text-right tabular-nums">{r.closing_rate == null ? "—" : fmt(r.closing_rate)}</td>
                  <td className="text-right tabular-nums">{fmt(r.book_value)}</td><td className="text-right tabular-nums">{r.closing_value == null ? "—" : fmt(r.closing_value)}</td>
                  <td className={cn("text-right pr-2 tabular-nums", Number(r.difference) < 0 && "text-destructive")}>{r.difference == null ? "—" : fmt(r.difference)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="border-t-2 border-border font-medium"><td className="p-2" colSpan={7}>Gains latents (479) / pertes latentes (478, provisionnées)</td>
              <td className="text-right pr-2 tabular-nums" data-testid="fx-revaluation-totals">{fmt(gains)} / {fmt(losses)}</td></tr></tfoot>}
          </table>
        </div>
      )}
      {(runs.data ?? []).length > 0 && (
        <div className="text-xs">
          <p className="font-medium mb-1">Réévaluations enregistrées</p>
          <ul className="space-y-0.5">{(runs.data ?? []).map((r) => (
            <li key={r.id} data-testid="fx-revaluation-run">{new Date(r.revaluation_date).toLocaleDateString("fr-FR")} — {r.reason} : gains {fmt(r.gains)}, pertes {fmt(r.losses)}, provision {fmt(r.provision_amount)} XOF</li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}
