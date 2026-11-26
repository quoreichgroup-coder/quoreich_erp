import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCancelMyTimeRequest, useDecideHrTimeRequest, useHrSelfService, useSubmitMyTimeRequest } from "@/hooks/use-hr-time";
import { hrErrorMessage } from "@/lib/hr-error-message";

const STATUS: Record<string, [string, "default" | "outline" | "secondary" | "destructive"]> = {
  pending: ["En attente", "outline"], approved: ["Approuvée", "default"], rejected: ["Rejetée", "destructive"], cancelled: ["Annulée", "secondary"],
};
const unitLabel = (u: string) => (u === "day" ? "jour(s)" : "heure(s)");

/** V153 — libre-service : le salarié rattaché à sa fiche saisit ses demandes et voit ses soldes ; un approbateur désigné décide. */
export default function HrSelfService() {
  const me = useHrSelfService();
  const submit = useSubmitMyTimeRequest();
  const cancel = useCancelMyTimeRequest();
  const decide = useDecideHrTimeRequest();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ type_id: "", start_date: today, end_date: today, quantity: "", reason: "" });
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const data = me.data;
  const type = data?.types.find((t) => t.id === form.type_id);
  const valid = form.type_id && form.start_date && form.end_date >= form.start_date && form.start_date.slice(0, 7) === form.end_date.slice(0, 7)
    && form.reason.trim().length >= 3 && (type?.unit !== "hour" || Number(form.quantity) > 0);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "RH et paie", href: "/hr" }, { label: "Mon espace RH" }]} />
        <GuidanceBanner title="Mon espace RH" description="Vos demandes d’absence et de congé, vos soldes, et les demandes que vous approuvez comme responsable désigné." />
        {me.isError && <p role="alert" className="text-xs text-destructive">Chargement impossible{hrErrorMessage(me.error) ? ` : ${hrErrorMessage(me.error)}` : "."}</p>}
        {data && !data.employee && <p className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          Votre compte n’est rattaché à aucune fiche salarié. Demandez aux RH de le rattacher (Temps et absences → Comptes libre-service).</p>}

        {data?.employee && <section className="space-y-3 rounded-md border border-border bg-card p-3">
          <h2 className="text-sm font-semibold">{data.employee.name} · {data.employee.matricule}</h2>
          <div className="flex flex-wrap gap-2">{data.balances.map((b) => <div key={b.type_id} className="rounded border px-3 py-2 text-xs">
            <div className="text-[10px] uppercase text-muted-foreground">{b.type_label}</div>
            <div className="font-semibold">{Number(b.balance).toLocaleString("fr-FR")} {unitLabel(b.unit)}</div></div>)}</div>
          {data.types.length > 0 ? <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1"><Label className="text-xs" htmlFor="me-type">Type</Label>
              <select id="me-type" aria-label="Type" className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={form.type_id}
                onChange={(e) => setForm({ ...form, type_id: e.target.value })}><option value="">Choisir…</option>
                {data.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <Field label="Du" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
            <Field label="Au" type="date" value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} />
            <Field label={type?.unit === "hour" ? "Nombre d’heures" : "Nombre de jours (vide = décompte automatique)"} type="number" value={form.quantity}
              onChange={(v) => setForm({ ...form, quantity: v })} />
            <Field label="Motif" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            <div className="pt-5"><Button size="sm" disabled={!valid || submit.isPending}
              onClick={() => submit.mutate({ ...form, quantity: form.quantity ? Number(form.quantity) : null }, { onSuccess: () => setForm({ ...form, quantity: "", reason: "" }) })}>
              Envoyer la demande</Button></div>
          </div> : <p className="text-xs text-muted-foreground">Aucun type n’est ouvert au libre-service par les RH.</p>}
          <table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Type</th><th className="p-2">Période</th><th className="p-2">Quantité</th><th className="p-2">État</th><th className="p-2">Action</th></tr></thead>
            <tbody>{data.requests.map((r) => <tr key={r.id} className="border-b border-border/60">
              <td className="p-2">{r.type_label}<div className="text-muted-foreground">{r.reason}{r.decision_reason ? ` · ${r.decision_reason}` : ""}</div></td>
              <td className="p-2">{r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}</td>
              <td className="p-2">{Number(r.quantity).toLocaleString("fr-FR")} {unitLabel(r.unit)}</td>
              <td className="p-2"><Badge variant={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{r.transferred ? <div className="text-[10px] text-muted-foreground">transmise à la paie</div> : null}</td>
              <td className="p-2">{(r.status === "pending" || r.status === "approved") && !r.transferred && <div className="flex gap-1">
                <Input aria-label={`Motif d’annulation ${r.id}`} placeholder="Motif" className="h-7 w-32 text-xs" value={motifs[r.id] ?? ""}
                  onChange={(e) => setMotifs((m) => ({ ...m, [r.id]: e.target.value }))} />
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={cancel.isPending || (motifs[r.id] ?? "").trim().length < 3}
                  onClick={() => cancel.mutate({ id: r.id, reason: motifs[r.id] })}>Annuler</Button></div>}</td>
            </tr>)}
              {!data.requests.length && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">Aucune demande.</td></tr>}
            </tbody></table>
        </section>}

        {data && data.to_approve.length > 0 && <section className="space-y-2 rounded-md border border-border bg-card p-3">
          <h2 className="text-sm font-semibold">À approuver ({data.to_approve.length})</h2>
          {data.to_approve.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-xs">
            <span>{r.matricule} · {r.employee_name} — {r.type_label} du {r.start_date} au {r.end_date} ({Number(r.quantity).toLocaleString("fr-FR")} {unitLabel(r.unit)}) · {r.reason}</span>
            <span className="flex gap-1">
              <Input aria-label={`Motif de décision ${r.id}`} placeholder="Motif (rejet)" className="h-7 w-36 text-xs" value={motifs[r.id] ?? ""}
                onChange={(e) => setMotifs((m) => ({ ...m, [r.id]: e.target.value }))} />
              <Button size="sm" className="h-7 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true, reason: motifs[r.id] || null })}>Approuver</Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={decide.isPending || (motifs[r.id] ?? "").trim().length < 3}
                onClick={() => decide.mutate({ id: r.id, approve: false, reason: motifs[r.id] })}>Rejeter</Button></span>
          </div>)}
        </section>}
      </div>
    </PageShell>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type={type} step={type === "number" ? "any" : undefined}
    value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" /></div>;
}
