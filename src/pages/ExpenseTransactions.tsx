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
  useExpenseSettings, usePayExpense, usePostExpense, useSaveExpenseDraft, useSubmitExpense, useExpenseRates, useExpenseAdvances, usePayAdvance, useRefundAdvance,
  useAttachReceipt, openReceipt, RATE_UNIT, type ExpenseLine, type ExpenseReport,
} from "@/hooks/use-expenses";
import { useProjects } from "@/hooks/use-projects";
import { EXPENSE_STATUS, convert, policyIssues, splitTtc } from "@/lib/expenses";
import { moduleRpc } from "@/api/rpc";

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

function usePerms() {
  const { data } = useMyAccess();
  const p = new Set(data?.permissions ?? []);
  return {
    submit: p.has("expenses.submit") || p.has("expenses.manage"), manage: p.has("expenses.manage"), viewAll: p.has("expenses.view_all"),
    approve: (lvl: number) => p.has(`expenses.approve_l${Math.min(lvl, 3)}`), post: p.has("expenses.post"), pay: p.has("expenses.pay"), export: p.has("expenses.export"),
  };
}

type LineForm = { kind: "expense" | "rate"; expense_date: string; category_id: string; rate_id: string; quantity: string; description: string; merchant: string;
  receipt_ref: string; amount: string; tax_code_id: string; currency: string; exchange_rate: string; project_id: string };
const BASE_CURRENCY = "XOF";
const emptyLine = (): LineForm => ({ kind: "expense", expense_date: today(), category_id: "", rate_id: "", quantity: "", description: "", merchant: "", receipt_ref: "",
  amount: "", tax_code_id: "", currency: BASE_CURRENCY, exchange_rate: "", project_id: "" });

