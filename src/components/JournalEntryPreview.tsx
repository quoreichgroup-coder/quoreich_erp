import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isApiEnabled } from "@/api/client";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Écriture comptable d'une pièce (comptes, débit, crédit), affichée dans son panneau de détail :
 * la preuve que la pièce est comptabilisée. Sur site, l'API n'expose pas encore le grand livre
 * (Lot 3) : le panneau l'indique au lieu d'interroger une autre base.
 */
export function JournalEntryPreview({ entryId }: { entryId: string | null | undefined }) {
  const api = isApiEnabled();
  const { data, isLoading, error } = useQuery({
    queryKey: ["journal-entry-preview", entryId],
    enabled: !!entryId && !api,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("journal_entries")
        .select("entry_number, entry_date, status, lines:journal_lines(debit, credit, description, account:gl_accounts(code, name))")
        .eq("id", entryId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  let body;
  if (api) body = <p className="text-xs text-muted-foreground">Consultation de l'écriture sur site : avec le grand livre de l'API (Lot 3).</p>;
  else if (!entryId) body = <p className="text-xs text-destructive">Aucune écriture comptable rattachée à cette pièce.</p>;
  else if (isLoading) body = <p className="text-xs text-muted-foreground">Chargement…</p>;
  else if (error || !data) body = <p className="text-xs text-destructive">Écriture illisible.</p>;
  else {
    const lines = (data.lines ?? []) as any[];
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0), credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    body = (
      <table className="w-full text-xs" data-testid="journal-entry-preview">
        <caption className="text-left text-muted-foreground pb-1">{data.entry_number} · {data.entry_date} · {data.status}</caption>
        <thead className="text-muted-foreground"><tr><th className="text-left p-1">Compte</th><th className="text-right p-1">Débit</th><th className="text-right p-1">Crédit</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-1">{l.account?.code} {l.account?.name}</td>
              <td className="p-1 text-right tabular-nums">{Number(l.debit) ? fmt(Number(l.debit)) : ""}</td>
              <td className="p-1 text-right tabular-nums">{Number(l.credit) ? fmt(Number(l.credit)) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="font-medium"><tr className="border-t border-border">
          <td className="p-1">Total</td><td className="p-1 text-right tabular-nums">{fmt(debit)}</td><td className="p-1 text-right tabular-nums">{fmt(credit)}</td>
        </tr></tfoot>
      </table>
    );
  }
  return (
    <section aria-label="Écriture comptable" className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Écriture comptable</p>
      {body}
    </section>
  );
}
