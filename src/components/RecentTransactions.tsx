import { Badge } from "@/components/ui/badge";
import { useJournalEntries } from "@/hooks/use-journal-data";
import { Loader2 } from "lucide-react";

const statusStyle: Record<string, string> = {
  posted: "bg-success/10 text-success border-success/20",
  draft: "bg-muted text-muted-foreground border-border",
  reversed: "bg-accent text-accent-foreground border-border",
};

const fmt = (n: number) => n.toLocaleString("fr-FR");

export function RecentTransactions() {
  const { data: entries = [], isLoading } = useJournalEntries();

  const recent = entries.slice(0, 5);

  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-card-foreground">Dernières écritures comptables</h3>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Date</th>
                <th className="text-left py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Réf</th>
                <th className="text-left py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Description</th>
                <th className="text-right py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Débit</th>
                <th className="text-right py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Crédit</th>
                <th className="text-center py-2 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">Aucune écriture</td></tr>
              )}
              {recent.map((entry) => {
                const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
                const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
                return (
                  <tr key={entry.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums text-xs">{entry.entry_date}</td>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs font-mono">{entry.entry_number.slice(0, 20)}</td>
                    <td className="py-2.5 px-4 text-card-foreground font-medium text-xs truncate max-w-[200px]">{entry.description || entry.source}</td>
                    <td className="py-2.5 px-4 text-right text-card-foreground tabular-nums text-xs">{totalDebit ? fmt(totalDebit) : "—"}</td>
                    <td className="py-2.5 px-4 text-right text-success font-medium tabular-nums text-xs">{totalCredit ? fmt(totalCredit) : "—"}</td>
                    <td className="py-2.5 px-4 text-center">
                      <Badge variant="outline" className={`text-[10px] ${statusStyle[entry.status] ?? ""}`}>
                        {entry.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
