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
import { useEmployees, useHrPayrollComponents } from "@/hooks/use-hr-data";
import {
  useAccrueHrLeave, useAdjustHrLeave, useCancelHrTimeRequest, useDecideHrTimeRequest, useHrLeaveBalances, useHrTimeRequests,
  useHrTimeTypes, useSaveHrTimeType, useSubmitHrTimeRequest, type HrTimeType,
  useHrPublicHolidays, useSaveHrPublicHoliday, useDeleteHrPublicHoliday, useHrSelfServiceLinks, useSetHrSelfService, type HrPublicHoliday,
} from "@/hooks/use-hr-time";
import { useTenantProfiles } from "@/hooks/use-rbac-data";
import { hrErrorMessage } from "@/lib/hr-error-message";

const KIND: Record<HrTimeType["kind"], string> = { absence: "Absence", leave: "Congé", overtime: "Heures supplémentaires" };
const STATUS: Record<string, [string, "default" | "outline" | "secondary" | "destructive"]> = {
  pending: ["En attente", "outline"], approved: ["Approuvée", "default"], rejected: ["Rejetée", "destructive"], cancelled: ["Annulée", "secondary"],
};
const TABS = [["requests", "Demandes"], ["balances", "Soldes de congés"], ["types", "Types et paramétrage"],
  ["holidays", "Jours fériés"], ["links", "Comptes libre-service"]] as const;
const APPROVAL: Record<string, string> = { officer: "Responsable des congés (droit RH)", manager: "Approbateur du salarié", none: "Sans validation" };
const unitLabel = (u: string) => (u === "day" ? "jour(s)" : "heure(s)");

export default function HrTime() {
  const { data: access } = useMyAccess();
  const permissions = access?.permissions ?? [];
  const can = (p: string) => permissions.includes(p);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("requests");
  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH et paie", href: "/hr" }, { label: "Transactions" }, { label: "Temps et absences" }]} />
        <TransactionTabsBar module="/hr" />
        <GuidanceBanner title="Temps et absences"
          description="Absences, congés et heures supplémentaires : saisis, approuvés par une autre personne, puis transmis au cycle de paie du mois (bouton « Reprendre les temps approuvés » du cycle). Les durées légales et majorations se paramètrent dans les types et les rubriques ; rien n’est prérempli." />
        <div className="flex gap-1 border-b border-border" role="tablist" aria-label="Temps et absences">
          {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{label}</button>)}
        </div>
        {tab === "requests" && <RequestsTab canSubmit={can("hr.time_request")} canDecide={can("hr.time_approve")} />}
        {tab === "balances" && <BalancesTab canManage={can("hr.time_settings")} />}
        {tab === "types" && <TypesTab canManage={can("hr.time_settings")} />}
        {tab === "holidays" && <HolidaysTab canManage={can("hr.time_settings")} />}
        {tab === "links" && <LinksTab canManage={can("hr.manage_employees")} />}
      </div>
    </PageShell>
  );
}

