import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentDetail, documentFileName } from "@/components/DocumentDetail";
import { ExportButtons } from "@/components/ExportButtons";
import { TreasuryAccountSelect } from "@/components/TreasuryAccountSelect";
import { BulkBar, BulkButton, SelectAllHead, SelectCell, check, useBulkRun, useSelection } from "@/components/BulkSelection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";
import { useTaxCodes } from "@/hooks/use-tax-codes";
import {
  useCancelExpense, useDecideExpense, useDeleteExpenseDraft, useEmployeesForExpenses, useExpenseCategories, useExpenseReports,
  useExpenseSettings, usePayExpense, usePostExpense, useSaveExpenseDraft, useSubmitExpense, type ExpenseLine, type ExpenseReport,
} from "@/hooks/use-expenses";
import { EXPENSE_STATUS, policyIssues, splitTtc } from "@/lib/expenses";

/*
 * Notes de frais → Transactions (V109) : notes (les siennes ; toutes avec « expenses.view_all »),
 * approbations, comptabilisation et remboursement. Chaque action passe par la fonction de la base
 * qui applique droits, niveaux, séparation des tâches et période ouverte.
 */
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;
const who = (r: ExpenseReport) => (r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : "—");
const reportId = (r: ExpenseReport) => r.id;

type LineForm = { expense_date: string; category_id: string; description: string; merchant: string; receipt_ref: string; amount: string; tax_code_id: string };
const emptyLine = (): LineForm => ({ expense_date: today(), category_id: "", description: "", merchant: "", receipt_ref: "", amount: "", tax_code_id: "" });

function usePerms() {
  const { data } = useMyAccess();
  const p = new Set(data?.permissions ?? []);
  return {
    submit: p.has("expenses.submit") || p.has("expenses.manage"), manage: p.has("expenses.manage"), viewAll: p.has("expenses.view_all"),
    approve: (lvl: number) => p.has(`expenses.approve_l${Math.min(lvl, 3)}`), post: p.has("expenses.post"), pay: p.has("expenses.pay"), export: p.has("expenses.export"),
  };
}

