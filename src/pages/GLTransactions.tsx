import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Download, FileText, Loader2, RefreshCcw, RotateCcw, Search } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { isApiEnabled } from "@/api/client";
import { exportToCSV } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

/*
 * Grand livre → Transactions : les écritures RÉELLES, telles que comptabilisées (V38 : journal,
 * numéro de pièce, lot). Trois vues : écritures des livres auxiliaires (ventes, achats, banque,
 * paie, stock…), écritures manuelles, contre-passations. Clic sur une écriture : ses lignes
 * (compte, libellé, débit, crédit), à exporter ou imprimer. Remplace trois tableaux de démonstration.
 */

type Line = { debit: number; credit: number; description: string | null; account: { code: string; name: string } | null };
type Entry = {
  id: string; entry_number: string; piece_number: string | null; journal_code: string | null; entry_date: string;
  description: string | null; source: string; status: string; batch: { batch_number: string } | null; lines: Line[];
};

const ORIGINES: Record<string, string> = {
  ar_invoice: "Facture client", ar_credit_note: "Avoir client", ar_receipt: "Encaissement client",
  ap_invoice: "Facture fournisseur", ap_payment: "Paiement fournisseur", stock_movement: "Mouvement de stock",
  payroll: "Paie", treasury: "Trésorerie", manual: "Saisie manuelle", reversal: "Contre-passation",
};
const JOURNAUX: Record<string, string> = { VT: "Ventes", AC: "Achats", BQ: "Banque", PA: "Paie", OD: "Opérations diverses" };
const STATUTS: Record<string, string> = { posted: "Comptabilisée", draft: "Brouillon", reversed: "Contre-passée", cancelled: "Annulée" };

const tabs = [
  { id: "auto", label: "Livres auxiliaires", icon: RefreshCcw },
  { id: "manual", label: "Écritures manuelles", icon: FileText },
  { id: "reversal", label: "Contre-passations", icon: RotateCcw },
] as const;

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const sum = (e: Entry, k: "debit" | "credit") => e.lines.reduce((s, l) => s + Number(l[k]), 0);

function useGLEntries() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["gl-transactions", tenantId],
    enabled: !!tenantId && !isApiEnabled(),
    queryFn: async () => {
      const all: Entry[] = [];
      // Toutes les pages : aucune écriture tronquée (la liste sert aussi à l'export).
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as any).from("journal_entries")
          .select("id, entry_number, piece_number, journal_code, entry_date, description, source, status,"
            + " batch:journal_batches(batch_number), lines:journal_lines(debit, credit, description, account:gl_accounts(code, name))")
          .eq("tenant_id", tenantId)
          .order("entry_date", { ascending: false }).order("piece_number", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
}

function EntryDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  if (!entry) return null;
  const title = `Écriture ${entry.piece_number ?? entry.entry_number}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <DocumentDetail
          title={title} fileName={documentFileName(title)}
          header={[
            ["Journal", entry.journal_code ? `${entry.journal_code} — ${JOURNAUX[entry.journal_code] ?? ""}` : "—"],
            ["Date", entry.entry_date], ["Origine", ORIGINES[entry.source] ?? entry.source],
            ["Statut", STATUTS[entry.status] ?? entry.status], ["Lot", entry.batch?.batch_number ?? "—"],
            ["Libellé", entry.description ?? "—"],
          ]}
          columns={[{ label: "Compte" }, { label: "Intitulé" }, { label: "Libellé" }, { label: "Débit", align: "right" }, { label: "Crédit", align: "right" }]}
          rows={entry.lines.map((l) => [l.account?.code ?? "—", l.account?.name ?? "", l.description ?? "",
            Number(l.debit) ? fmt(Number(l.debit)) : "", Number(l.credit) ? fmt(Number(l.credit)) : ""])}
          footer={[["Total débit", fmt(sum(entry, "debit"))], ["Total crédit", fmt(sum(entry, "credit"))],
            ["Écart", fmt(sum(entry, "debit") - sum(entry, "credit")), true]]}
        />
      </DialogContent>
    </Dialog>
  );
}

export default function GLTransactions() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("auto");
  const [search, setSearch] = useState("");
  const [journal, setJournal] = useState("");
  const [period, setPeriod] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const { data: entries = [], isLoading, error } = useGLEntries();

  const inTab = (e: Entry) => activeTab === "manual" ? e.source === "manual"
    : activeTab === "reversal" ? e.source === "reversal" : !["manual", "reversal"].includes(e.source);
  const rows = useMemo(() => entries.filter((e) => inTab(e)
    && (!journal || e.journal_code === journal)
    && (!period || e.entry_date.startsWith(period))
    && (!search || `${e.piece_number ?? ""} ${e.entry_number} ${e.description ?? ""} ${ORIGINES[e.source] ?? ""}`.toLowerCase().includes(search.toLowerCase()))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [entries, activeTab, journal, period, search]);
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t.id, entries.filter((e) =>
    t.id === "manual" ? e.source === "manual" : t.id === "reversal" ? e.source === "reversal" : !["manual", "reversal"].includes(e.source)).length])), [entries]);

  const exporter = () => exportToCSV(rows.map((e) => ({
    piece: e.piece_number ?? e.entry_number, date: e.entry_date, journal: e.journal_code ?? "", origine: ORIGINES[e.source] ?? e.source,
    libelle: e.description ?? "", debit: sum(e, "debit"), credit: sum(e, "credit"), statut: STATUTS[e.status] ?? e.status, lot: e.batch?.batch_number ?? "",
  })), [{ key: "piece", header: "N° pièce" }, { key: "date", header: "Date" }, { key: "journal", header: "Journal" },
    { key: "origine", header: "Origine" }, { key: "libelle", header: "Libellé" }, { key: "debit", header: "Débit" },
    { key: "credit", header: "Crédit" }, { key: "statut", header: "Statut" }, { key: "lot", header: "Lot" }], "ecritures-grand-livre");

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance" }, { label: "Grand livre", href: "/journal" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Transactions du grand livre"
        description="Écritures comptabilisées depuis les livres auxiliaires (ventes, achats, banque, paie, stock), écritures manuelles et contre-passations, avec leur journal, leur numéro de pièce et leur lot. Cliquez une écriture pour voir ses lignes." />

      {isApiEnabled() ? (
        <p className="text-sm text-muted-foreground mt-4">Sur site, la consultation du grand livre par l'API arrive avec le Lot 3 (tranche GL).</p>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border mt-4">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
                  activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.icon className="w-3.5 h-3.5" />{t.label} <span className="text-muted-foreground">({counts[t.id] ?? 0})</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
              <Input aria-label="Rechercher une écriture" className="h-8 pl-7 text-xs w-64" placeholder="Pièce, libellé, origine…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select aria-label="Journal" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={journal} onChange={(e) => setJournal(e.target.value)}>
              <option value="">Tous les journaux</option>
              {Object.entries(JOURNAUX).map(([c, l]) => <option key={c} value={c}>{c} — {l}</option>)}
            </select>
            <Input aria-label="Période" type="month" className="h-8 text-xs w-40" value={period} onChange={(e) => setPeriod(e.target.value)} />
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1 ml-auto" data-testid="btn-export-csv" onClick={exporter}>
              <Download className="w-3.5 h-3.5" /> Exporter
            </Button>
          </div>
          <div className="mt-3 rounded-md border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">N° pièce</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Journal</th>
                  <th className="p-2 text-left">Origine</th><th className="p-2 text-left">Libellé</th>
                  <th className="p-2 text-right">Débit</th><th className="p-2 text-right">Crédit</th><th className="p-2 text-left">Statut</th><th className="p-2 text-left">Lot</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
                ) : error ? (
                  <tr><td colSpan={9} className="p-6 text-center text-destructive">{(error as Error).message}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="p-6 text-center text-muted-foreground"><BookOpen className="w-4 h-4 inline mr-1" />Aucune écriture pour ces critères.</td></tr>
                ) : rows.map((e) => (
                  <tr key={e.id} data-testid="gl-entry-row" className="border-t border-border cursor-pointer hover:bg-muted/40" onClick={() => setSelected(e)}>
                    <td className="p-2 font-mono text-primary">{e.piece_number ?? e.entry_number}</td>
                    <td className="p-2 tabular-nums">{e.entry_date}</td>
                    <td className="p-2">{e.journal_code ?? "—"}</td>
                    <td className="p-2">{ORIGINES[e.source] ?? e.source}</td>
                    <td className="p-2 truncate max-w-[22rem]">{e.description}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(sum(e, "debit"))}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(sum(e, "credit"))}</td>
                    <td className="p-2"><StatusBadge status={e.status === "posted" ? "success" : e.status === "reversed" ? "warning" : "info"} label={STATUTS[e.status] ?? e.status} /></td>
                    <td className="p-2 font-mono text-muted-foreground">{e.batch?.batch_number ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Écritures récurrentes : non disponibles à ce jour (aucun modèle n'est géré par la base).</p>
        </>
      )}
      <EntryDialog entry={selected} onClose={() => setSelected(null)} />
    </PageShell>
  );
}