function RequestsTab({ canSubmit, canDecide }: { canSubmit: boolean; canDecide: boolean }) {
  const { data: employees = [] } = useEmployees();
  const { data: types = [] } = useHrTimeTypes();
  const requests = useHrTimeRequests();
  const submit = useSubmitHrTimeRequest();
  const decide = useDecideHrTimeRequest();
  const cancel = useCancelHrTimeRequest();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ employee_id: "", type_id: "", start_date: today, end_date: today, quantity: "", reason: "" });
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const type = types.find((t) => t.id === form.type_id);
  const valid = form.employee_id && form.type_id && form.start_date && form.end_date && form.end_date >= form.start_date
    && form.start_date.slice(0, 7) === form.end_date.slice(0, 7) && form.reason.trim().length >= 3
    && (type?.unit !== "hour" || Number(form.quantity) > 0);
  return <section className="space-y-3">
    {canSubmit && <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select label="Salarié" value={form.employee_id} onChange={(v) => setForm({ ...form, employee_id: v })}
        options={employees.filter((e) => e.status === "active").map((e) => [e.id, `${e.matricule} · ${e.first_name} ${e.last_name}`])} />
      <Select label="Type" value={form.type_id} onChange={(v) => setForm({ ...form, type_id: v })}
        options={types.filter((t) => t.active).map((t) => [t.id!, `${t.label} (${KIND[t.kind]})`])} />
      <Field label="Du" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
      <Field label="Au" type="date" value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} />
      <Field label={type?.unit === "hour" ? "Nombre d’heures" : "Nombre de jours (vide = décompte automatique)"} type="number" value={form.quantity}
        onChange={(v) => setForm({ ...form, quantity: v })} />
      <Field label="Motif" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
      <div className="sm:col-span-3 lg:col-span-6 flex items-center gap-3">
        <Button size="sm" disabled={!valid || submit.isPending} onClick={() => submit.mutate({ ...form, quantity: form.quantity ? Number(form.quantity) : null },
          { onSuccess: () => setForm({ ...form, quantity: "", reason: "" }) })}>Enregistrer la demande</Button>
        <span className="text-[11px] text-muted-foreground">Une demande porte sur un seul mois ; un congé à cheval sur deux mois se saisit en deux demandes.</span>
      </div>
    </div>}
    {requests.isError && <p role="alert" className="text-xs text-destructive">Chargement impossible{hrErrorMessage(requests.error) ? ` : ${hrErrorMessage(requests.error)}` : "."}</p>}
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b text-muted-foreground"><th className="p-2">Salarié</th><th className="p-2">Type</th><th className="p-2">Période</th><th className="p-2">Quantité</th><th className="p-2">Motif</th><th className="p-2">État</th><th className="p-2">Paie</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{(requests.data ?? []).map((r) => <tr key={r.id} className="border-b border-border/60 align-top">
          <td className="p-2">{r.matricule} · {r.employee_name}</td><td className="p-2">{r.type_label}</td>
          <td className="p-2">{r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}</td>
          <td className="p-2">{Number(r.quantity).toLocaleString("fr-FR")} {unitLabel(r.unit)}</td>
          <td className="p-2 max-w-[220px]">{r.reason}{r.decision_reason ? <div className="text-muted-foreground">Décision : {r.decision_reason}</div> : null}</td>
          <td className="p-2"><Badge variant={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
          <td className="p-2">{r.payroll_period ? `Cycle ${r.payroll_period}` : "—"}</td>
          <td className="p-2"><div className="flex flex-wrap items-center gap-1">
            {(r.status === "pending" || (r.status === "approved" && !r.payroll_run_id)) && (canDecide || canSubmit) &&
              <Input aria-label={`Motif ${r.id}`} placeholder="Motif (rejet / annulation)" className="h-7 w-40 text-xs"
                value={motifs[r.id] ?? ""} onChange={(e) => setMotifs((m) => ({ ...m, [r.id]: e.target.value }))} />}
            {canDecide && r.status === "pending" && <>
              <Button size="sm" className="h-7 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true, reason: motifs[r.id] || null })}>Approuver</Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={decide.isPending || (motifs[r.id] ?? "").trim().length < 3}
                onClick={() => decide.mutate({ id: r.id, approve: false, reason: motifs[r.id] })}>Rejeter</Button></>}
            {(canSubmit || canDecide) && (r.status === "pending" || (r.status === "approved" && !r.payroll_run_id)) &&
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={cancel.isPending || (motifs[r.id] ?? "").trim().length < 3}
                onClick={() => cancel.mutate({ id: r.id, reason: motifs[r.id] })}>Annuler</Button>}
          </div></td>
        </tr>)}
          {!requests.isLoading && !(requests.data ?? []).length && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Aucune demande.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function BalancesTab({ canManage }: { canManage: boolean }) {
  const balances = useHrLeaveBalances();
  const { data: employees = [] } = useEmployees();
  const { data: types = [] } = useHrTimeTypes();
  const accrue = useAccrueHrLeave();
  const adjust = useAdjustHrLeave();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const today = new Date().toISOString().slice(0, 10);
  const [adj, setAdj] = useState({ employee_id: "", type_id: "", quantity: "", entry_date: today, note: "" });
  return <section className="space-y-3">
    {canManage && <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
      <Field label="Mois d’acquisition (AAAA-MM)" value={period} onChange={setPeriod} />
      <div className="pt-5"><Button size="sm" variant="outline" disabled={!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || accrue.isPending}
        onClick={() => accrue.mutate(period)}>Acquérir les congés du mois</Button></div>
      <Select label="Salarié (ajustement)" value={adj.employee_id} onChange={(v) => setAdj({ ...adj, employee_id: v })}
        options={employees.map((e) => [e.id, `${e.matricule} · ${e.first_name} ${e.last_name}`])} />
      <Select label="Type à solde" value={adj.type_id} onChange={(v) => setAdj({ ...adj, type_id: v })}
        options={types.filter((t) => t.tracks_balance).map((t) => [t.id!, t.label])} />
      <Field label="Quantité (+ ou −)" type="number" value={adj.quantity} onChange={(v) => setAdj({ ...adj, quantity: v })} />
      <Field label="Motif de l’ajustement" value={adj.note} onChange={(v) => setAdj({ ...adj, note: v })} />
      <div className="lg:col-span-6"><Button size="sm" variant="outline" disabled={!adj.employee_id || !adj.type_id || !Number(adj.quantity) || adj.note.trim().length < 3 || adjust.isPending}
        onClick={() => adjust.mutate({ ...adj, quantity: Number(adj.quantity) }, { onSuccess: () => setAdj({ ...adj, quantity: "", note: "" }) })}>Ajuster le solde</Button></div>
    </div>}
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b text-muted-foreground"><th className="p-2">Salarié</th><th className="p-2">Type</th><th className="p-2 text-right">Acquis</th><th className="p-2 text-right">Pris</th><th className="p-2 text-right">Solde</th></tr></thead>
        <tbody>{(balances.data ?? []).map((b) => <tr key={`${b.employee_id}-${b.type_id}`} className="border-b border-border/60">
          <td className="p-2">{b.matricule} · {b.employee_name}</td><td className="p-2">{b.type_label}</td>
          <td className="p-2 text-right">{Number(b.acquired).toLocaleString("fr-FR")}</td><td className="p-2 text-right">{Number(b.taken).toLocaleString("fr-FR")}</td>
          <td className={`p-2 text-right font-semibold ${Number(b.balance) < 0 ? "text-destructive" : ""}`}>{Number(b.balance).toLocaleString("fr-FR")} {unitLabel(b.unit)}</td>
        </tr>)}
          {!balances.isLoading && !(balances.data ?? []).length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Aucun type à solde, ou aucun salarié concerné.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function TypesTab({ canManage }: { canManage: boolean }) {
  const { data: types = [] } = useHrTimeTypes();
  const { data: components = [] } = useHrPayrollComponents(false);
  const save = useSaveHrTimeType();
  const empty: HrTimeType = { code: "", label: "", kind: "absence", unit: "day", count_method: "working", component_id: null,
    tracks_balance: false, accrual_per_month: null, allow_negative_balance: false, requires_second_person: true, active: true, sort_order: 0,
    include_public_holidays: false, accrual_from: null, accrual_prorata: false, self_service: false, approval_mode: "officer" };
  const [form, setForm] = useState<HrTimeType>(empty);
  const quantityComponents = components.filter((c) => c.calculation_method === "quantity_rate" || c.calculation_method === "formula");
  return <section className="space-y-3">
    {canManage && <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Code du type" value={form.code} onChange={(v) => setForm({ ...form, code: v.toLowerCase().replace(/[^a-z0-9._-]/g, "") })} />
      <Field label="Libellé du type" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
      <Select label="Nature" value={form.kind} onChange={(v) => setForm({ ...form, kind: v as HrTimeType["kind"] })} options={Object.entries(KIND)} />
      <Select label="Unité" value={form.unit} onChange={(v) => setForm({ ...form, unit: v as HrTimeType["unit"] })} options={[["day", "Jour"], ["hour", "Heure"]]} />
      {form.unit === "day" && <Select label="Décompte des jours" value={form.count_method} onChange={(v) => setForm({ ...form, count_method: v as HrTimeType["count_method"] })}
        options={[["working", "Jours ouvrés (lundi-vendredi)"], ["calendar", "Jours calendaires"]]} />}
      <Select label="Rubrique de paie (quantité × taux ou formule)" value={form.component_id ?? ""} onChange={(v) => setForm({ ...form, component_id: v || null })}
        options={[["", "Aucune (sans effet sur la paie)"], ...quantityComponents.map((c) => [c.id, `${c.code} · ${c.label}`] as [string, string])]} />
      <Check label="Suivre un solde" checked={form.tracks_balance} onChange={(v) => setForm({ ...form, tracks_balance: v, accrual_per_month: v ? form.accrual_per_month : null })} />
      {form.tracks_balance && <Field label="Acquisition par mois (facultatif)" type="number" value={form.accrual_per_month == null ? "" : String(form.accrual_per_month)}
        onChange={(v) => setForm({ ...form, accrual_per_month: v ? Number(v) : null })} />}
      {form.tracks_balance && <Check label="Solde négatif autorisé" checked={form.allow_negative_balance} onChange={(v) => setForm({ ...form, allow_negative_balance: v })} />}
      {form.tracks_balance && form.accrual_per_month != null && <Field label="Acquisition automatique à partir du (vide = manuelle)" type="date"
        value={form.accrual_from ?? ""} onChange={(v) => setForm({ ...form, accrual_from: v || null })} />}
      {form.tracks_balance && form.accrual_per_month != null && <Check label="Au prorata des jours de présence" checked={!!form.accrual_prorata}
        onChange={(v) => setForm({ ...form, accrual_prorata: v })} />}
      {form.unit === "day" && <Check label="Compter les jours fériés dans la durée" checked={!!form.include_public_holidays}
        onChange={(v) => setForm({ ...form, include_public_holidays: v })} />}
      <Check label="Ouvert au libre-service (le salarié le demande)" checked={!!form.self_service} onChange={(v) => setForm({ ...form, self_service: v })} />
      <Select label="Approbation" value={form.approval_mode ?? "officer"} onChange={(v) => setForm({ ...form, approval_mode: (v || "officer") as HrTimeType["approval_mode"] })}
        options={Object.entries(APPROVAL)} />
      <Check label="Approbation par une autre personne" checked={form.requires_second_person} onChange={(v) => setForm({ ...form, requires_second_person: v })} />
      <Check label="Actif" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
      <div className="sm:col-span-3 lg:col-span-6 flex gap-2">
        <Button size="sm" disabled={!form.code || !form.label.trim() || save.isPending} onClick={() => save.mutate(form, { onSuccess: () => setForm(empty) })}>{form.id ? "Enregistrer le type" : "Ajouter le type"}</Button>
        {form.id && <Button size="sm" variant="outline" onClick={() => setForm(empty)}>Annuler</Button>}
      </div>
    </div>}
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b text-muted-foreground"><th className="p-2">Type</th><th className="p-2">Nature</th><th className="p-2">Unité / décompte</th><th className="p-2">Rubrique de paie</th><th className="p-2">Solde</th><th className="p-2">État</th>{canManage && <th className="p-2">Action</th>}</tr></thead>
        <tbody>{types.map((t) => <tr key={t.id} className="border-b border-border/60">
          <td className="p-2"><strong>{t.code}</strong><div>{t.label}</div></td><td className="p-2">{KIND[t.kind]}</td>
          <td className="p-2">{t.unit === "day" ? `Jour · ${t.count_method === "working" ? "ouvrés" : "calendaires"}` : "Heure"}</td>
          <td className="p-2">{t.component_code ? `${t.component_code} · ${t.component_label}` : "—"}</td>
          <td className="p-2">{t.tracks_balance ? `Oui${t.accrual_per_month ? ` · ${t.accrual_per_month} / mois` : ""}${t.accrual_from ? ` · auto depuis ${t.accrual_from}${t.accrual_prorata ? " (prorata)" : ""}` : ""}${t.allow_negative_balance ? " · négatif admis" : ""}` : "Non"}
            <div className="text-[10px] text-muted-foreground">{APPROVAL[t.approval_mode ?? "officer"]}{t.self_service ? " · libre-service" : ""}{t.include_public_holidays ? " · fériés comptés" : ""}</div></td>
          <td className="p-2"><Badge variant={t.active ? "default" : "outline"}>{t.active ? "Actif" : "Inactif"}</Badge></td>
          {canManage && <td className="p-2"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm({ ...t })}>Modifier</Button></td>}
        </tr>)}
          {!types.length && <tr><td colSpan={canManage ? 7 : 6} className="p-4 text-center text-muted-foreground">Aucun type défini : créez par exemple « Congé payé », « Absence non payée », « Heures supplémentaires ».</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function HolidaysTab({ canManage }: { canManage: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const calendar = useHrPublicHolidays(year);
  const save = useSaveHrPublicHoliday();
  const remove = useDeleteHrPublicHoliday();
  const empty: HrPublicHoliday = { label: "", holiday_date: null, recurring_month: null, recurring_day: null, move_if_sunday: false, reference: null, active: true };
  const [form, setForm] = useState<HrPublicHoliday>(empty);
  const [recurring, setRecurring] = useState(false);
  const valid = form.label.trim() && (recurring ? !!form.recurring_month && !!form.recurring_day : !!form.holiday_date);
  return <section className="space-y-3">
    <p className="text-[11px] text-muted-foreground">Les jours fériés sont exclus de la durée des congés et absences (sauf pour les types qui les comptent). Aucun n’est prérempli :
      saisissez les fêtes à date fixe une fois (récurrentes) et les fêtes religieuses à leur date annoncée chaque année. Citez la source (loi, communiqué).</p>
    {canManage && <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Libellé du férié" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
      <Check label="Revient chaque année (jour / mois)" checked={recurring} onChange={(v) => { setRecurring(v); setForm({ ...form, holiday_date: null, recurring_month: null, recurring_day: null }); }} />
      {recurring ? <>
        <Field label="Jour" type="number" value={form.recurring_day == null ? "" : String(form.recurring_day)} onChange={(v) => setForm({ ...form, recurring_day: v ? Number(v) : null })} />
        <Select label="Mois" value={form.recurring_month == null ? "" : String(form.recurring_month)} onChange={(v) => setForm({ ...form, recurring_month: v ? Number(v) : null })}
          options={MONTHS.map((m, i) => [String(i + 1), m] as [string, string])} />
      </> : <Field label="Date du férié" type="date" value={form.holiday_date ?? ""} onChange={(v) => setForm({ ...form, holiday_date: v || null })} />}
      <Check label="Reporté au lundi s’il tombe un dimanche" checked={form.move_if_sunday} onChange={(v) => setForm({ ...form, move_if_sunday: v })} />
      <Field label="Source (loi, communiqué)" value={form.reference ?? ""} onChange={(v) => setForm({ ...form, reference: v || null })} />
      <div className="sm:col-span-3 lg:col-span-6"><Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(form, { onSuccess: () => setForm(empty) })}>Ajouter le jour férié</Button></div>
    </div>}
    <div className="flex items-center gap-2"><Label className="text-xs">Année</Label>
      <Input aria-label="Année du calendrier" type="number" value={String(year)} onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} className="h-8 w-24 text-xs" /></div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md border border-border bg-card p-3"><h4 className="mb-2 text-xs font-medium">Calendrier {year}</h4>
        <ul className="space-y-1 text-xs">{(calendar.data?.dates ?? []).map((d) => <li key={d.date + d.label}><span className="font-mono">{d.date}</span> · {d.label}</li>)}
          {!(calendar.data?.dates ?? []).length && <li className="text-muted-foreground">Aucun jour férié cette année.</li>}</ul></div>
      <div className="rounded-md border border-border bg-card p-3"><h4 className="mb-2 text-xs font-medium">Définitions</h4>
        <ul className="space-y-1 text-xs">{(calendar.data?.definitions ?? []).map((h) => <li key={h.id} className="flex items-center justify-between gap-2">
          <span>{h.label} — {h.holiday_date ?? `${h.recurring_day} ${MONTHS[(h.recurring_month ?? 1) - 1]} (chaque année)`}{h.move_if_sunday ? " · report du dimanche" : ""}{h.reference ? ` · ${h.reference}` : ""}</span>
          {canManage && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => remove.mutate(h.id!)}>Supprimer</Button>}</li>)}</ul></div>
    </div>
  </section>;
}

function LinksTab({ canManage }: { canManage: boolean }) {
  const links = useHrSelfServiceLinks(canManage);
  const { data: profiles = [] } = useTenantProfiles();
  const set = useSetHrSelfService();
  const [draft, setDraft] = useState<Record<string, { user: string; approver: string }>>({});
  if (!canManage) return <p className="text-xs text-muted-foreground">Le rattachement des comptes demande le droit « Gérer les salariés ».</p>;
  const users = profiles.map((p) => [p.id, p.full_name || p.id.slice(0, 8)] as [string, string]);
  return <section className="space-y-2">
    <p className="text-[11px] text-muted-foreground">Rattachez le compte utilisateur d’un salarié à sa fiche : il saisit alors ses demandes et voit ses soldes dans « Mon espace RH ».
      L’approbateur désigné décide les demandes des types en mode « Approbateur du salarié ».</p>
    <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full text-left text-xs">
      <thead><tr className="border-b text-muted-foreground"><th className="p-2">Salarié</th><th className="p-2">Compte</th><th className="p-2">Approbateur</th><th className="p-2">Action</th></tr></thead>
      <tbody>{(links.data ?? []).map((l) => {
        const d = draft[l.employee_id] ?? { user: l.user_id ?? "", approver: l.approver_user_id ?? "" };
        return <tr key={l.employee_id} className="border-b border-border/60">
          <td className="p-2">{l.matricule} · {l.employee_name}</td>
          <td className="p-2"><Select label={`Compte de ${l.matricule}`} value={d.user} onChange={(v) => setDraft((x) => ({ ...x, [l.employee_id]: { ...d, user: v } }))} options={users} /></td>
          <td className="p-2"><Select label={`Approbateur de ${l.matricule}`} value={d.approver} onChange={(v) => setDraft((x) => ({ ...x, [l.employee_id]: { ...d, approver: v } }))} options={users} /></td>
          <td className="p-2"><Button size="sm" variant="outline" className="h-7 text-xs" disabled={set.isPending}
            onClick={() => set.mutate({ employee_id: l.employee_id, user_id: d.user || null, approver_user_id: d.approver || null })}>Enregistrer</Button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} step={type === "number" ? "any" : undefined}
    value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" /></div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"><option value="">Choisir…</option>
    {options.filter(([k]) => k !== "").map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
