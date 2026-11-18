import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { DocumentPrintButtons } from "@/components/DocumentDetail";
import { useMyAccess } from "@/hooks/use-my-access";
import { useGLAccounts } from "@/hooks/use-gl-data";
import { useTreasuryAccounts, useTreasuryMovements } from "@/hooks/use-treasury-accounts";
import {
  useAutoMatch, useCancelStatement, useImportStatement, useMatchSuggestions, usePostStatementLine, usePrepareReconciliation, useReconciliationsFor,
  useSetMatch, useStatementRows, useStatements, useValidateReconciliation, type StatementRow,
} from "@/hooks/use-bank-reconciliation";
import { detectStatementColumns, missingStatementColumns, readStatementLines, statementSummary, STATEMENT_COLUMNS, type StatementMapping } from "@/lib/bank-statement";
import { readTableFile, TABLE_FILE_ACCEPT, type TableFile } from "@/lib/table-file";
import { KIND_LABEL } from "@/lib/treasury-accounts";
import { cn } from "@/lib/utils";

/*
 * Rapprochement bancaire (V71, lot T2) : import du relevé de la banque (Excel ou CSV), contrôle des
 * soldes, rapprochement automatique puis manuel, comptabilisation des lignes inconnues de l'ERP (frais,
 * agios), état de rapprochement et validation.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const d = (s: string) => new Date(s).toLocaleDateString("fr-FR");
const FIELD_LABEL: Record<keyof typeof STATEMENT_COLUMNS, string> = { date: "Date", label: "Libellé", amount: "Montant", debit: "Débit", credit: "Crédit", reference: "Référence" };

export function BankReconciliation() {
  const { data: accounts = [], isPending } = useTreasuryAccounts();
  const { data: access } = useMyAccess();
  const p = access?.permissions ?? [];
  const can = { import: p.includes("treasury.import_statement"), match: p.includes("treasury.match"), validate: p.includes("treasury.validate_recon") };
  const banks = accounts.filter((a) => a.is_active);
  const [account, setAccount] = useState("");
  const current = banks.find((a) => a.id === account) ?? banks[0];
  const [statementId, setStatementId] = useState<string | null>(null);
  const { data: statements = [] } = useStatements(current?.id ?? null);
  const statement = statements.find((s) => s.id === statementId) ?? statements[0] ?? null;
  const [importing, setImporting] = useState(false);

  if (isPending) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (banks.length === 0) return <p className="text-xs text-muted-foreground p-4">Aucun compte de trésorerie actif : créez-les dans Trésorerie → Données de base.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="rec-account">Compte</Label>
          <select id="rec-account" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={current?.id ?? ""} onChange={(e) => { setAccount(e.target.value); setStatementId(null); }}>
            {banks.map((a) => <option key={a.id} value={a.id}>{a.name} ({KIND_LABEL[a.account_type]})</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="rec-statement">Relevé</Label>
          <select id="rec-statement" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={statement?.id ?? ""} onChange={(e) => setStatementId(e.target.value)} disabled={statements.length === 0}>
            {statements.length === 0 && <option value="">Aucun relevé importé</option>}
            {statements.map((s) => <option key={s.id} value={s.id}>du {d(s.period_start)} au {d(s.period_end)} — solde final {fmt(s.closing_balance)}</option>)}
          </select></div>
        <p className="text-xs text-muted-foreground pb-1.5">Solde comptable : <span className="font-medium text-foreground tabular-nums">{fmt(current.balance)} {current.currency}</span></p>
        {can.import && <Button size="sm" className="h-8 text-xs ml-auto" onClick={() => setImporting(true)}>Importer un relevé</Button>}
      </div>
      {statement && <StatementPanel accountId={current.id} statement={statement} can={can} />}
      <ReconciliationPanel accountId={current.id} accountLabel={`${current.name ?? ""}${(current as any).account_number ? ` · ${(current as any).account_number}` : ""}`} can={can} lastStatementEnd={statements[0]?.period_end ?? null} />
      {importing && <ImportStatementDialog accountId={current.id} accountName={current.name} lastClosing={statements[0]?.closing_balance ?? null} lastEnd={statements[0]?.period_end ?? null}
        onClose={() => setImporting(false)} onDone={(id) => { setStatementId(id); setImporting(false); }} />}
    </div>
  );
}

function StatementPanel({ accountId, statement, can }: { accountId: string; statement: { id: string; period_start: string; period_end: string; opening_balance: number; closing_balance: number; file_name: string | null }; can: Record<string, boolean> }) {
  const { data: rows = [], isLoading } = useStatementRows(statement.id);
  const { data: moves = [] } = useTreasuryMovements();
  const auto = useAutoMatch();
  const cancel = useCancelStatement();
  const setMatch = useSetMatch();
  const [matching, setMatching] = useState<StatementRow | null>(null);
  const [posting, setPosting] = useState<StatementRow | null>(null);
  const byId = useMemo(() => new Map(moves.map((m) => [m.id, m])), [moves]);
  const open = rows.filter((r) => !r.matched_transaction_id).length;
  return (
    <section aria-label="Relevé" className="card-elevated p-4 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Relevé du {d(statement.period_start)} au {d(statement.period_end)}</h2>
          <p className="text-xs text-muted-foreground" data-testid="statement-summary">Solde initial {fmt(statement.opening_balance)} · solde final {fmt(statement.closing_balance)} · {rows.length} ligne(s) · {open} à rapprocher{statement.file_name ? ` · ${statement.file_name}` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButtons label="Exporter le relevé" filename={`releve-${statement.period_end}`} sheetName="Relevé"
            rows={rows.map((r) => ({ date: r.line_date, libelle: r.description ?? "", reference: r.reference ?? "", montant: Number(r.amount), rapproche: r.matched_transaction_id ? "oui" : "non",
              mouvement: r.matched_transaction_id ? byId.get(r.matched_transaction_id)?.description ?? "" : "" }))}
            columns={[{ key: "date", header: "Date", width: 12 }, { key: "libelle", header: "Libellé", width: 40 }, { key: "reference", header: "Référence", width: 16 },
              { key: "montant", header: "Montant", width: 14 }, { key: "rapproche", header: "Rapproché", width: 10 }, { key: "mouvement", header: "Mouvement de l'ERP", width: 40 }]} />
          {can.match && open > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={auto.isPending} onClick={() => auto.mutate(statement.id)}>Rapprocher automatiquement</Button>}
          {can.import && open === rows.length && <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={cancel.isPending} onClick={() => cancel.mutate(statement.id)}>Annuler le relevé</Button>}
        </div>
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="overflow-x-auto max-h-[26rem] overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs" data-testid="statement-lines">
            <thead className="sticky top-0 bg-card"><tr className="text-muted-foreground border-b border-border">
              <th className="text-left p-2">Date</th><th className="text-left">Libellé de la banque</th><th className="text-left">Référence</th><th className="text-right">Montant</th>
              <th className="text-left pl-3">Mouvement de l'ERP</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const m = r.matched_transaction_id ? byId.get(r.matched_transaction_id) : null;
                return (
                  <tr key={r.id} data-testid="statement-line" className={cn("border-b border-border/50", !r.matched_transaction_id && "bg-warning/5")}>
                    <td className="p-2 whitespace-nowrap">{d(r.line_date)}</td><td>{r.description}</td><td className="font-mono">{r.reference ?? ""}</td>
                    <td className={cn("text-right tabular-nums", Number(r.amount) < 0 && "text-destructive")}>{fmt(r.amount)}</td>
                    <td className="pl-3">{r.matched_transaction_id ? <><StatusBadge status="success" label="Rapprochée" /> <span className="text-muted-foreground">{m?.description ?? ""} {m?.journal_entry?.piece_number ? `· ${m.journal_entry.piece_number}` : ""}</span></>
                      : <StatusBadge status="warning" label="À rapprocher" />}</td>
                    <td className="pr-2 text-right whitespace-nowrap">
                      {can.match && !r.matched_transaction_id && <>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setMatching(r)}>Rapprocher</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setPosting(r)}>Comptabiliser</Button></>}
                      {can.match && r.matched_transaction_id && <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={setMatch.isPending}
                        onClick={() => setMatch.mutate({ line: r.id, transaction: null })}>Annuler</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {matching && <MatchDialog accountId={accountId} line={matching} onClose={() => setMatching(null)} />}
      {posting && <PostLineDialog line={posting} onClose={() => setPosting(null)} />}
    </section>
  );
}

function MatchDialog({ accountId, line, onClose }: { accountId: string; line: StatementRow; onClose: () => void }) {
  const { data: suggestions = [], isLoading } = useMatchSuggestions(line.id);
  const { data: moves = [] } = useTreasuryMovements();
  const setMatch = useSetMatch();
  const [all, setAll] = useState(false);
  const others = moves.filter((m) => m.bank_account_id === accountId && !m.is_reconciled && !suggestions.some((s) => s.transaction_id === m.id));
  const choose = (id: string) => setMatch.mutate({ line: line.id, transaction: id }, { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Rapprocher la ligne du {d(line.line_date)} — {fmt(line.amount)}</DialogTitle>
          <DialogDescription className="text-xs">{line.description} {line.reference ? `· ${line.reference}` : ""}</DialogDescription></DialogHeader>
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <p className="text-xs font-medium">Mouvements proposés (montant et date proches)</p>
            {suggestions.length === 0 && <p className="text-xs text-muted-foreground">Aucun mouvement proche : voir tous les mouvements non rapprochés, ou comptabiliser la ligne.</p>}
            {suggestions.map((s) => (
              <button key={s.transaction_id} type="button" data-testid="match-suggestion" className="w-full text-left text-xs border border-border rounded-md p-2 hover:bg-muted/40" onClick={() => choose(s.transaction_id)}>
                {d(s.transaction_date)} · <span className="tabular-nums">{fmt(s.amount)}</span> · {s.description}
              </button>))}
            <button type="button" className="text-xs underline" onClick={() => setAll(!all)}>{all ? "Masquer" : "Voir"} tous les mouvements non rapprochés du compte ({others.length})</button>
            {all && others.map((m) => (
              <button key={m.id} type="button" className="w-full text-left text-xs border border-border rounded-md p-2 hover:bg-muted/40" onClick={() => choose(m.id)}>
                {d(m.transaction_date)} · <span className="tabular-nums">{fmt(m.amount)}</span> · {m.description} {m.reference ? `· ${m.reference}` : ""}
              </button>))}
          </div>
        )}
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Fermer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostLineDialog({ line, onClose }: { line: StatementRow; onClose: () => void }) {
  const { data: gl = [] } = useGLAccounts();
  const { data: accounts = [] } = useTreasuryAccounts();
  const post = usePostStatementLine();
  const treasuryGl = new Set(accounts.map((a) => a.gl_account_id));
  const counters = (gl as any[]).filter((g) => g.is_active && !g.is_header && !treasuryGl.has(g.id));
  const [counter, setCounter] = useState("");
  const [label, setLabel] = useState(line.description ?? "");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">Comptabiliser la ligne du {d(line.line_date)} — {fmt(line.amount)}</DialogTitle>
          <DialogDescription className="text-xs">Pour une opération que seule la banque connaît (frais, agios, intérêts, prélèvement) : écriture au journal de banque, mouvement créé et rapproché de la ligne.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="pl-counter">Contrepartie</Label>
            <select id="pl-counter" className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={counter} onChange={(e) => setCounter(e.target.value)}>
              <option value="">— compte général —</option>
              {counters.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor="pl-label">Libellé</Label>
            <Input id="pl-label" className="h-8 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!counter || post.isPending} onClick={() => post.mutate({ line: line.id, counter, label }, { onSuccess: onClose })}>Comptabiliser et rapprocher</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportStatementDialog({ accountId, accountName, lastClosing, lastEnd, onClose, onDone }: {
  accountId: string; accountName: string; lastClosing: number | null; lastEnd: string | null; onClose: () => void; onDone: (id: string) => void;
}) {
  const importer = useImportStatement();
  const [file, setFile] = useState<TableFile | null>(null);
  const [mapping, setMapping] = useState<StatementMapping>({});
  const [showColumns, setShowColumns] = useState(false);
  const [opening, setOpening] = useState(lastClosing != null ? String(lastClosing) : "");
  const [closing, setClosing] = useState("");
  const [period, setPeriod] = useState({ from: "", to: "" });
  const { lines, errors } = useMemo(() => (file ? readStatementLines(file.records, mapping) : { lines: [], errors: [] }), [file, mapping]);
  const sum = statementSummary(lines);
  const missing = missingStatementColumns(mapping);
  const op = Number(String(opening).replace(",", ".")), cl = Number(String(closing).replace(",", "."));
  const expected = Math.round((op + sum.total) * 100) / 100;
  const balanced = closing !== "" && Number.isFinite(cl) && Math.round(cl * 100) / 100 === expected;
  const from = period.from || sum.from, to = period.to || sum.to;

  const read = async (f: File) => {
    try {
      const t = await readTableFile(f);
      const m = detectStatementColumns(t.headers);
      setFile(t); setMapping(m); setShowColumns(missingStatementColumns(m).length > 0);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Importer un relevé — {accountName}</DialogTitle>
          <DialogDescription className="text-xs">Le fichier exporté par la banque (Excel ou CSV) : colonnes Date, Libellé, Montant (ou Débit / Crédit), Référence reconnues automatiquement. Le relevé doit être équilibré : solde initial + mouvements = solde final.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs" htmlFor="st-file">Fichier du relevé</Label>
            <Input id="st-file" type="file" accept={TABLE_FILE_ACCEPT} className="h-8 text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} /></div>
          {file && <>
            <p className="text-xs text-muted-foreground" data-testid="statement-file-summary">{file.name} · {sum.count} ligne(s) lue(s){sum.count ? ` du ${d(sum.from)} au ${d(sum.to)}` : ""} · total des mouvements {fmt(sum.total)}
              {missing.length > 0 && <span className="text-destructive"> · colonne(s) à indiquer : {missing.join(", ")}</span>}
              {" "}<button type="button" className="underline" onClick={() => setShowColumns(!showColumns)}>{showColumns ? "Masquer les colonnes" : "Modifier les colonnes"}</button></p>
            {errors.length > 0 && <p className="text-xs text-destructive" role="alert">{errors.slice(0, 5).join(" ; ")}{errors.length > 5 ? " ; …" : ""}</p>}
            {showColumns && <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STATEMENT_COLUMNS) as (keyof typeof STATEMENT_COLUMNS)[]).map((k) => (
                <div key={k} className="space-y-1"><Label className="text-xs" htmlFor={`st-col-${k}`}>Colonne « {FIELD_LABEL[k]} »</Label>
                  <select id={`st-col-${k}`} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value || undefined })}>
                    <option value="">— aucune —</option>{file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select></div>))}
            </div>}
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1"><Label className="text-xs" htmlFor="st-from">Du</Label><Input id="st-from" type="date" className="h-8 text-xs" value={from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor="st-to">Au</Label><Input id="st-to" type="date" className="h-8 text-xs" value={to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor="st-opening">Solde initial</Label><Input id="st-opening" inputMode="decimal" className="h-8 text-xs" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor="st-closing">Solde final du relevé</Label><Input id="st-closing" inputMode="decimal" className="h-8 text-xs" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
            </div>
            <p className={cn("text-xs", closing === "" ? "text-muted-foreground" : balanced ? "text-success" : "text-destructive")} data-testid="statement-balance-check">
              Solde initial + mouvements = {fmt(expected)}{closing !== "" && (balanced ? " : relevé équilibré" : ` : écart de ${fmt(cl - expected)} avec le solde final indiqué`)}
              {lastEnd && <span className="text-muted-foreground"> · relevé précédent jusqu'au {d(lastEnd)}, solde final {fmt(lastClosing ?? 0)}</span>}
            </p>
          </>}
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!file || missing.length > 0 || lines.length === 0 || !balanced || !from || !to || importer.isPending}
            onClick={() => importer.mutate({ account: accountId, fileName: file!.name, from, to, opening: op, closing: cl, lines }, { onSuccess: (r: any) => onDone(String(r?.releve ?? "")) })}>Importer et rapprocher</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationPanel({ accountId, accountLabel, can, lastStatementEnd }: { accountId: string; accountLabel: string; can: Record<string, boolean>; lastStatementEnd: string | null }) {
  const { data: recs = [] } = useReconciliationsFor(accountId);
  const prepare = usePrepareReconciliation();
  const validate = useValidateReconciliation();
  const draft = recs.find((r) => r.status === "draft");
  return (
    <section aria-label="État de rapprochement" className="card-elevated p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold">État de rapprochement</h2>
        {(can.match || can.validate) && lastStatementEnd && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={prepare.isPending}
          onClick={() => prepare.mutate({ account: accountId, date: lastStatementEnd })}>Calculer l'état au {d(lastStatementEnd)}</Button>}
      </div>
      {draft && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs" data-testid="reconciliation-draft">
          <div><p className="text-muted-foreground">Solde du relevé</p><p className="font-medium tabular-nums">{fmt(draft.bank_balance)}</p></div>
          <div><p className="text-muted-foreground">+ encaissements en suspens</p><p className="font-medium tabular-nums">{fmt(draft.outstanding_receipts)}</p></div>
          <div><p className="text-muted-foreground">− décaissements en suspens</p><p className="font-medium tabular-nums">{fmt(draft.outstanding_payments)}</p></div>
          <div><p className="text-muted-foreground">= solde comptable</p><p className="font-medium tabular-nums">{fmt(draft.book_balance)}</p></div>
          <div><p className="text-muted-foreground">Lignes sans contrepartie</p><p className={cn("font-medium", draft.unmatched_statement_lines > 0 && "text-destructive")}>{draft.unmatched_statement_lines}</p></div>
          {can.validate && <div className="col-span-full"><Button size="sm" className="h-8 text-xs" disabled={validate.isPending} onClick={() => validate.mutate(draft.id)}>Valider le rapprochement au {d(draft.period_end)}</Button></div>}
        </div>
      )}
      <table className="w-full text-xs" data-testid="reconciliations">
        <thead><tr className="text-muted-foreground border-b border-border"><th className="text-left p-1">Au</th><th className="text-right">Relevé</th><th className="text-right">Comptable</th>
          <th className="text-right">En suspens (+ / −)</th><th className="text-left pl-3">État</th><th /></tr></thead>
        <tbody>{recs.map((r) => (
          <tr key={r.id} data-testid="reconciliation-row" className="border-b border-border/50"><td className="p-1">{d(r.period_end)}</td>
            <td className="text-right tabular-nums">{fmt(r.bank_balance)}</td><td className="text-right tabular-nums">{fmt(r.book_balance)}</td>
            <td className="text-right tabular-nums">{fmt(r.outstanding_receipts)} / {fmt(r.outstanding_payments)}</td>
            <td className="pl-3">{r.status === "validated" ? <StatusBadge status="success" label="Validé" /> : <StatusBadge status="warning" label="Brouillon" />}</td>
            <td className="pr-1 text-right"><DocumentPrintButtons testId="reconciliation-print" build={() => ({
              title: "État de rapprochement bancaire", fileName: `rapprochement-${r.period_end}`, amountInWords: false,
              subtitle: `${accountLabel} · au ${d(r.period_end)} · ${r.status === "validated" ? "validé" : "brouillon"}`,
              header: [["Compte de trésorerie", accountLabel], ["Arrêté au", d(r.period_end)], ["État", r.status === "validated" ? "Validé" : "Brouillon"],
                ["Lignes du relevé sans contrepartie", String((r as any).unmatched_statement_lines ?? 0)]],
              columns: [{ label: "Rubrique" }, { label: "Montant", align: "right" }],
              rows: [["Solde du relevé bancaire", fmt(r.bank_balance)], ["+ Encaissements comptabilisés non encore au relevé", fmt(r.outstanding_receipts)],
                ["− Décaissements comptabilisés non encore au relevé", fmt(r.outstanding_payments)]],
              footer: [["Solde comptable", fmt(r.book_balance), true],
                ["Écart", fmt(Number(r.bank_balance) + Number(r.outstanding_receipts) - Number(r.outstanding_payments) - Number(r.book_balance))]],
              signatures: ["Établi par", "Validé par"],
            })} /></td></tr>))}
          {recs.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">Aucun rapprochement : importer le relevé puis calculer l'état.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
