import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { useMyAccess } from "@/hooks/use-my-access";
import { useRfqAction, useRfqDetail, useRfqs } from "@/hooks/use-rfq";
import { awardIssues, defaultChoices, needsReason, RFQ_STATUS, type RfqChoice, type RfqOffer } from "@/lib/rfq";

/*
 * Demandes de prix et comparatif fournisseurs (V139) : consultation de plusieurs fournisseurs, saisie de leurs offres,
 * comparatif par ligne au cours du jour, attribution (moins-disant proposé, motif sinon) qui crée les commandes.
 */
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function RfqPanel({ suppliers, requisitions }: { suppliers: any[]; requisitions: any[] }) {
  const rfqs = useRfqs();
  const perms = useMyAccess().data?.permissions ?? [];
  const canRfq = perms.includes("procurement.rfq");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = rfqs.data ?? [];
  const current = list.find((r) => r.id === selected) ?? null;
  return (
    <div className="space-y-3" data-testid="rfq-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Consultez plusieurs fournisseurs, comparez leurs offres et attribuez : les commandes sont créées en brouillon.</p>
        {canRfq && <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setCreating(true)} data-testid="rfq-new"><Plus className="w-3 h-3" />Nouvelle demande de prix</Button>}
      </div>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground"><tr><th className="text-left p-2">N°</th><th className="text-left">Objet</th><th className="text-left">Demande d'achat</th>
            <th className="text-left">Réponse attendue</th><th className="text-right">Lignes</th><th className="text-right">Offres / consultés</th><th className="text-left pr-2">Statut</th></tr></thead>
          <tbody>
            {rfqs.isPending && <tr><td colSpan={7} className="p-3"><Loader2 className="w-4 h-4 animate-spin" /></td></tr>}
            {!rfqs.isPending && list.length === 0 && <tr><td colSpan={7} className="p-3 text-muted-foreground">Aucune demande de prix.</td></tr>}
            {list.map((r) => (
              <tr key={r.id} data-testid="rfq-row" className={`border-t border-border/50 cursor-pointer hover:bg-muted/30 ${selected === r.id ? "bg-primary/5" : ""}`} onClick={() => setSelected(r.id)}>
                <td className="p-2 font-mono">{r.rfq_number}</td><td>{r.title}</td><td>{r.pr_number ?? "—"}</td><td>{r.response_due ?? "—"}</td>
                <td className="text-right">{r.line_count}</td><td className="text-right">{r.response_count} / {r.supplier_count}</td>
                <td className="pr-2"><StatusBadge status={r.status} label={RFQ_STATUS[r.status] ?? r.status} /></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {current && <RfqDetail rfq={current} suppliers={suppliers} perms={perms} />}
      {creating && <CreateRfqDialog suppliers={suppliers} requisitions={requisitions} onClose={(id) => { setCreating(false); if (id) setSelected(id); }} />}
    </div>
  );
}

function CreateRfqDialog({ suppliers, requisitions, onClose }: { suppliers: any[]; requisitions: any[]; onClose: (id?: string) => void }) {
  const create = useRfqAction("create_rfq", () => "Demande de prix créée");
  const [title, setTitle] = useState("");
  const [pr, setPr] = useState("");
  const [due, setDue] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: "1" }]);
  const [chosen, setChosen] = useState<string[]>([]);
  const approved = requisitions.filter((r) => r.status === "approved" && !r.po_id);
  const active = suppliers.filter((s) => s.status !== "inactive");
  const free = lines.filter((l) => l.description.trim() && Number(l.quantity.replace(",", ".")) > 0);
  const submit = () => create.mutate({
    _title: title.trim() || null, _requisition: pr || null, _response_due: due || null,
    _lines: pr ? null : free.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity.replace(",", ".")) })),
    _suppliers: chosen.length ? chosen : null,
  }, { onSuccess: (id: any) => onClose(String(id)) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Nouvelle demande de prix</DialogTitle></DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs" htmlFor="rfq-title">Objet</Label><Input id="rfq-title" className="h-8 text-xs" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="rfq-due">Réponse attendue le</Label><Input id="rfq-due" type="date" className="h-8 text-xs" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="rfq-pr">Demande d'achat approuvée (reprend ses lignes)</Label>
            <select id="rfq-pr" className="h-8 w-full px-2 rounded-md border border-input bg-background text-xs" value={pr} onChange={(e) => setPr(e.target.value)}>
              <option value="">— Aucune : lignes saisies ci-dessous —</option>
              {approved.map((r) => <option key={r.id} value={r.id}>{r.pr_number} · {r.description ?? ""}</option>)}</select></div>
          {!pr && (
            <div className="space-y-1">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Désignation ligne ${i + 1}`} className="h-8 text-xs flex-1" placeholder="Désignation" value={l.description}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input aria-label={`Quantité ligne ${i + 1}`} className="h-8 text-xs w-24 text-right" inputMode="decimal" value={l.quantity}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                </div>))}
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLines([...lines, { description: "", quantity: "1" }])}>+ Ajouter une ligne</Button>
            </div>
          )}
          <fieldset className="space-y-1"><legend className="font-medium">Fournisseurs consultés</legend>
            <p className="text-muted-foreground">Sans choix : les fournisseurs du catalogue des articles demandés.</p>
            <div className="max-h-40 overflow-y-auto grid grid-cols-2 gap-1">{active.map((s) => (
              <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={chosen.includes(s.id)}
                onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />{s.name}</label>))}</div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onClose()}>Annuler</Button>
          <Button size="sm" disabled={create.isPending || (!pr && free.length === 0)} onClick={submit} data-testid="rfq-create">Créer la demande</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RfqDetail({ rfq, suppliers, perms }: { rfq: any; suppliers: any[]; perms: string[] }) {
  const { lines, suppliers: consulted, comparison, awards } = useRfqDetail(rfq.id);
  const canRfq = perms.includes("procurement.rfq");
  const canAward = perms.includes("procurement.rfq_award");
  const send = useRfqAction("rfq_send", () => "Demande de prix envoyée : saisissez les offres reçues");
  const cancel = useRfqAction("rfq_cancel", () => "Demande de prix annulée");
  const setSuppliers = useRfqAction("rfq_set_suppliers", (n) => `${n} fournisseur(s) consulté(s)`);
  const award = useRfqAction("award_rfq", (r) => `Attribuée : ${(r?.purchase_orders ?? []).length} commande(s) brouillon créée(s)`);
  const [quoting, setQuoting] = useState<any | null>(null);
  const [adding, setAdding] = useState("");
  const offers = (comparison.data ?? []) as RfqOffer[];
  const lineIds = (lines.data ?? []).map((l: any) => l.id as string);
  const proposed = useMemo(() => defaultChoices(offers, lineIds), [offers, lineIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choices, setChoices] = useState<Record<string, RfqChoice>>({});
  const effective = { ...proposed, ...choices };
  const issues = awardIssues(offers, lineIds, effective);
  const supplierIds = (consulted.data ?? []).map((s: any) => s.supplier_id);
  const editable = rfq.status === "draft" || rfq.status === "sent";
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4 text-xs" data-testid="rfq-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">{rfq.rfq_number} — {rfq.title} <span className="font-normal text-muted-foreground">· {RFQ_STATUS[rfq.status]}</span></h3>
        {canRfq && rfq.status === "draft" && <Button size="sm" className="h-8 text-xs" disabled={send.isPending} onClick={() => send.mutate({ _rfq: rfq.id })} data-testid="rfq-send">Envoyer la demande</Button>}
        {canRfq && editable && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={cancel.isPending}
          onClick={() => { const reason = window.prompt("Motif de l'annulation de la demande de prix :"); if (reason && reason.trim()) cancel.mutate({ _rfq: rfq.id, _reason: reason.trim() }); }}>Annuler</Button>}
      </div>
      <section className="space-y-1"><p className="font-medium">Lignes</p>
        <table className="w-full"><tbody>{(lines.data ?? []).map((l: any) => (
          <tr key={l.id} className="border-t border-border/50"><td className="py-1 w-8">{l.line_no}</td><td>{l.description}</td><td className="text-right tabular-nums">{fmt(l.quantity)}</td></tr>))}</tbody></table>
      </section>
      <section className="space-y-1"><p className="font-medium">Fournisseurs consultés</p>
        <table className="w-full"><tbody>{(consulted.data ?? []).map((s: any) => (
          <tr key={s.id} className="border-t border-border/50" data-testid="rfq-supplier-row">
            <td className="py-1">{s.supplier_name}</td>
            <td>{s.status === "responded" ? "Offre reçue" : s.status === "declined" ? "A décliné" : "Consulté"}{s.currency ? ` · ${s.currency}` : ""}{s.valid_until ? ` · valable au ${s.valid_until}` : ""}</td>
            <td className="text-right">{canRfq && rfq.status === "sent" && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setQuoting(s)} data-testid="rfq-enter-quote">Saisir l'offre</Button>}</td>
          </tr>))}</tbody></table>
        {canRfq && editable && (
          <div className="flex gap-2 items-end">
            <select aria-label="Ajouter un fournisseur à consulter" className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">+ Consulter un autre fournisseur</option>
              {suppliers.filter((s) => s.status !== "inactive" && !supplierIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!adding || setSuppliers.isPending}
              onClick={() => setSuppliers.mutate({ _rfq: rfq.id, _suppliers: [...supplierIds, adding] }, { onSuccess: () => setAdding("") })}>Ajouter</Button>
          </div>
        )}
      </section>
      {offers.length > 0 && (
        <section className="space-y-1" data-testid="rfq-comparison"><p className="font-medium">Comparatif (prix convertis au cours du jour, XOF)</p>
          <table className="w-full">
            <thead className="text-muted-foreground"><tr><th className="text-left">Ligne</th><th className="text-left">Fournisseur</th><th className="text-right">Prix offert</th>
              <th className="text-right">Prix XOF</th><th className="text-right">Montant XOF</th><th className="text-right">Délai</th><th className="text-left pl-2">Retenue</th></tr></thead>
            <tbody>{offers.map((o) => {
              const c = effective[o.rfq_line_id];
              const picked = c?.supplier_id === o.supplier_id;
              return (
                <tr key={o.rfq_line_id + o.supplier_id} className={`border-t border-border/50 ${o.expired ? "text-muted-foreground line-through" : ""}`} data-testid="rfq-offer-row">
                  <td className="py-1">{o.line_no}</td><td>{o.supplier_name}{Number((o as any).price_rank) === 1 && !o.expired ? " · moins-disant" : ""}</td>
                  <td className="text-right tabular-nums">{fmt(o.unit_price)} {o.currency ?? "XOF"}</td><td className="text-right tabular-nums">{fmt(o.unit_price_base)}</td>
                  <td className="text-right tabular-nums">{fmt(o.amount_base)}</td><td className="text-right">{o.lead_time_days != null ? `${o.lead_time_days} j` : "—"}</td>
                  <td className="pl-2">{rfq.status === "sent" && canAward
                    ? <input type="radio" name={`award-${o.rfq_line_id}`} aria-label={`Retenir ${o.supplier_name} pour la ligne ${o.line_no}`} checked={picked} disabled={o.expired}
                        onChange={() => setChoices({ ...choices, [o.rfq_line_id]: { line_id: o.rfq_line_id, supplier_id: o.supplier_id, reason: c?.reason ?? "" } })} />
                    : (awards.data ?? []).some((a: any) => a.rfq_line_id === o.rfq_line_id && a.supplier_id === o.supplier_id) ? "Oui" : ""}</td>
                </tr>);
            })}</tbody>
          </table>
          {rfq.status === "sent" && canAward && (
            <div className="space-y-2 pt-2">
              {Object.values(effective).filter((c) => needsReason(offers, c)).map((c) => {
                const o = offers.find((x) => x.rfq_line_id === c.line_id && x.supplier_id === c.supplier_id)!;
                return (
                  <div key={c.line_id} className="space-y-1"><Label className="text-xs" htmlFor={`rfq-reason-${c.line_id}`}>Motif — ligne {o.line_no} attribuée à {o.supplier_name} (hors moins-disant)</Label>
                    <Input id={`rfq-reason-${c.line_id}`} className="h-8 text-xs" value={c.reason}
                      onChange={(e) => setChoices({ ...choices, [c.line_id]: { ...c, reason: e.target.value } })} /></div>);
              })}
              {issues.length > 0 && <ul className="text-destructive">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
              <Button size="sm" className="h-8 text-xs" disabled={issues.length > 0 || award.isPending} data-testid="rfq-award"
                onClick={() => award.mutate({ _rfq: rfq.id, _awards: lineIds.map((id) => ({ line_id: id, supplier_id: effective[id].supplier_id, reason: effective[id].reason || null })) })}>
                Attribuer et créer les commandes</Button>
            </div>
          )}
        </section>
      )}
      {(awards.data ?? []).length > 0 && (
        <section className="space-y-1" data-testid="rfq-awards"><p className="font-medium">Attribution</p>
          <ul>{(awards.data ?? []).map((a: any) => (
            <li key={a.id}>{a.supplier_name} · commande {a.po_number ?? "—"}{a.cheapest ? "" : ` · motif : ${a.reason}`}</li>))}</ul>
        </section>
      )}
      {quoting && <QuoteDialog rfq={rfq} supplier={quoting} lines={lines.data ?? []} offers={offers} onClose={() => setQuoting(null)} />}
    </div>
  );
}

function QuoteDialog({ rfq, supplier, lines, offers, onClose }: { rfq: any; supplier: any; lines: any[]; offers: RfqOffer[]; onClose: () => void }) {
  const record = useRfqAction("record_rfq_quote", (n) => (Number(n) > 0 ? `Offre de ${supplier.supplier_name} enregistrée (${n} ligne(s))` : `${supplier.supplier_name} a décliné`));
  const mine = (id: string) => offers.find((o) => o.rfq_line_id === id && o.supplier_id === supplier.supplier_id);
  const [prices, setPrices] = useState<Record<string, { price: string; lead: string }>>(
    Object.fromEntries(lines.map((l) => [l.id, { price: mine(l.id) ? String(mine(l.id)!.unit_price) : "", lead: mine(l.id)?.lead_time_days != null ? String(mine(l.id)!.lead_time_days) : "" }])));
  const [currency, setCurrency] = useState(supplier.currency ?? "");
  const [valid, setValid] = useState(supplier.valid_until ?? "");
  const [terms, setTerms] = useState(supplier.payment_terms != null ? String(supplier.payment_terms) : "");
  const [incoterm, setIncoterm] = useState(supplier.incoterm ?? "");
  const n = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
  const quotes = lines.filter((l) => prices[l.id]?.price.trim() !== "" && n(prices[l.id].price) >= 0)
    .map((l) => ({ line_id: l.id, unit_price: n(prices[l.id].price), lead_time_days: prices[l.id].lead.trim() ? Number(prices[l.id].lead) : null }));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-sm">Offre de {supplier.supplier_name} — {rfq.rfq_number}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1"><Label className="text-xs" htmlFor="q-cur">Devise (vide = XOF)</Label><Input id="q-cur" className="h-8 text-xs uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="q-valid">Valable jusqu'au</Label><Input id="q-valid" type="date" className="h-8 text-xs" value={valid} onChange={(e) => setValid(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="q-terms">Paiement (jours)</Label><Input id="q-terms" className="h-8 text-xs" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" htmlFor="q-inco">Incoterm</Label><Input id="q-inco" className="h-8 text-xs uppercase" value={incoterm} onChange={(e) => setIncoterm(e.target.value)} /></div>
          </div>
          <table className="w-full"><thead className="text-muted-foreground"><tr><th className="text-left">Ligne</th><th className="text-right">Qté</th><th className="text-right">Prix unitaire</th><th className="text-right">Délai (jours)</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id} className="border-t border-border/50"><td className="py-1">{l.line_no}. {l.description}</td><td className="text-right">{fmt(l.quantity)}</td>
                <td className="text-right"><Input aria-label={`Prix unitaire ligne ${l.line_no}`} className="h-7 text-xs w-28 ml-auto text-right" inputMode="decimal" value={prices[l.id]?.price ?? ""}
                  onChange={(e) => setPrices({ ...prices, [l.id]: { ...prices[l.id], price: e.target.value } })} /></td>
                <td className="text-right"><Input aria-label={`Délai ligne ${l.line_no}`} className="h-7 text-xs w-20 ml-auto text-right" inputMode="numeric" value={prices[l.id]?.lead ?? ""}
                  onChange={(e) => setPrices({ ...prices, [l.id]: { ...prices[l.id], lead: e.target.value } })} /></td></tr>))}</tbody></table>
          <p className="text-muted-foreground">Sans aucun prix, le fournisseur est noté comme ayant décliné.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={record.isPending} data-testid="rfq-save-quote" onClick={() => record.mutate({
            _rfq: rfq.id, _supplier: supplier.supplier_id, _quotes: quotes, _currency: currency.trim() || null, _valid_until: valid || null,
            _payment_terms: terms.trim() ? Number(terms) : null, _incoterm: incoterm.trim() || null,
          }, { onSuccess: onClose })}>Enregistrer l'offre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
