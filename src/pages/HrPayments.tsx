import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { TransactionTabsBar } from "@/components/TransactionTabsBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { usePayrollRuns } from "@/hooks/use-hr-data";
import { useTreasuryAccounts } from "@/hooks/use-treasury-accounts";
import {
  FILE_FIELDS, useApprovePaymentBatch, useBankFileProfiles, useCancelPaymentBatch, useCreatePaymentBatch, usePaymentBatches, usePaymentFile,
  useRecordPaymentResults, useSaveBankFileProfile, type BankFileProfile, type PaymentBatch,
} from "@/hooks/use-hr-payments";
import { hrErrorMessage } from "@/lib/hr-error-message";

const STATUS: Record<string, [string, "default" | "outline" | "secondary" | "destructive"]> = {
  draft: ["En préparation", "outline"], approved: ["Approuvé", "secondary"], sent: ["Émis à la banque", "default"], closed: ["Clôturé", "default"],
  cancelled: ["Annulé", "destructive"], pending: ["En attente du retour", "outline"], paid: ["Payé", "default"], rejected: ["Rejeté", "destructive"],
};
const money = (v: number, c: string) => `${Number(v).toLocaleString("fr-FR")} ${c}`;

export default function HrPayments() {
  const { data: access } = useMyAccess();
  const can = (p: string) => (access?.permissions ?? []).includes(p);
  const [tab, setTab] = useState<"batches" | "formats">("batches");
  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH et paie", href: "/hr" }, { label: "Transactions" }, { label: "Paiement des salaires" }]} />
        <TransactionTabsBar module="/hr" />
        <GuidanceBanner title="Paiement des salaires"
          description="Préparez un lot de virement à partir d’un cycle comptabilisé, faites-le approuver par une autre personne, téléchargez le fichier au format de votre banque, puis saisissez les retours : les paiements confirmés soldent le compte des rémunérations dues ; un rejet se repaie dans un nouveau lot." />
        <div className="flex gap-1 border-b border-border" role="tablist" aria-label="Paiement des salaires">
          {([["batches", "Lots de virement"], ["formats", "Formats de fichier bancaire"]] as const).map(([id, label]) =>
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-xs font-medium border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{label}</button>)}
        </div>
        {tab === "batches" && <BatchesTab canPrepare={can("hr.payroll_payment")} canApprove={can("hr.payroll_payment_approve")} />}
        {tab === "formats" && <FormatsTab canManage={can("hr.payroll_settings")} />}
      </div>
    </PageShell>
  );
}

function BatchesTab({ canPrepare, canApprove }: { canPrepare: boolean; canApprove: boolean }) {
  const { data: runs = [] } = usePayrollRuns();
  const { data: accounts = [] } = useTreasuryAccounts();
  const { data: profiles = [] } = useBankFileProfiles();
  const batches = usePaymentBatches();
  const create = useCreatePaymentBatch();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ run_id: "", bank_account_id: "", profile_id: "", payment_date: today, reference: "" });
  const posted = runs.filter((r) => r.status === "posted");
  return <section className="space-y-3">
    {canPrepare && <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select label="Cycle comptabilisé" value={form.run_id} onChange={(v) => setForm({ ...form, run_id: v })}
        options={posted.map((r) => [r.id, `${r.period}${r.run_kind === "regularization" ? " (régularisation)" : ""} · net ${money(r.net_total, r.payroll_currency_code ?? "")}`])} />
      <Select label="Compte bancaire payeur" value={form.bank_account_id} onChange={(v) => setForm({ ...form, bank_account_id: v })}
        options={(accounts as { id: string; name: string; currency: string; account_type: string; is_active: boolean }[])
          .filter((a) => a.account_type === "bank" && a.is_active).map((a) => [a.id, `${a.name} (${a.currency})`])} />
      <Select label="Format de fichier" value={form.profile_id} onChange={(v) => setForm({ ...form, profile_id: v })}
        options={profiles.filter((p) => p.active).map((p) => [p.id!, `${p.label}${p.bank_name ? ` · ${p.bank_name}` : ""}`])} />
      <Field label="Date de paiement" type="date" value={form.payment_date} onChange={(v) => setForm({ ...form, payment_date: v })} />
      <Field label="Référence (facultative)" value={form.reference} onChange={(v) => setForm({ ...form, reference: v })} />
      <div className="pt-5"><Button size="sm" disabled={!form.run_id || !form.bank_account_id || !form.profile_id || !form.payment_date || create.isPending}
        onClick={() => create.mutate({ ...form, reference: form.reference || null })}>Préparer le lot</Button></div>
      {!profiles.length && <p className="text-[11px] text-muted-foreground sm:col-span-3 lg:col-span-6">Décrivez d’abord le format de fichier de votre banque (onglet « Formats de fichier bancaire »).</p>}
    </div>}
    {batches.isError && <p role="alert" className="text-xs text-destructive">Chargement impossible{hrErrorMessage(batches.error) ? ` : ${hrErrorMessage(batches.error)}` : "."}</p>}
    {(batches.data ?? []).map((b) => <BatchCard key={b.id} batch={b} canPrepare={canPrepare} canApprove={canApprove} />)}
    {!batches.isLoading && !(batches.data ?? []).length && <p className="text-xs text-muted-foreground">Aucun lot de virement.</p>}
  </section>;
}