function ExpenseDialog({ report, onClose }: { report: ExpenseReport | null; onClose: () => void }) {
  const { data: employees = [] } = useEmployeesForExpenses();
  const { data: categories = [] } = useExpenseCategories();
  const { data: settings = null } = useExpenseSettings();
  const { data: taxes = [] } = useTaxCodes();
  const save = useSaveExpenseDraft();
  const submit = useSubmitExpense();
  const [head, setHead] = useState({
    employee_id: report?.employee_id ?? "", purpose: report?.purpose ?? "", period_start: report?.period_start ?? "", period_end: report?.period_end ?? "", notes: report?.notes ?? "",
  });
  const [lines, setLines] = useState<LineForm[]>(report?.lines.length ? report.lines.map((l) => ({
    expense_date: l.expense_date, category_id: l.category_id ?? "", description: l.description ?? "", merchant: l.merchant ?? "", receipt_ref: l.receipt_ref ?? "",
    amount: String(l.amount), tax_code_id: l.tax_code_id ?? "" })) : [emptyLine()]);
  const activeCats = categories.filter((c) => c.is_active || lines.some((l) => l.category_id === c.id));
  const rate = (id: string) => taxes.find((t) => t.id === id)?.rate ?? 0;
  const effectiveTax = (l: LineForm) => l.tax_code_id || categories.find((c) => c.id === l.category_id)?.default_tax_code_id || "";
  const totals = lines.reduce((s, l) => { const x = splitTtc(num(l.amount), rate(effectiveTax(l))); return { ttc: s.ttc + num(l.amount), net: s.net + x.net, tax: s.tax + x.tax }; }, { ttc: 0, net: 0, tax: 0 });
  const issues = policyIssues(lines.map((l) => ({ expense_date: l.expense_date, category_id: l.category_id || null, amount: num(l.amount), receipt_ref: l.receipt_ref })), categories, settings, today());
  const set = (i: number, k: keyof LineForm, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const draft = () => ({
    id: report?.id, employee_id: head.employee_id, purpose: head.purpose, period_start: head.period_start || null, period_end: head.period_end || null, notes: head.notes || null,
    lines: lines.filter((l) => num(l.amount) > 0).map((l, i): Omit<ExpenseLine, "id" | "net_amount" | "tax_amount"> => ({ line_no: i + 1, expense_date: l.expense_date,
      category_id: l.category_id || null, description: l.description.trim(), merchant: l.merchant.trim() || null, receipt_ref: l.receipt_ref.trim() || null,
      amount: num(l.amount), tax_code_id: l.tax_code_id || null })),
  });
  const busy = save.isPending || submit.isPending;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{report ? `Note ${report.report_number}` : "Nouvelle note de frais"}</DialogTitle>
          <DialogDescription className="text-xs">Saisir le montant TTC de chaque justificatif : la TVA récupérable est calculée par le code TVA de la ligne (par défaut celui de la catégorie).</DialogDescription>
        </DialogHeader>
        <section aria-label="En-tête" className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1 col-span-2"><label htmlFor="ndf-employee" className="text-xs font-medium">Salarié *</label>
            <select id="ndf-employee" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={head.employee_id} onChange={(e) => setHead({ ...head, employee_id: e.target.value })}>
              <option value="">— choisir —</option>
              {employees.filter((e) => e.status === "active" || e.id === head.employee_id).map((e) => <option key={e.id} value={e.id}>{e.matricule} — {e.last_name} {e.first_name}</option>)}
            </select></div>
          <div className="space-y-1 col-span-2"><label htmlFor="ndf-purpose" className="text-xs font-medium">Objet (mission, déplacement…)</label>
            <Input id="ndf-purpose" className="h-8 text-xs" value={head.purpose} onChange={(e) => setHead({ ...head, purpose: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="ndf-from" className="text-xs font-medium">Du</label>
            <Input id="ndf-from" type="date" className="h-8 text-xs" value={head.period_start} onChange={(e) => setHead({ ...head, period_start: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="ndf-to" className="text-xs font-medium">Au</label>
            <Input id="ndf-to" type="date" className="h-8 text-xs" value={head.period_end} onChange={(e) => setHead({ ...head, period_end: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><label htmlFor="ndf-notes" className="text-xs font-medium">Observations</label>
            <Input id="ndf-notes" className="h-8 text-xs" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></div>
        </section>
        <section aria-label="Lignes" className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left">Date</th><th className="text-left">Catégorie</th><th className="text-left">Libellé</th><th className="text-left">Fournisseur</th>
              <th className="text-left">Justificatif</th><th className="text-right">Montant TTC</th><th className="text-left">Code TVA</th><th className="text-right">TVA</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const x = splitTtc(num(l.amount), rate(effectiveTax(l)));
                return (
                  <tr key={i} className="align-top">
                    <td className="pr-1 py-1"><Input aria-label={`Date ligne ${i + 1}`} type="date" className="h-8 text-xs w-36" value={l.expense_date} onChange={(e) => set(i, "expense_date", e.target.value)} /></td>
                    <td className="pr-1"><select aria-label={`Catégorie ligne ${i + 1}`} className="h-8 rounded-md border border-input bg-background px-1 text-xs w-36" value={l.category_id} onChange={(e) => set(i, "category_id", e.target.value)}>
                      <option value="">—</option>{activeCats.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></td>
                    <td className="pr-1"><Input aria-label={`Libellé ligne ${i + 1}`} className="h-8 text-xs" value={l.description} onChange={(e) => set(i, "description", e.target.value)} /></td>
                    <td className="pr-1"><Input aria-label={`Fournisseur ligne ${i + 1}`} className="h-8 text-xs w-28" value={l.merchant} onChange={(e) => set(i, "merchant", e.target.value)} /></td>
                    <td className="pr-1"><Input aria-label={`Justificatif ligne ${i + 1}`} className="h-8 text-xs w-28" placeholder="n° de facture" value={l.receipt_ref} onChange={(e) => set(i, "receipt_ref", e.target.value)} /></td>
                    <td className="pr-1"><Input aria-label={`Montant TTC ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right w-28" value={l.amount} onChange={(e) => set(i, "amount", e.target.value)} /></td>
                    <td className="pr-1"><select aria-label={`Code TVA ligne ${i + 1}`} className="h-8 rounded-md border border-input bg-background px-1 text-xs w-28" value={l.tax_code_id} onChange={(e) => set(i, "tax_code_id", e.target.value)}>
                      <option value="">{categories.find((c) => c.id === l.category_id)?.default_tax_code_id ? "celui de la catégorie" : "sans TVA"}</option>
                      {taxes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} ({fmt(t.rate)} %)</option>)}</select></td>
                    <td className="text-right tabular-nums pt-2">{fmt(x.tax)}</td>
                    <td><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Retirer la ligne ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mt-1" onClick={() => setLines([...lines, emptyLine()])}><Plus className="w-3.5 h-3.5" /> Ajouter une dépense</Button>
        </section>
        <section aria-label="Pied" className="ml-auto w-full max-w-xs space-y-1 text-xs" data-testid="expense-footer">
          <div className="flex justify-between"><span className="text-muted-foreground">Total HT</span><span className="tabular-nums">{fmt(totals.net)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">TVA récupérable</span><span className="tabular-nums">{fmt(totals.tax)}</span></div>
          <div className="flex justify-between font-semibold border-t border-border pt-1"><span>Total à rembourser (TTC)</span><span className="tabular-nums" data-testid="expense-total">{fmt(totals.ttc)}</span></div>
        </section>
        {issues.length > 0 && <div className="text-xs text-warning bg-warning/10 rounded p-2" data-testid="expense-issues">{issues.map((m) => <p key={m}>{m}</p>)}</div>}
        {categories.length === 0 && <p className="text-xs text-destructive">Aucune catégorie de frais : les créer dans Données de base (droit « expenses.settings »).</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button variant="outline" size="sm" disabled={!head.employee_id || busy} onClick={() => save.mutate(draft(), { onSuccess: onClose })}>Enregistrer le brouillon</Button>
          <Button size="sm" disabled={!head.employee_id || busy || issues.length > 0}
            onClick={() => save.mutate(draft(), { onSuccess: (id) => submit.mutate(id, { onSuccess: onClose }) })}>Enregistrer et soumettre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseView({ report, onClose, onEdit }: { report: ExpenseReport; onClose: () => void; onEdit: () => void }) {
  const { user } = useAuth();
  const perms = usePerms();
  const { data: categories = [] } = useExpenseCategories();
  const submit = useSubmitExpense(), decide = useDecideExpense(), post = usePostExpense(), pay = usePayExpense(), cancel = useCancelExpense(), remove = useDeleteExpenseDraft();
  const [payForm, setPayForm] = useState({ date: today(), method: "bank_transfer", bank: "", reference: "" });
  const [postDate, setPostDate] = useState(today());
  const mine = report.created_by === user?.id;
  const canEdit = ["draft", "rejected"].includes(report.status) && (mine || perms.manage);
  const pending = report.approvals.find((a) => a.status === "pending");
  const decidedByMe = report.approvals.some((a) => a.status === "approved" && a.decided_by === user?.id);
  const canDecide = report.status === "submitted" && !!pending && !mine && !decidedByMe && perms.approve(pending.level_order);
  const st = EXPENSE_STATUS[report.status];
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm">Note de frais {report.report_number}</DialogTitle></DialogHeader>
        <DocumentDetail title={`Note de frais ${report.report_number}`} fileName={documentFileName(`note-de-frais-${report.report_number}`)}
          print={{ currency: report.currency, signatures: ["Le salarié", "L'approbateur", "Le comptable"],
            notes: report.rejection_reason ? `Rejet : ${report.rejection_reason}` : report.notes }}
          header={[["Salarié", who(report)], ["Statut", st[1]], ["Objet", report.purpose ?? "—"],
            ["Période", report.period_start ? `${report.period_start} → ${report.period_end ?? ""}` : "—"],
            ["Écriture", report.entry?.piece_number ?? "—"], ["Remboursement", report.payment_entry?.piece_number ?? "—"]]}
          columns={[{ label: "Date" }, { label: "Catégorie" }, { label: "Libellé" }, { label: "Justificatif" }, { label: "HT", align: "right" }, { label: "TVA", align: "right" }, { label: "TTC", align: "right" }]}
          rows={report.lines.map((l) => [l.expense_date, (l.category_id && catName.get(l.category_id)) || l.category || "—", [l.description, l.merchant].filter(Boolean).join(" — "),
            l.receipt_ref ?? "—", fmt(l.net_amount ?? 0), fmt(l.tax_amount ?? 0), fmt(l.amount)])}
          footer={[["Total HT", fmt(report.subtotal)], ["TVA récupérable", fmt(report.tax_amount)], ["Net à payer", fmt(report.total), true]]} />
        {report.approvals.length > 0 && (
          <section aria-label="Approbations" className="text-xs space-y-1" data-testid="expense-approvals">
            <h4 className="font-medium">Approbations</h4>
            {report.approvals.map((a) => (
              <p key={a.id}>{a.level_label} ({a.approver_label}) : <strong>{a.status === "pending" ? "en attente" : a.status === "approved" ? "approuvé" : a.status === "rejected" ? "rejeté" : "sans objet"}</strong>
                {a.decided_at ? ` le ${new Date(a.decided_at).toLocaleString("fr-FR")}` : ""}{a.comment ? ` — ${a.comment}` : ""}</p>
            ))}
          </section>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3" data-testid="expense-actions">
          {canEdit && <Button size="sm" variant="outline" onClick={onEdit}>Modifier</Button>}
          {canEdit && <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(report.id, { onSuccess: onClose })}>Soumettre</Button>}
          {report.status === "draft" && (mine || perms.manage) && <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending}
            onClick={() => { if (window.confirm("Supprimer ce brouillon ?")) remove.mutate(report.id, { onSuccess: onClose }); }}>Supprimer</Button>}
          {["submitted", "rejected"].includes(report.status) && (mine || perms.manage) && <Button size="sm" variant="ghost" disabled={cancel.isPending}
            onClick={() => { const r = window.prompt("Motif de l'annulation"); if (r && r.trim()) cancel.mutate({ id: report.id, reason: r.trim() }, { onSuccess: onClose }); }}>Annuler la note</Button>}
          {report.status === "submitted" && pending && <span className="text-xs text-muted-foreground" data-testid="expense-level">{pending.level_label}{mine ? " · vous êtes l'auteur" : ""}</span>}
          {canDecide && <>
            <Button size="sm" className="bg-success hover:bg-success/90" disabled={decide.isPending} onClick={() => decide.mutate({ approval: pending!.id, approve: true }, { onSuccess: onClose })}>Approuver</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={decide.isPending}
              onClick={() => { const r = window.prompt("Motif du rejet (obligatoire)"); if (r && r.trim()) decide.mutate({ approval: pending!.id, approve: false, comment: r.trim() }, { onSuccess: onClose }); }}>Rejeter</Button>
          </>}
          {report.status === "approved" && perms.post && <>
            <div className="space-y-1"><label htmlFor="ndf-post-date" className="text-[11px] text-muted-foreground">Date de comptabilisation</label>
              <Input id="ndf-post-date" type="date" className="h-8 text-xs w-40" value={postDate} onChange={(e) => setPostDate(e.target.value)} /></div>
            <Button size="sm" disabled={post.isPending} onClick={() => post.mutate({ id: report.id, date: postDate }, { onSuccess: onClose })}>Comptabiliser</Button>
          </>}
          {report.status === "posted" && perms.pay && <>
            <div className="space-y-1"><label htmlFor="ndf-pay-date" className="text-[11px] text-muted-foreground">Date du remboursement</label>
              <Input id="ndf-pay-date" type="date" className="h-8 text-xs w-36" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></div>
            <div className="space-y-1"><label htmlFor="ndf-pay-method" className="text-[11px] text-muted-foreground">Mode</label>
              <select id="ndf-pay-method" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value, bank: "" })}>
                <option value="bank_transfer">Virement</option><option value="check">Chèque</option><option value="cash">Espèces</option><option value="mobile_money">Mobile money</option></select></div>
            <div className="w-56"><TreasuryAccountSelect id="ndf-pay-account" method={payForm.method} value={payForm.bank} onChange={(v) => setPayForm({ ...payForm, bank: v })} /></div>
            <div className="space-y-1"><label htmlFor="ndf-pay-ref" className="text-[11px] text-muted-foreground">Référence</label>
              <Input id="ndf-pay-ref" className="h-8 text-xs w-32" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></div>
            <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate({ id: report.id, date: payForm.date, method: payForm.method, bankAccountId: payForm.bank || null, reference: payForm.reference || null }, { onSuccess: onClose })}>Rembourser</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseTransactions() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "reports") as "reports" | "approvals" | "posting";
  const { user } = useAuth();
  const perms = usePerms();
  const { data: reports = [], isLoading, error } = useExpenseReports();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<ExpenseReport | null | "new">(null);
  const [viewing, setViewing] = useState<ExpenseReport | null>(null);
  const bulk = useBulkRun();

  const toApprove = reports.filter((r) => {
    const p = r.approvals.find((a) => a.status === "pending");
    return r.status === "submitted" && p && r.created_by !== user?.id && !r.approvals.some((a) => a.status === "approved" && a.decided_by === user?.id) && perms.approve(p.level_order);
  });
  const toPost = reports.filter((r) => r.status === "approved" || r.status === "posted");
  const list = tab === "approvals" ? toApprove : tab === "posting" ? toPost : reports;
  const rows = useMemo(() => list.filter((r) => (!status || r.status === status)
    && `${r.report_number} ${who(r)} ${r.purpose ?? ""}`.toLowerCase().includes(search.toLowerCase())), [list, status, search]);
  const sel = useSelection<ExpenseReport>(rows, reportId);
  const drafts = sel.chosen.filter((r) => ["draft", "rejected"].includes(r.status) && (r.created_by === user?.id || perms.manage)).map((r) => r.id);
  const approved = sel.chosen.filter((r) => r.status === "approved").map((r) => r.id);
  const setTab = (t: string) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });
  const exportRows = rows.map((r) => ({ numero: r.report_number, salarie: who(r), objet: r.purpose ?? "", statut: EXPENSE_STATUS[r.status][1], ht: r.subtotal, tva: r.tax_amount, ttc: r.total,
    soumise: r.submitted_at ? r.submitted_at.slice(0, 10) : "", ecriture: r.entry?.piece_number ?? "" }));
  const exportCols = [{ key: "numero" as const, header: "N° note" }, { key: "salarie" as const, header: "Salarié" }, { key: "objet" as const, header: "Objet" }, { key: "statut" as const, header: "Statut" },
    { key: "ht" as const, header: "HT" }, { key: "tva" as const, header: "TVA" }, { key: "ttc" as const, header: "TTC" }, { key: "soumise" as const, header: "Soumise le" }, { key: "ecriture" as const, header: "Écriture" }];

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Notes de frais", href: "/expenses" }, { label: "Transactions" }]} />
      <GuidanceBanner title="Notes de frais" description="Saisie des dépenses avec leurs justificatifs, approbation par niveaux, comptabilisation et remboursement. Chacun voit ses notes ; l'approbation et la comptabilité voient celles de la société." />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Notes de frais — Transactions</h1>
        {perms.submit && <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="w-3.5 h-3.5" /> Nouvelle note de frais</Button>}
      </div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {([["reports", `Notes (${reports.length})`], ["approvals", `À approuver (${toApprove.length})`], ["posting", `Comptabilisation (${toPost.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === k ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Rechercher une note" placeholder="N°, salarié, objet…" className="h-8 w-56 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Statut" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>{Object.entries(EXPENSE_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
        {perms.export && <div className="ml-auto"><ExportButtons label="Exporter les notes" rows={exportRows} columns={exportCols} filename={`notes-de-frais-${today()}`} /></div>}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{(error as Error).message}</p>}
      <div className="card-elevated overflow-x-auto">
        <BulkBar count={sel.chosen.length} onClear={sel.clear} testId="bulk-bar-expenses">
          <BulkButton count={drafts.length} label="Soumettre" disabled={bulk.isPending} onClick={() => {
            if (window.confirm(`Soumettre ${drafts.length} note(s) ?`)) bulk.mutate({ ids: drafts, done: "note(s) soumise(s)", invalidate: ["expense-reports"],
              run: async (id) => check(await (supabase as any).rpc("expense_report_submit", { _id: id })) }, { onSuccess: sel.clear });
          }} />
          {perms.post && <BulkButton count={approved.length} label="Comptabiliser" disabled={bulk.isPending} onClick={() => {
            if (window.confirm(`Comptabiliser ${approved.length} note(s) à la date du jour ?`)) bulk.mutate({ ids: approved, done: "note(s) comptabilisée(s)", invalidate: ["expense-reports", "gl-transactions"],
              run: async (id) => check(await (supabase as any).rpc("expense_report_post", { _id: id, _date: today() })) }, { onSuccess: sel.clear });
          }} />}
        </BulkBar>
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <table className="w-full text-xs" data-testid="expense-reports">
            <thead><tr className="bg-muted/30 text-muted-foreground">
              <SelectAllHead sel={sel} pageIds={rows.map((r) => r.id)} label="Sélectionner toutes les notes" />
              <th className="text-left p-2">N° note</th><th className="text-left">Salarié</th><th className="text-left">Objet</th><th className="text-right">TTC</th>
              <th className="text-left pl-3">Statut</th><th className="text-left">Niveau / écriture</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Aucune note de frais.</td></tr>}
              {rows.map((r) => {
                const p = r.approvals.find((a) => a.status === "pending");
                return (
                  <tr key={r.id} data-testid="expense-row" className="border-t border-border/50 cursor-pointer hover:bg-muted/30" onClick={() => setViewing(r)}>
                    <SelectCell sel={sel} id={r.id} label={`Sélectionner ${r.report_number}`} />
                    <td className="p-2 font-mono text-primary">{r.report_number}</td><td>{who(r)}</td><td className="max-w-[20rem] truncate">{r.purpose}</td>
                    <td className="text-right tabular-nums">{fmt(r.total)}</td>
                    <td className="pl-3"><StatusBadge status={EXPENSE_STATUS[r.status][0]} label={EXPENSE_STATUS[r.status][1]} /></td>
                    <td className="text-muted-foreground">{r.status === "submitted" && p ? p.level_label : r.entry?.piece_number ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && <ExpenseDialog report={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <ExpenseView report={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </PageShell>
  );
}