function ExpenseDialog({ report, onClose }: { report: ExpenseReport | null; onClose: () => void }) {
  const { data: employees = [] } = useEmployeesForExpenses();
  const { data: categories = [] } = useExpenseCategories();
  const { data: rates = [] } = useExpenseRates();
  const { data: settings = null } = useExpenseSettings();
  const { data: taxes = [] } = useTaxCodes();
  const { data: projects = [] } = useProjects();
  const save = useSaveExpenseDraft();
  const submit = useSubmitExpense();
  const [head, setHead] = useState({
    employee_id: report?.employee_id ?? "", purpose: report?.purpose ?? "", period_start: report?.period_start ?? "", period_end: report?.period_end ?? "", notes: report?.notes ?? "",
  });
  const [lines, setLines] = useState<LineForm[]>(report?.lines.length ? report.lines.map((l) => ({
    kind: l.rate_id ? "rate" : "expense", expense_date: l.expense_date, category_id: l.category_id ?? "", rate_id: l.rate_id ?? "", quantity: l.quantity == null ? "" : String(l.quantity),
    description: l.description ?? "", merchant: l.merchant ?? "", receipt_ref: l.receipt_ref ?? "",
    amount: String(l.original_amount ?? l.amount), tax_code_id: l.tax_code_id ?? "", currency: l.original_currency ?? BASE_CURRENCY,
    exchange_rate: l.exchange_rate == null ? "" : String(l.exchange_rate), project_id: l.project_id ?? "" })) : [emptyLine()]);
  const activeCats = categories.filter((c) => c.is_active || lines.some((l) => l.category_id === c.id));
  const activeRates = rates.filter((r) => r.is_active || lines.some((l) => l.rate_id === r.id));
  const activeProjects = projects.filter((p) => p.status === "active" || lines.some((l) => l.project_id === p.id));
  const rateOf = (id: string) => rates.find((r) => r.id === id);
  const taxRate = (id: string) => taxes.find((t) => t.id === id)?.rate ?? 0;
  const effectiveTax = (l: LineForm) => (l.kind === "rate" ? "" : l.tax_code_id || categories.find((c) => c.id === l.category_id)?.default_tax_code_id || "");
  const foreign = (l: LineForm) => l.kind === "expense" && l.currency.trim().toUpperCase() !== BASE_CURRENCY;
  /** Montant de la ligne dans la devise de la société (barème × quantité, contre-valeur, ou TTC saisi). */
  const amountOf = (l: LineForm) => l.kind === "rate" ? convert(num(l.quantity), rateOf(l.rate_id)?.rate ?? 0)
    : foreign(l) ? convert(num(l.amount), num(l.exchange_rate)) : num(l.amount);
  const totals = lines.reduce((s, l) => { const a = amountOf(l); const x = splitTtc(a, taxRate(effectiveTax(l))); return { ttc: s.ttc + a, net: s.net + x.net, tax: s.tax + x.tax }; }, { ttc: 0, net: 0, tax: 0 });
  const issues = [
    ...policyIssues(lines.map((l) => ({ expense_date: l.expense_date, category_id: (l.kind === "rate" ? rateOf(l.rate_id)?.category_id : l.category_id) || null,
      amount: amountOf(l), receipt_ref: l.receipt_ref, on_rate: l.kind === "rate" })), categories, settings, today()),
    ...lines.flatMap((l, i) => (foreign(l) && !(num(l.exchange_rate) > 0) ? [`ligne ${i + 1} : cours de la devise ${l.currency.toUpperCase()} à saisir`] : [])),
  ];
  const set = (i: number, k: keyof LineForm, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const draft = () => ({
    id: report?.id, employee_id: head.employee_id, purpose: head.purpose, period_start: head.period_start || null, period_end: head.period_end || null, notes: head.notes || null,
    lines: lines.filter((l) => amountOf(l) > 0).map((l, i): Omit<ExpenseLine, "id" | "net_amount" | "tax_amount"> => ({ line_no: i + 1, expense_date: l.expense_date,
      category_id: l.kind === "rate" ? rateOf(l.rate_id)?.category_id ?? null : l.category_id || null, description: l.description.trim(), merchant: l.merchant.trim() || null,
      receipt_ref: l.receipt_ref.trim() || null, amount: amountOf(l), tax_code_id: l.kind === "rate" ? null : l.tax_code_id || null, project_id: l.project_id || null,
      rate_id: l.kind === "rate" ? l.rate_id || null : null, quantity: l.kind === "rate" ? num(l.quantity) : null,
      original_currency: foreign(l) ? l.currency.trim().toUpperCase() : null, original_amount: foreign(l) ? num(l.amount) : null, exchange_rate: foreign(l) ? num(l.exchange_rate) : null })),
  });
  const busy = save.isPending || submit.isPending;
  const sel = "h-8 rounded-md border border-input bg-background px-1 text-xs";
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{report ? `Note ${report.report_number}` : "Nouvelle note de frais"}</DialogTitle>
          <DialogDescription className="text-xs">Dépense : montant TTC du justificatif (TVA calculée par le code TVA) ; en devise, montant d'origine et cours du jour. Barème : quantité (km, jours…) × taux de la société, sans TVA ni justificatif de montant.</DialogDescription>
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
        <section aria-label="Lignes" className="space-y-2">
          {lines.map((l, i) => {
            const a = amountOf(l);
            const x = splitTtc(a, taxRate(effectiveTax(l)));
            return (
              <div key={i} className="border border-border rounded-md p-2 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" data-testid="expense-line-form">
                <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-kind-${i}`}>Type</label>
                  <select id={`ndf-kind-${i}`} aria-label={`Type ligne ${i + 1}`} className={`${sel} w-full`} value={l.kind} onChange={(e) => set(i, "kind", e.target.value)}>
                    <option value="expense">Dépense</option><option value="rate" disabled={activeRates.length === 0}>Barème (km, per diem)</option></select></div>
                <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-date-${i}`}>Date</label>
                  <Input id={`ndf-date-${i}`} aria-label={`Date ligne ${i + 1}`} type="date" className="h-8 text-xs" value={l.expense_date} onChange={(e) => set(i, "expense_date", e.target.value)} /></div>
                {l.kind === "rate" ? <>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-rate-${i}`}>Barème</label>
                    <select id={`ndf-rate-${i}`} aria-label={`Barème ligne ${i + 1}`} className={`${sel} w-full`} value={l.rate_id} onChange={(e) => set(i, "rate_id", e.target.value)}>
                      <option value="">—</option>{activeRates.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name} ({fmt(r.rate)} / {RATE_UNIT[r.unit]})</option>)}</select></div>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-qty-${i}`}>Quantité {l.rate_id ? `(${RATE_UNIT[rateOf(l.rate_id)!.unit]})` : ""}</label>
                    <Input id={`ndf-qty-${i}`} aria-label={`Quantité ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.quantity} onChange={(e) => set(i, "quantity", e.target.value)} /></div>
                </> : <>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-cat-${i}`}>Catégorie</label>
                    <select id={`ndf-cat-${i}`} aria-label={`Catégorie ligne ${i + 1}`} className={`${sel} w-full`} value={l.category_id} onChange={(e) => set(i, "category_id", e.target.value)}>
                      <option value="">—</option>{activeCats.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-amount-${i}`}>Montant TTC{foreign(l) ? ` (${l.currency.toUpperCase()})` : ""}</label>
                    <Input id={`ndf-amount-${i}`} aria-label={`Montant TTC ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.amount} onChange={(e) => set(i, "amount", e.target.value)} /></div>
                </>}
                <div className="space-y-1 md:col-span-2"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-desc-${i}`}>Libellé</label>
                  <Input id={`ndf-desc-${i}`} aria-label={`Libellé ligne ${i + 1}`} className="h-8 text-xs" value={l.description} onChange={(e) => set(i, "description", e.target.value)} /></div>
                {l.kind === "expense" && <>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-merchant-${i}`}>Fournisseur</label>
                    <Input id={`ndf-merchant-${i}`} aria-label={`Fournisseur ligne ${i + 1}`} className="h-8 text-xs" value={l.merchant} onChange={(e) => set(i, "merchant", e.target.value)} /></div>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-receipt-${i}`}>Justificatif</label>
                    <Input id={`ndf-receipt-${i}`} aria-label={`Justificatif ligne ${i + 1}`} className="h-8 text-xs" placeholder="n° de facture" value={l.receipt_ref} onChange={(e) => set(i, "receipt_ref", e.target.value)} /></div>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-tax-${i}`}>Code TVA</label>
                    <select id={`ndf-tax-${i}`} aria-label={`Code TVA ligne ${i + 1}`} className={`${sel} w-full`} value={l.tax_code_id} onChange={(e) => set(i, "tax_code_id", e.target.value)}>
                      <option value="">{categories.find((c) => c.id === l.category_id)?.default_tax_code_id ? "celui de la catégorie" : "sans TVA"}</option>
                      {taxes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} ({fmt(t.rate)} %)</option>)}</select></div>
                  <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-cur-${i}`}>Devise</label>
                    <Input id={`ndf-cur-${i}`} aria-label={`Devise ligne ${i + 1}`} maxLength={3} className="h-8 text-xs uppercase" value={l.currency} onChange={(e) => set(i, "currency", e.target.value.toUpperCase())} /></div>
                  {foreign(l) && <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-fx-${i}`}>Cours (1 {l.currency.toUpperCase()} = ? {BASE_CURRENCY})</label>
                    <Input id={`ndf-fx-${i}`} aria-label={`Cours ligne ${i + 1}`} inputMode="decimal" className="h-8 text-xs text-right" value={l.exchange_rate} onChange={(e) => set(i, "exchange_rate", e.target.value)} /></div>}
                </>}
                <div className="space-y-1"><label className="text-[11px] text-muted-foreground" htmlFor={`ndf-project-${i}`}>Projet</label>
                  <select id={`ndf-project-${i}`} aria-label={`Projet ligne ${i + 1}`} className={`${sel} w-full`} value={l.project_id} onChange={(e) => set(i, "project_id", e.target.value)}>
                    <option value="">—</option>{activeProjects.map((p) => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}</select></div>
                <div className="text-xs text-right tabular-nums" data-testid="expense-line-amount">{fmt(a)} {BASE_CURRENCY}{x.tax ? ` · TVA ${fmt(x.tax)}` : ""}</div>
                <div className="text-right"><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Retirer la ligne ${i + 1}`} disabled={lines.length <= 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button></div>
              </div>
            );
          })}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLines([...lines, emptyLine()])}><Plus className="w-3.5 h-3.5" /> Ajouter une ligne</Button>
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
  const attach = useAttachReceipt();
  const { data: advances = [] } = useExpenseAdvances();
  const open = advances.filter((a) => a.employee_id === report.employee_id && a.amount - a.amount_applied - a.amount_refunded > 0);
  const openTotal = open.reduce((t, a) => t + a.amount - a.amount_applied - a.amount_refunded, 0);
  const [applyAdvances, setApplyAdvances] = useState(true);
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
          footer={[["Total HT", fmt(report.subtotal)], ["TVA récupérable", fmt(report.tax_amount)], ["Total TTC", fmt(report.total)],
            ...(report.advance_applied ? [["Avances imputées", fmt(report.advance_applied)] as [string, string]] : []),
            ["Net à payer", fmt(report.total - report.advance_applied), true]]} />
        {report.approvals.length > 0 && (
          <section aria-label="Approbations" className="text-xs space-y-1" data-testid="expense-approvals">
            <h4 className="font-medium">Approbations</h4>
            {report.approvals.map((a) => (
              <p key={a.id}>{a.level_label} ({a.approver_label}) : <strong>{a.status === "pending" ? "en attente" : a.status === "approved" ? "approuvé" : a.status === "rejected" ? "rejeté" : "sans objet"}</strong>
                {a.decided_at ? ` le ${new Date(a.decided_at).toLocaleString("fr-FR")}` : ""}{a.comment ? ` — ${a.comment}` : ""}</p>
            ))}
          </section>
        )}
        {report.lines.some((l) => l.id) && (
          <section aria-label="Justificatifs" className="text-xs space-y-1" data-testid="expense-receipts">
            <h4 className="font-medium">Justificatifs joints</h4>
            {report.lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2">
                <span className="w-48 truncate">Ligne {l.line_no} — {l.description || l.category}</span>
                {l.receipt_path ? <Button size="sm" variant="link" className="h-6 px-0 text-xs" onClick={() => void openReceipt(l.receipt_path!)}>Voir le justificatif</Button>
                  : <span className="text-muted-foreground">aucun fichier</span>}
                {canEdit && <input type="file" aria-label={`Joindre un justificatif à la ligne ${l.line_no}`} accept="image/*,application/pdf" className="text-xs"
                  disabled={attach.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f && l.id) attach.mutate({ reportId: report.id, lineId: l.id, file: f }); e.target.value = ""; }} />}
              </div>
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
          {report.status === "posted" && perms.pay && openTotal > 0 && (
            <label className="w-full flex items-center gap-2 text-xs" data-testid="expense-advances-available">
              <input type="checkbox" checked={applyAdvances} onChange={(e) => setApplyAdvances(e.target.checked)} />
              Imputer les avances du salarié ({fmt(openTotal)} disponibles : {open.map((a) => a.advance_number).join(", ")}) — reste à payer {fmt(Math.max(0, report.total - (applyAdvances ? openTotal : 0)))}
            </label>
          )}
          {report.status === "posted" && perms.pay && <>
            <div className="space-y-1"><label htmlFor="ndf-pay-date" className="text-[11px] text-muted-foreground">Date du remboursement</label>
              <Input id="ndf-pay-date" type="date" className="h-8 text-xs w-36" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></div>
            <div className="space-y-1"><label htmlFor="ndf-pay-method" className="text-[11px] text-muted-foreground">Mode</label>
              <select id="ndf-pay-method" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value, bank: "" })}>
                <option value="bank_transfer">Virement</option><option value="check">Chèque</option><option value="cash">Espèces</option><option value="mobile_money">Mobile money</option></select></div>
            <div className="w-56"><TreasuryAccountSelect id="ndf-pay-account" method={payForm.method} value={payForm.bank} onChange={(v) => setPayForm({ ...payForm, bank: v })} /></div>
            <div className="space-y-1"><label htmlFor="ndf-pay-ref" className="text-[11px] text-muted-foreground">Référence</label>
              <Input id="ndf-pay-ref" className="h-8 text-xs w-32" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></div>
            <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate({ id: report.id, date: payForm.date, method: payForm.method, bankAccountId: payForm.bank || null, reference: payForm.reference || null, applyAdvances }, { onSuccess: onClose })}>Rembourser</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseTransactions() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "reports") as "reports" | "approvals" | "posting" | "advances";
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
        {([["reports", `Notes (${reports.length})`], ["approvals", `À approuver (${toApprove.length})`], ["posting", `Comptabilisation (${toPost.length})`], ...((perms.pay || perms.viewAll) ? [["advances", "Avances"] as const] : [])] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === k ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "advances" ? <AdvancesTab canPay={perms.pay} /> : <>
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
              run: async (id) => check(await moduleRpc("expenses", "expense_report_submit", { _id: id })) }, { onSuccess: sel.clear });
          }} />
          {perms.post && <BulkButton count={approved.length} label="Comptabiliser" disabled={bulk.isPending} onClick={() => {
            if (window.confirm(`Comptabiliser ${approved.length} note(s) à la date du jour ?`)) bulk.mutate({ ids: approved, done: "note(s) comptabilisée(s)", invalidate: ["expense-reports", "gl-transactions"],
              run: async (id) => check(await moduleRpc("expenses", "expense_report_post", { _id: id, _date: today() })) }, { onSuccess: sel.clear });
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
      </>}
      {editing && <ExpenseDialog report={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <ExpenseView report={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </PageShell>
  );
}

function AdvancesTab({ canPay }: { canPay: boolean }) {
  const { data: advances = [], isLoading } = useExpenseAdvances();
  const { data: employees = [] } = useEmployeesForExpenses();
  const pay = usePayAdvance(), refund = useRefundAdvance();
  const [f, setF] = useState({ employee: "", date: today(), amount: "", purpose: "", method: "cash", bank: "" });
  const rest = (a: { amount: number; amount_applied: number; amount_refunded: number }) => a.amount - a.amount_applied - a.amount_refunded;
  return (
    <section className="space-y-3" data-testid="expense-advances">
      {canPay && (
        <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1"><label htmlFor="adv-employee" className="text-[11px] text-muted-foreground">Salarié</label>
            <select id="adv-employee" className="h-8 rounded-md border border-input bg-background px-2 text-xs w-56" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
              <option value="">— choisir —</option>{employees.filter((e) => e.status === "active").map((e) => <option key={e.id} value={e.id}>{e.matricule} — {e.last_name} {e.first_name}</option>)}</select></div>
          <div className="space-y-1"><label htmlFor="adv-date" className="text-[11px] text-muted-foreground">Date</label>
            <Input id="adv-date" type="date" className="h-8 text-xs w-36" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="adv-amount" className="text-[11px] text-muted-foreground">Montant de l'avance</label>
            <Input id="adv-amount" inputMode="decimal" className="h-8 text-xs w-32 text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="adv-purpose" className="text-[11px] text-muted-foreground">Objet</label>
            <Input id="adv-purpose" className="h-8 text-xs w-48" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
          <div className="space-y-1"><label htmlFor="adv-method" className="text-[11px] text-muted-foreground">Mode</label>
            <select id="adv-method" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value, bank: "" })}>
              <option value="cash">Espèces</option><option value="bank_transfer">Virement</option><option value="check">Chèque</option><option value="mobile_money">Mobile money</option></select></div>
          <div className="w-56"><TreasuryAccountSelect id="adv-account" method={f.method} value={f.bank} onChange={(v) => setF({ ...f, bank: v })} /></div>
          <Button size="sm" disabled={!f.employee || !(num(f.amount) > 0) || pay.isPending}
            onClick={() => pay.mutate({ employee: f.employee, date: f.date, amount: num(f.amount), purpose: f.purpose, method: f.method, bankAccountId: f.bank || null, reference: null },
              { onSuccess: () => setF({ ...f, amount: "", purpose: "" }) })}>Verser l'avance</Button>
        </div>
      )}
      <div className="card-elevated overflow-x-auto">
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/30 text-muted-foreground"><th className="text-left p-2">N°</th><th className="text-left">Salarié</th><th className="text-left">Date</th><th className="text-left">Objet</th>
              <th className="text-right">Montant</th><th className="text-right">Imputé</th><th className="text-right">Restitué</th><th className="text-right">Solde</th><th /></tr></thead>
            <tbody>
              {advances.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Aucune avance.</td></tr>}
              {advances.map((a) => (
                <tr key={a.id} className="border-t border-border/50" data-testid="expense-advance-row">
                  <td className="p-2 font-mono">{a.advance_number}</td><td>{a.employee ? `${a.employee.first_name} ${a.employee.last_name}` : "—"}</td><td>{a.advance_date}</td><td>{a.purpose}</td>
                  <td className="text-right tabular-nums">{fmt(a.amount)}</td><td className="text-right tabular-nums">{fmt(a.amount_applied)}</td><td className="text-right tabular-nums">{fmt(a.amount_refunded)}</td>
                  <td className="text-right tabular-nums font-medium">{fmt(rest(a))}</td>
                  <td className="text-right pr-2">{canPay && rest(a) > 0 && <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={refund.isPending}
                    onClick={() => { const v = window.prompt(`Montant restitué en espèces (solde ${fmt(rest(a))})`, String(rest(a))); if (v && num(v) > 0) refund.mutate({ advance: a.id, date: today(), amount: num(v), method: "cash", bankAccountId: null }); }}>Restitution</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
