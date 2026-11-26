import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";

type Candidate = {
  invoice_id: string; invoice_number: string; customer_name: string; recipient: string; due_date: string;
  balance: number; currency: string; days_overdue: number; rule_id: string; rule_level: number; action: string;
  subject: string; message: string;
};
type Event = Candidate & { id: string; status: "pending" | "sending" | "sent" | "uncertain" | "failed"; created_at: string; sent_at: string | null; error_detail: string | null };

async function cloudDunning<T>(action: string, extra: Record<string, string> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("ar-dunning", { body: { action, ...extra } });
  if (error) throw new Error(error.message || "Le service de relance est indisponible.");
  if (data == null) throw new Error("Le service de relance n'a retourné aucune donnée.");
  return data;
}

export function ARDunningPanel() {
  const { data: tenantId } = useTenantId();
  const qc = useQueryClient();
  const enabled = Boolean(tenantId);
  const cloud = !isApiEnabled();
  const candidates = useQuery({
    queryKey: ["ar-dunning-candidates", tenantId], enabled, retry: false,
    queryFn: () => cloud ? cloudDunning<Candidate[]>("candidates") : apiGet<Candidate[]>("/api/v1/ar/dunning/candidates"),
  });
  const history = useQuery({
    queryKey: ["ar-dunning-history", tenantId], enabled, retry: false,
    queryFn: () => cloud ? cloudDunning<Event[]>("history") : apiGet<Event[]>("/api/v1/ar/dunning/history"),
  });
  const delivery = useQuery({
    queryKey: ["ar-dunning-smtp", tenantId], enabled, retry: false,
    queryFn: () => cloud ? cloudDunning<{ configured: boolean }>("status") : apiGet<{ configured: boolean }>("/api/v1/ar/dunning/status"),
  });
  const send = useMutation({
    mutationFn: ({ invoiceId, ruleId }: { invoiceId: string; ruleId: string }) =>
      cloud
        ? cloudDunning<Event>("send", { invoice_id: invoiceId, rule_id: ruleId })
        : apiPost<Event>(`/api/v1/ar/dunning/${invoiceId}/send`, { rule_id: ruleId }),
    onSuccess: (event) => {
      if (event.status === "sent") toast.success("Relance envoyée");
      else if (event.status === "failed") toast.error("Échec SMTP — consultez l’historique");
      else toast.warning(`Envoi ${event.status === "uncertain" ? "incertain" : "en cours"} — consultez l’historique`);
      qc.invalidateQueries({ queryKey: ["ar-dunning-candidates", tenantId] });
      qc.invalidateQueries({ queryKey: ["ar-dunning-history", tenantId] });
    },
    onError: (error: Error) => toast.error(error.message || "Envoi de la relance impossible"),
  });
  const money = (value: number, currency: string) => `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
  const probe = useMutation({
    mutationFn: () => cloud ? cloudDunning<{ ok: boolean }>("probe") : apiPost<{ ok: boolean }>("/api/v1/ar/dunning/probe", {}),
    onSuccess: (result) => toast[result.ok ? "success" : "error"](result.ok ? "Connexion SMTP vérifiée, aucun courriel envoyé" : "Connexion SMTP impossible"),
    onError: (error: Error) => toast.error(error.message || "Vérification SMTP impossible"),
  });

  return <div className="space-y-4">
    <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-4">
      <div><h2 className="text-sm font-semibold">Relances clients par courriel</h2>
        <p className="mt-1 text-xs text-muted-foreground">Aperçu des prochaines règles échues. Chaque envoi demande une confirmation et est enregistré dans l’historique.</p></div>
      <div className="flex shrink-0 gap-2">
        {delivery.data?.configured && <Button size="sm" variant="outline" className="h-8" onClick={() => probe.mutate()} disabled={probe.isPending}>
          {probe.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}Tester SMTP
        </Button>}
        <Button size="sm" variant="outline" className="h-8" onClick={() => { void candidates.refetch(); void history.refetch(); }} disabled={!enabled || candidates.isFetching}>
          {candidates.isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Actualiser
        </Button>
      </div>
    </div>
    {enabled && delivery.data?.configured === false && <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Le serveur SMTP n’est pas configuré. Aucun envoi ne sera effectué.</div>}
    {candidates.isError && <div role="alert" className="text-xs text-destructive">Impossible de charger les relances. Actualisez la liste pour réessayer.</div>}
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-xs"><thead><tr className="border-b bg-muted/30 text-left text-muted-foreground">
        {["Facture / client", "Échéance", "Retard", "Solde", "Destinataire", "Aperçu", "Action"].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
      </tr></thead><tbody>
        {candidates.isLoading ? <tr><td colSpan={7} className="p-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
          : (candidates.data ?? []).length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune relance par courriel à envoyer.</td></tr>
          : candidates.data!.map((item) => <tr key={`${item.invoice_id}-${item.rule_id}`} className="border-b last:border-0 align-top">
            <td className="px-3 py-2"><div className="font-medium">{item.invoice_number}</div><div className="text-muted-foreground">{item.customer_name} · niveau {item.rule_level}</div></td>
            <td className="px-3 py-2">{new Date(`${item.due_date}T00:00:00`).toLocaleDateString("fr-FR")}</td>
            <td className="px-3 py-2">{item.days_overdue} j</td><td className="px-3 py-2 tabular-nums">{money(item.balance, item.currency)}</td>
            <td className="px-3 py-2">{item.recipient}</td>
            <td className="px-3 py-2 min-w-64"><div className="font-medium">{item.subject}</div><p className="mt-1 max-w-sm whitespace-pre-wrap text-muted-foreground">{item.message}</p></td>
            <td className="px-3 py-2"><Button size="sm" className="h-7" disabled={!delivery.data?.configured || send.isPending} onClick={() => {
              if (window.confirm(`Envoyer la relance niveau ${item.rule_level} à ${item.recipient} pour ${item.invoice_number} ?`))
                send.mutate({ invoiceId: item.invoice_id, ruleId: item.rule_id });
            }}><Mail className="mr-1.5 h-3.5 w-3.5" />Envoyer</Button></td>
          </tr>)}
      </tbody></table>
    </div>
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="border-b p-3 text-sm font-semibold">Historique des relances</div>
      <table className="w-full text-xs"><thead><tr className="border-b bg-muted/30 text-left text-muted-foreground">{["Date", "Facture / client", "Destinataire", "Niveau", "Statut", "Détail"].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{history.isLoading ? <tr><td colSpan={6} className="p-5 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
          : (history.data ?? []).length === 0 ? <tr><td colSpan={6} className="p-5 text-center text-muted-foreground">Aucun envoi enregistré.</td></tr>
          : history.data!.map(row => <tr key={row.id} className="border-b last:border-0"><td className="px-3 py-2">{new Date(row.created_at).toLocaleString("fr-FR")}</td><td className="px-3 py-2">{row.invoice_number} · {row.customer_name}</td><td className="px-3 py-2">{row.recipient}</td><td className="px-3 py-2">{row.rule_level}</td><td className="px-3 py-2"><StatusBadge status={row.status === "sent" ? "success" : row.status === "pending" || row.status === "sending" ? "warning" : row.status === "failed" ? "error" : "warning"} label={row.status} /></td><td className="px-3 py-2 text-muted-foreground">{row.error_detail || (row.sent_at ? new Date(row.sent_at).toLocaleString("fr-FR") : "—")}</td></tr>)}
        </tbody></table>
    </div>
  </div>;
}