function BatchCard({ batch: b, canPrepare, canApprove }: { batch: PaymentBatch; canPrepare: boolean; canApprove: boolean }) {
  const approve = useApprovePaymentBatch();
  const cancel = useCancelPaymentBatch();
  const file = usePaymentFile();
  const results = useRecordPaymentResults();
  const [reason, setReason] = useState("");
  const [resultDate, setResultDate] = useState(new Date().toISOString().slice(0, 10));
  const [decisions, setDecisions] = useState<Record<string, { status: "paid" | "rejected" | ""; reason: string }>>({});
  const pending = b.lines.filter((l) => l.status === "pending");
  const chosen = Object.entries(decisions).filter(([, d]) => d.status);
  const valid = chosen.length > 0 && chosen.every(([, d]) => d.status === "paid" || d.reason.trim().length >= 3);
  return <article className="space-y-2 rounded-md border border-border bg-card p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><strong className="font-mono">{b.batch_number}</strong> · paie {b.period} · {b.bank_account_name} · {b.profile_label} · paiement le {b.payment_date}
        <div className="text-muted-foreground">{b.line_count} ligne(s) · {money(b.total_amount, b.currency)}{b.file_sha256 ? ` · fichier ${b.file_name} (SHA-256 ${b.file_sha256.slice(0, 12)}…)` : ""}{b.cancelled_reason ? ` · annulé : ${b.cancelled_reason}` : ""}</div></div>
      <Badge variant={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge>
    </div>
    <div className="flex flex-wrap gap-2">
      {canApprove && b.status === "draft" && <Button size="sm" className="h-7 text-xs" disabled={approve.isPending} onClick={() => approve.mutate(b.id)}>Approuver le lot</Button>}
      {canPrepare && (b.status === "approved" || b.status === "sent" || b.status === "closed") &&
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={file.isPending} onClick={() => file.mutate(b.id)}>
          {b.file_sha256 ? "Rééditer le fichier" : "Générer et télécharger le fichier"}</Button>}
      {canPrepare && (b.status === "draft" || b.status === "approved") && <>
        <Input aria-label={`Motif d’annulation ${b.batch_number}`} placeholder="Motif d’annulation" className="h-7 w-44 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate({ id: b.id, reason })}>Annuler le lot</Button></>}
    </div>
    <table className="w-full text-left"><thead><tr className="border-b text-muted-foreground"><th className="p-1">N°</th><th className="p-1">Salarié</th><th className="p-1">Compte</th><th className="p-1 text-right">Montant</th><th className="p-1">État</th>{canPrepare && b.status === "sent" && <th className="p-1">Retour de la banque</th>}</tr></thead>
      <tbody>{b.lines.map((l) => <tr key={l.id} className="border-b border-border/60">
        <td className="p-1">{l.line_number}</td><td className="p-1">{l.matricule} · {l.beneficiary_name}</td><td className="p-1 font-mono">{l.bank_account}</td>
        <td className="p-1 text-right">{money(l.amount, b.currency)}</td>
        <td className="p-1"><Badge variant={STATUS[l.status][1]}>{STATUS[l.status][0]}</Badge>{l.rejection_reason ? <div className="text-muted-foreground">{l.rejection_reason}</div> : null}</td>
        {canPrepare && b.status === "sent" && <td className="p-1">{l.status === "pending" && <span className="flex gap-1">
          <select aria-label={`Retour ligne ${l.line_number}`} className="h-7 rounded-md border border-input bg-background px-1 text-xs" value={decisions[l.id]?.status ?? ""}
            onChange={(e) => setDecisions((d) => ({ ...d, [l.id]: { status: e.target.value as "paid" | "rejected" | "", reason: d[l.id]?.reason ?? "" } }))}>
            <option value="">—</option><option value="paid">Payé</option><option value="rejected">Rejeté</option></select>
          {decisions[l.id]?.status === "rejected" && <Input aria-label={`Motif du rejet ligne ${l.line_number}`} placeholder="Motif du rejet" className="h-7 w-36 text-xs"
            value={decisions[l.id]?.reason ?? ""} onChange={(e) => setDecisions((d) => ({ ...d, [l.id]: { status: "rejected", reason: e.target.value } }))} />}
        </span>}</td>}
      </tr>)}</tbody></table>
    {canPrepare && b.status === "sent" && pending.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <Field label="Date du retour bancaire" type="date" value={resultDate} onChange={setResultDate} />
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDecisions(Object.fromEntries(pending.map((l) => [l.id, { status: "paid" as const, reason: "" }])))}>Tout marquer payé</Button>
      <Button size="sm" className="h-8 text-xs" disabled={!valid || results.isPending}
        onClick={() => results.mutate({ id: b.id, result_date: resultDate, results: chosen.map(([id, d]) => ({ line_id: id, status: d.status as "paid" | "rejected", reason: d.reason || undefined })) },
          { onSuccess: () => setDecisions({}) })}>Enregistrer les retours</Button>
    </div>}
  </article>;
}

function FormatsTab({ canManage }: { canManage: boolean }) {
  const { data: profiles = [] } = useBankFileProfiles();
  const save = useSaveBankFileProfile();
  const empty: BankFileProfile = { code: "", label: "", bank_name: null, format_version: null, encoding: "UTF-8", separator: ";", header_row: true,
    date_format: "DD/MM/YYYY", decimal_separator: ",", amount_decimals: 0,
    columns: [{ header: "Matricule", field: "matricule" }, { header: "Bénéficiaire", field: "employee_name" }, { header: "RIB", field: "bank_account" }, { header: "Montant", field: "amount" }],
    notes: null, active: true };
  const [form, setForm] = useState<BankFileProfile>(empty);
  const setColumn = (i: number, patch: Partial<BankFileProfile["columns"][number]>) =>
    setForm({ ...form, columns: form.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return <section className="space-y-3">
    <p className="text-[11px] text-muted-foreground">Aucun format bancaire n’est présumé : décrivez le gabarit fourni par votre banque (ordre des colonnes, séparateur, encodage, dates, montants), puis vérifiez le premier fichier avec elle.</p>
    {canManage && <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Code du format" value={form.code} onChange={(v) => setForm({ ...form, code: v.toLowerCase().replace(/[^a-z0-9._-]/g, "") })} />
        <Field label="Libellé du format" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
        <Field label="Banque" value={form.bank_name ?? ""} onChange={(v) => setForm({ ...form, bank_name: v || null })} />
        <Field label="Version du gabarit" value={form.format_version ?? ""} onChange={(v) => setForm({ ...form, format_version: v || null })} />
        <Select label="Séparateur" value={form.separator} onChange={(v) => setForm({ ...form, separator: (v || ";") as BankFileProfile["separator"] })}
          options={[[";", "Point-virgule"], [",", "Virgule"], ["|", "Barre verticale"], ["TAB", "Tabulation"]]} />
        <Select label="Encodage" value={form.encoding} onChange={(v) => setForm({ ...form, encoding: (v || "UTF-8") as BankFileProfile["encoding"] })}
          options={[["UTF-8", "UTF-8"], ["ISO-8859-1", "ISO-8859-1 (Latin-1)"], ["WINDOWS-1252", "Windows-1252"]]} />
        <Select label="Format de date" value={form.date_format} onChange={(v) => setForm({ ...form, date_format: (v || "DD/MM/YYYY") as BankFileProfile["date_format"] })}
          options={[["DD/MM/YYYY", "JJ/MM/AAAA"], ["YYYY-MM-DD", "AAAA-MM-JJ"], ["DDMMYYYY", "JJMMAAAA"], ["YYYYMMDD", "AAAAMMJJ"]]} />
        <Select label="Séparateur décimal" value={form.decimal_separator} onChange={(v) => setForm({ ...form, decimal_separator: (v || ",") as BankFileProfile["decimal_separator"] })}
          options={[[",", "Virgule"], [".", "Point"]]} />
        <Field label="Décimales du montant" type="number" value={String(form.amount_decimals)} onChange={(v) => setForm({ ...form, amount_decimals: Math.min(3, Math.max(0, Number(v) || 0)) })} />
        <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" checked={form.header_row} onChange={(e) => setForm({ ...form, header_row: e.target.checked })} />Ligne d’en-tête</label>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h4 className="text-xs font-medium">Colonnes, dans l’ordre du fichier</h4>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm({ ...form, columns: [...form.columns, { header: "", field: "matricule" }] })}>Ajouter une colonne</Button></div>
        {form.columns.map((c, i) => <div key={i} className="grid max-w-3xl grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
          <Field label={`En-tête ${i + 1}`} value={c.header} onChange={(v) => setColumn(i, { header: v })} />
          <Select label="Contenu" value={c.field ?? "__value"} onChange={(v) => setColumn(i, v === "__value" ? { field: undefined, value: c.value ?? "" } : { field: v || "matricule", value: undefined })}
            options={[...FILE_FIELDS, ["__value", "Valeur fixe"]]} />
          {c.field === undefined ? <Field label="Valeur fixe" value={c.value ?? ""} onChange={(v) => setColumn(i, { value: v })} /> : <span />}
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setForm({ ...form, columns: form.columns.filter((_, j) => j !== i) })}>Retirer</Button>
        </div>)}
      </div>
      <div className="flex gap-2"><Button size="sm" disabled={!form.code || !form.label.trim() || save.isPending} onClick={() => save.mutate(form, { onSuccess: () => setForm(empty) })}>{form.id ? "Enregistrer le format" : "Ajouter le format"}</Button>
        {form.id && <Button size="sm" variant="outline" onClick={() => setForm(empty)}>Annuler</Button>}</div>
    </div>}
    <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full text-left text-xs">
      <thead><tr className="border-b text-muted-foreground"><th className="p-2">Format</th><th className="p-2">Banque</th><th className="p-2">Paramètres</th><th className="p-2">Colonnes</th>{canManage && <th className="p-2">Action</th>}</tr></thead>
      <tbody>{profiles.map((p) => <tr key={p.id} className="border-b border-border/60">
        <td className="p-2"><strong>{p.code}</strong><div>{p.label}</div></td><td className="p-2">{p.bank_name ?? "—"}{p.format_version ? ` · v${p.format_version}` : ""}</td>
        <td className="p-2">{p.separator === "TAB" ? "Tabulation" : `« ${p.separator} »`} · {p.encoding} · {p.date_format} · décimale « {p.decimal_separator} » × {p.amount_decimals}</td>
        <td className="p-2">{p.columns.map((c) => c.header).join(" | ")}</td>
        {canManage && <td className="p-2"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm({ ...p })}>Modifier</Button></td>}
      </tr>)}
        {!profiles.length && <tr><td colSpan={canManage ? 5 : 4} className="p-4 text-center text-muted-foreground">Aucun format défini.</td></tr>}</tbody>
    </table></div>
  </section>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" /></div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"><option value="">Choisir…</option>
    {options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>;
}
