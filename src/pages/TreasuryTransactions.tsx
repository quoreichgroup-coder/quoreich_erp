import { useMemo, useState } from "react";
import { BookOpen, Loader2, Search } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import { useMyTreasuryRoles } from "@/hooks/use-treasury-data";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useRecordTreasuryMovement, useTransferTreasury, useTreasuryAccounts, useTreasuryMovements } from "@/hooks/use-treasury-accounts";
import { canDo } from "@/lib/treasury-roles";
import { KIND_LABEL, SOURCE_LABEL } from "@/lib/treasury-accounts";

/*
 * Trésorerie → Transactions (V70) : mouvements réels de chaque compte de trésorerie — règlements,
 * acomptes, remboursements (créés par les pièces), mouvements manuels (frais, intérêts…) et virements
 * internes, chacun avec sa pièce comptable BQ. Saisie manuelle : droit treasury.create_txn.
 */
const TABS: [string, string][] = [["all", "Mouvements"], ["transfer", "Virements internes"], ["manual", "Mouvements manuels"]];
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export default function TreasuryTransactions() {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [dialog, setDialog] = useState<"movement" | "transfer" | null>(null);
  const { data: accounts = [], isPending: la } = useTreasuryAccounts();
  const { data: moves = [], isPending: lm, error } = useTreasuryMovements();
  const perms = useMyTreasuryRoles();
  const canCreate = canDo(perms, "create_txn");
  const canExport = canDo(perms, "export");
  const canSensitive = canDo(perms, "view_sensitive");
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const shown = moves.filter((m) => (tab === "all" || m.source === tab) && (!accountFilter || m.bank_account_id === accountFilter)
    && `${m.description ?? ""} ${m.reference ?? ""} ${m.journal_entry?.piece_number ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const rows = shown.map((m) => ({
    date: m.transaction_date, compte: byId.get(m.bank_account_id)?.name ?? "", origine: SOURCE_LABEL[m.source] ?? m.source, libelle: m.description ?? "",
    reference: m.reference ?? "", piece: m.journal_entry?.piece_number ?? "",
    entree: canSensitive && Number(m.amount) > 0 ? Number(m.amount) : canSensitive ? "" : "•••••",
    sortie: canSensitive && Number(m.amount) < 0 ? -Number(m.amount) : canSensitive ? "" : "•••••", rapproche: m.is_reconciled ? "oui" : "non",
  }));

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Comptabilité et finance" }, { label: "Trésorerie", href: "/treasury" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Mouvements de trésorerie" description="Chaque règlement, acompte ou remboursement passé sur un compte de trésorerie y crée son mouvement. Les frais, intérêts et virements entre vos comptes se saisissent ici ; chacun est comptabilisé au journal de banque (BQ)." />
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-56"><Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input aria-label="Rechercher un mouvement" placeholder="Libellé, référence, pièce…" className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select aria-label="Compte de trésorerie" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="">Tous les comptes</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({KIND_LABEL[a.account_type]})</option>)}
        </select>
        <div className="ml-auto flex gap-2 flex-wrap">
          <ExportButtons label="Exporter les mouvements" disabled={!canExport} rows={rows} filename={`mouvements-tresorerie-${today()}`} sheetName="Mouvements"
            columns={[{ key: "date", header: "Date", width: 12 }, { key: "compte", header: "Compte", width: 24 }, { key: "origine", header: "Origine", width: 18 },
              { key: "libelle", header: "Libellé", width: 40 }, { key: "reference", header: "Référence", width: 16 }, { key: "piece", header: "Pièce", width: 16 },
              { key: "entree", header: "Entrée", width: 14 }, { key: "sortie", header: "Sortie", width: 14 }, { key: "rapproche", header: "Rapproché", width: 10 }]} />
          {canCreate && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={accounts.length === 0} onClick={() => setDialog("movement")}>Mouvement de trésorerie</Button>}
          {canCreate && <Button size="sm" className="h-8 text-xs" disabled={accounts.filter((a) => a.is_active).length < 2} onClick={() => setDialog("transfer")}>Virement entre comptes</Button>}
        </div>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}

      {la || lm ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="card-elevated overflow-x-auto">
          <table className="w-full text-xs" data-testid="treasury-movements">
            <thead><tr className="bg-muted/30 text-muted-foreground">
              <th className="text-left p-2">Date</th><th className="text-left">Compte</th><th className="text-left">Origine</th><th className="text-left">Libellé</th>
              <th className="text-left">Référence</th><th className="text-left">Pièce</th>
              {canSensitive && <><th className="text-right">Entrée</th><th className="text-right">Sortie</th></>}<th className="text-left pl-3">Rapproché</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucun mouvement{accounts.length === 0 ? " : créez d'abord vos comptes de trésorerie (Données de base)" : ""}.</td></tr>}
              {shown.map((m) => (
                <tr key={m.id} data-testid="treasury-movement-row" className="border-t border-border/50">
                  <td className="p-2 whitespace-nowrap">{new Date(m.transaction_date).toLocaleDateString("fr-FR")}</td>
                  <td>{byId.get(m.bank_account_id)?.name ?? "—"}</td><td>{SOURCE_LABEL[m.source] ?? m.source}</td><td>{m.description}</td>
                  <td className="font-mono">{m.reference ?? ""}</td><td className="font-mono">{m.journal_entry?.piece_number ?? ""}</td>
                  {canSensitive && <><td className="text-right tabular-nums text-success">{Number(m.amount) > 0 ? fmt(m.amount) : ""}</td>
                    <td className="text-right tabular-nums text-destructive">{Number(m.amount) < 0 ? fmt(-m.amount) : ""}</td></>}
                  <td className="pl-3">{m.is_reconciled ? <StatusBadge status="success" label="Rapproché" /> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">Comptabilisation — trésorerie</h2></div>
        <GLPostingKPIsLive module="Treasury" />
        <GLBatchHistoryLive module="Treasury" />
      </div>
      {dialog === "movement" && <MovementDialog onClose={() => setDialog(null)} />}
      {dialog === "transfer" && <TransferDialog onClose={() => setDialog(null)} />}
    </PageShell>
  );
}

function MovementDialog({ onClose }: { onClose: () => void }) {
  const { data: accounts = [] } = useTreasuryAccounts();
  const { data: gl = [] } = useGLAccounts();
  const record = useRecordTreasuryMovement();
  const active = accounts.filter((a) => a.is_active);
  const treasuryGl = new Set(accounts.map((a) => a.gl_account_id));
  const counters = (gl as any[]).filter((g) => g.is_active && !g.is_header && !treasuryGl.has(g.id));
  const [f, setF] = useState({ account: active.find((a) => a.is_default)?.id ?? active[0]?.id ?? "", direction: "out", amount: "", counter: "", date: today(), description: "", reference: "" });
  const n = Number(f.amount);
  const ok = f.account && f.counter && n > 0 && f.description.trim();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">Mouvement de trésorerie</DialogTitle>
          <DialogDescription className="text-xs">Frais et agios, intérêts, apport… Comptabilisé au journal de banque entre le compte de trésorerie et la contrepartie choisie (ex. 631 frais bancaires).</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="mv-account">Compte de trésorerie</Label>
            <select id="mv-account" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
              {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({KIND_LABEL[a.account_type]})</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="mv-direction">Sens</Label>
            <select id="mv-direction" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="out">Sortie</option><option value="in">Entrée</option>
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="mv-amount">Montant</Label>
            <Input id="mv-amount" type="number" step="0.01" min="0" className="h-8 text-xs" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="mv-counter">Contrepartie</Label>
            <select id="mv-counter" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.counter} onChange={(e) => setF({ ...f, counter: e.target.value })}>
              <option value="">— compte général —</option>
              {counters.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="mv-date">Date</Label>
            <Input id="mv-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="mv-ref">Référence</Label>
            <Input id="mv-ref" className="h-8 text-xs" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label className="text-xs" htmlFor="mv-label">Libellé</Label>
            <Input id="mv-label" className="h-8 text-xs" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!ok || record.isPending} onClick={() => record.mutate({ account: f.account, date: f.date, amount: f.direction === "out" ? -n : n, counter: f.counter,
            description: f.description.trim(), reference: f.reference }, { onSuccess: onClose })}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ onClose }: { onClose: () => void }) {
  const { data: accounts = [] } = useTreasuryAccounts();
  const transfer = useTransferTreasury();
  const active = accounts.filter((a) => a.is_active);
  const [f, setF] = useState({ from: active[0]?.id ?? "", to: active[1]?.id ?? "", amount: "", date: today(), description: "", reference: "" });
  const a = active.find((x) => x.id === f.from), b = active.find((x) => x.id === f.to);
  const err = !a || !b ? "Choisir deux comptes." : a.id === b.id ? "Choisir deux comptes différents." : a.currency !== b.currency ? "Devises différentes : opération de change non prise en charge." : null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">Virement entre comptes</DialogTitle>
          <DialogDescription className="text-xs">Banque → caisse, alimentation d'un compte mobile money… Une écriture BQ et un mouvement sur chacun des deux comptes.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-from">Compte débité</Label>
            <select id="tr-from" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
              {active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-to">Compte crédité</Label>
            <select id="tr-to" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
              {active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-amount">Montant</Label>
            <Input id="tr-amount" type="number" step="0.01" min="0" className="h-8 text-xs" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-date">Date</Label>
            <Input id="tr-date" type="date" className="h-8 text-xs" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-ref">Référence</Label>
            <Input id="tr-ref" className="h-8 text-xs" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="tr-label">Libellé</Label>
            <Input id="tr-label" className="h-8 text-xs" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!!err || !(Number(f.amount) > 0) || transfer.isPending} onClick={() => transfer.mutate({ from: f.from, to: f.to, date: f.date, amount: Number(f.amount),
            description: f.description, reference: f.reference }, { onSuccess: onClose })}>Enregistrer le virement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
