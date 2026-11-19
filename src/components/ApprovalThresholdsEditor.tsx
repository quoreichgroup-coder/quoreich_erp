import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { apiDelete, apiGet, apiPost, apiPut, isApiEnabled } from "@/api/client";

/*
 * Seuils d'approbation (V39 achats, V41 fournisseurs ; écriture protégée par V108) : un niveau par ligne,
 * plafond (vide = dernier niveau, sans plafond), approbateur, délai cible. La soumission d'une pièce
 * construit sa file à partir de ces lignes, du plus petit plafond au plus grand, jusqu'au niveau qui
 * couvre le montant. Les droits d'approuver chaque niveau sont ceux du catalogue (approve_l1…l4).
 */
type Kind = "procurement" | "ap" | "expense";
const CONF: Record<Kind, { table: string; right: string; docTypes: string[] }> = {
  procurement: { table: "procurement_approval_thresholds", right: "procurement.settings", docTypes: ["PR", "PO"] },
  ap: { table: "ap_approval_thresholds", right: "ap.settings", docTypes: ["Factures"] },
  expense: { table: "expense_approval_thresholds", right: "expenses.settings", docTypes: ["Notes"] },
};
const DOC_LABEL: Record<string, string> = { PR: "Demandes d'achat", PO: "Commandes", Factures: "Factures fournisseurs", Notes: "Notes de frais" };
const db = supabase as any;
const fmt = (n: number) => n.toLocaleString("fr-FR");

interface Row { id: string; doc_type?: string; doc_types?: string; level: string; max_amount: number | null; approver: string; sla_hours: number }

export function ApprovalThresholdsEditor({ kind }: { kind: Kind }) {
  const c = CONF[kind];
  const { data: tenantId } = useTenantId();
  const { data: access } = useMyAccess();
  const can = (access?.permissions ?? []).includes(c.right);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["approval-thresholds", kind, tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<Row[]> => {
      if (isApiEnabled()) return apiGet<Row[]>(`/api/v1/approval-thresholds/${kind}`);
      const { data, error } = await db.from(c.table).select("*").eq("tenant_id", tenantId).order("max_amount", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["approval-thresholds", kind] });
  const save = useMutation({
    mutationFn: async (r: Partial<Row> & { id?: string }) => {
      const row: Record<string, unknown> = { level: r.level?.trim(), approver: r.approver?.trim(), max_amount: r.max_amount, sla_hours: r.sla_hours };
      if (kind === "procurement") row.doc_type = r.doc_type; else if (kind === "ap") row.doc_types = "factures";
      if (isApiEnabled()) { await (r.id ? apiPut(`/api/v1/approval-thresholds/${kind}/${r.id}`, row) : apiPost(`/api/v1/approval-thresholds/${kind}`, row)); return; }
      const tenant_id = await fetchTenantId();
      const { data, error } = r.id
        ? await db.from(c.table).update(row).eq("id", r.id).select("id")
        : await db.from(c.table).insert({ ...row, tenant_id }).select("id");
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ce niveau existe déjà pour ce type de pièce." : error.message);
      if (!data?.length) throw new Error(`Droit « ${c.right} » requis.`);
    },
    onSuccess: () => { invalidate(); toast.success("Seuil enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isApiEnabled()) { await apiDelete(`/api/v1/approval-thresholds/${kind}/${id}`); return; }
      const { data, error } = await db.from(c.table).delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(`Droit « ${c.right} » requis.`);
    },
    onSuccess: () => { invalidate(); toast.success("Seuil supprimé"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [n, setN] = useState({ doc_type: c.docTypes[0], level: "", max: "", approver: "", sla: "24" });
  const ids = { level: useId(), max: useId(), approver: useId(), sla: useId(), type: useId() };
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "").replace(",", ".")));

  if (q.isLoading) return <div className="p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  if (q.isError) return <p className="text-xs text-destructive" role="alert">{(q.error as Error).message}</p>;
  const rows = q.data ?? [];
  const groups = kind === "procurement" ? c.docTypes : [c.docTypes[0]];
  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-4 max-w-4xl" data-testid={`approval-thresholds-${kind}`}>
      <div>
        <h3 className="text-sm font-semibold">Seuils d'approbation</h3>
        <p className="text-xs text-muted-foreground">À la soumission, la pièce parcourt les niveaux du plus petit plafond au plus grand, jusqu'à celui qui couvre son montant (plafond vide = dernier niveau). Sans aucun seuil, un seul niveau L1 s'applique.
          Qui peut approuver un niveau : droits du catalogue « approve_l1 » à « approve_l{kind === "ap" ? 4 : 3} »{kind === "expense" ? " ; l'auteur d'une note ne l'approuve jamais" : ""}.</p>
      </div>
      {groups.map((g) => {
        const list = rows.filter((r) => (kind === "procurement" ? r.doc_type === g : true));
        return (
          <div key={g} className="space-y-1">
            <h4 className="text-xs font-medium">{DOC_LABEL[g]}</h4>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left py-1">Niveau</th><th className="text-right">Plafond</th><th className="text-left pl-3">Approbateur</th><th className="text-right">Délai cible (h)</th><th /></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={5} className="py-2 text-muted-foreground">Aucun seuil : un seul niveau L1.</td></tr>}
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-border/50" data-testid="approval-threshold-row">
                    <td className="py-1.5">{r.level}</td><td className="text-right tabular-nums">{r.max_amount == null ? "Sans plafond" : fmt(Number(r.max_amount))}</td>
                    <td className="pl-3">{r.approver}</td><td className="text-right tabular-nums">{r.sla_hours}</td>
                    <td className="text-right">{can && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Supprimer le niveau ${r.level}`} disabled={remove.isPending}
                      onClick={() => { if (window.confirm(`Supprimer le niveau ${r.level} ?`)) remove.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {can ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          {kind === "procurement" && (
            <div className="space-y-1"><label htmlFor={ids.type} className="text-[11px] text-muted-foreground">Type de pièce</label>
              <select id={ids.type} className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={n.doc_type} onChange={(e) => setN({ ...n, doc_type: e.target.value })}>
                {c.docTypes.map((d) => <option key={d} value={d}>{DOC_LABEL[d]}</option>)}</select></div>
          )}
          <div className="space-y-1"><label htmlFor={ids.level} className="text-[11px] text-muted-foreground">Niveau</label>
            <Input id={ids.level} className="h-8 w-40 text-xs" placeholder="L1 — Responsable" value={n.level} onChange={(e) => setN({ ...n, level: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor={ids.max} className="text-[11px] text-muted-foreground">Plafond (vide = sans)</label>
            <Input id={ids.max} inputMode="decimal" className="h-8 w-32 text-xs text-right" value={n.max} onChange={(e) => setN({ ...n, max: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor={ids.approver} className="text-[11px] text-muted-foreground">Approbateur</label>
            <Input id={ids.approver} className="h-8 w-44 text-xs" placeholder="Directeur financier" value={n.approver} onChange={(e) => setN({ ...n, approver: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor={ids.sla} className="text-[11px] text-muted-foreground">Délai cible (h)</label>
            <Input id={ids.sla} type="number" min={1} className="h-8 w-20 text-xs" value={n.sla} onChange={(e) => setN({ ...n, sla: e.target.value })} /></div>
          <Button size="sm" className="h-8 text-xs gap-1" disabled={!n.level.trim() || !n.approver.trim() || Number(n.sla) < 1 || save.isPending}
            onClick={() => save.mutate({ doc_type: n.doc_type, level: n.level, approver: n.approver, max_amount: num(n.max), sla_hours: Number(n.sla) },
              { onSuccess: () => setN({ ...n, level: "", max: "", approver: "" }) })}><Plus className="w-3.5 h-3.5" /> Ajouter le niveau</Button>
        </div>
      ) : <p className="text-[11px] text-muted-foreground">Modification réservée au droit « {c.right} ».</p>}
    </section>
  );
}
