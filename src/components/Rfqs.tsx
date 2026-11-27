import { useMemo, useRef, useState, type RefObject } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type MobileTableColumn } from "@/components/ui/table";
import { ExportMenu } from "@/components/ExportMenu";
import { StatusBadge } from "@/components/StatusBadge";
import { useMyAccess } from "@/hooks/use-my-access";
import { useRfqAction, useRfqDetail, useRfqs } from "@/hooks/use-rfq";
import { exportTable } from "@/lib/table-export";
import { awardIssues, defaultChoices, needsReason, RFQ_STATUS, type RfqChoice, type RfqOffer } from "@/lib/rfq";

const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const fieldClass = "h-11 min-w-0 w-full text-base sm:h-9 sm:text-sm";
const selectClass = `${fieldClass} rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;
const registryColumns: MobileTableColumn[] = [{ label: "N°", kind: "primary" }, { label: "Objet", wide: true }, { label: "Demande d'achat" }, { label: "Réponse attendue" }, { label: "Lignes" }, { label: "Offres / consultés" }, { label: "Statut" }];
const lineColumns: MobileTableColumn[] = [{ label: "Ligne" }, { label: "Désignation", kind: "primary" }, { label: "Quantité" }];
const supplierColumns: MobileTableColumn[] = [{ label: "Fournisseur", kind: "primary" }, { label: "Offre", wide: true }, { label: "Actions", kind: "actions" }];
const offerColumns: MobileTableColumn[] = [{ label: "Ligne" }, { label: "Fournisseur", kind: "primary" }, { label: "Prix offert" }, { label: "Prix XOF" }, { label: "Montant XOF" }, { label: "Délai" }, { label: "Retenue", wide: true }];

function ReadFailure({ error, label, retry }: { error: unknown; label: string; retry: () => void }) {
  return <Alert variant="destructive"><AlertDescription className="space-y-2 break-words">
    <p>{error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Chargement indisponible.")}</p>
    <Button variant="outline" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={retry}>{label}</Button>
  </AlertDescription></Alert>;
}

export function RfqPanel({ suppliers, requisitions }: { suppliers: any[]; requisitions: any[] }) {
  const rfqs = useRfqs();
  const perms = useMyAccess().data?.permissions ?? [];
  const canRfq = perms.includes("procurement.rfq");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const list = rfqs.data ?? [];
  const current = list.find(r => r.id === selected) ?? null;
  return <div className="min-w-0 space-y-4" data-testid="rfq-panel">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 basis-full text-sm text-muted-foreground">Consultez plusieurs fournisseurs, comparez leurs offres et attribuez : les commandes sont créées en brouillon.</p>
      {canRfq && <Button ref={createTrigger} size="sm" className="h-auto min-h-11 max-w-full whitespace-normal gap-2" onClick={() => setCreating(true)} data-testid="rfq-new"><Plus className="size-4 shrink-0" />Nouvelle demande de prix</Button>}
      <ExportMenu size="sm" variant="outline" className="px-2 text-xs" aria-label="Exporter les demandes de prix" data-testid="rfq-export-csv" disabled={rfqs.isPending || rfqs.isError || !list.length}
        onPick={format => exportTable(format, list.map(r => ({ numero: r.rfq_number, objet: r.title, demande_achat: r.pr_number ?? "", reponse_attendue: r.response_due ?? "", lignes: r.line_count, offres: r.response_count, consultes: r.supplier_count, statut: RFQ_STATUS[r.status] ?? r.status })), [
          { key: "numero", header: "N°" }, { key: "objet", header: "Objet" }, { key: "demande_achat", header: "Demande d'achat" }, { key: "reponse_attendue", header: "Réponse attendue" },
          { key: "lignes", header: "Lignes" }, { key: "offres", header: "Offres" }, { key: "consultes", header: "Consultés" }, { key: "statut", header: "Statut" },
        ], "demandes-de-prix", "Demandes de prix")}>Exporter</ExportMenu>
    </div>
    {rfqs.isError ? <ReadFailure error={rfqs.error} label="Réessayer le chargement des demandes de prix" retry={() => void rfqs.refetch()} /> : <div className="rounded-lg border bg-card">
      <Table aria-label="Demandes de prix" mobileColumns={registryColumns}>
        <TableHeader><TableRow>{registryColumns.map(c => <TableHead key={c.label}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rfqs.isPending && <TableRow><TableCell colSpan={7}><span role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Chargement des demandes de prix…</span></TableCell></TableRow>}
          {!rfqs.isPending && !list.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Aucune demande de prix.</TableCell></TableRow>}
          {list.map(r => <TableRow key={r.id} data-testid="rfq-row" className="cursor-pointer" data-state={selected === r.id ? "selected" : undefined} onClick={() => setSelected(r.id)}>
            <TableCell><Button variant="link" size="sm" className="h-auto min-h-11 max-w-full justify-start whitespace-normal px-0 text-left font-mono md:min-h-9" aria-expanded={selected === r.id} aria-controls={selected === r.id ? `rfq-detail-${r.id}` : undefined} onClick={() => setSelected(r.id)}><span className="min-w-0 break-words">{r.rfq_number}</span></Button></TableCell>
            <TableCell className="break-words">{r.title || "—"}</TableCell><TableCell>{r.pr_number ?? "—"}</TableCell><TableCell>{r.response_due ?? "—"}</TableCell>
            <TableCell className="tabular-nums md:text-right">{r.line_count}</TableCell><TableCell className="tabular-nums md:text-right">{r.response_count} / {r.supplier_count}</TableCell>
            <TableCell><StatusBadge status={r.status} label={RFQ_STATUS[r.status] ?? r.status} /></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>}
    {current && <RfqDetail key={current.id} rfq={current} suppliers={suppliers} perms={perms} />}
    {creating && <CreateRfqDialog suppliers={suppliers} requisitions={requisitions} returnFocusRef={createTrigger} onClose={id => { setCreating(false); if (id) setSelected(id); }} />}
  </div>;
}

function CreateRfqDialog({ suppliers, requisitions, returnFocusRef, onClose }: { suppliers: any[]; requisitions: any[]; returnFocusRef: RefObject<HTMLElement | null>; onClose: (id?: string) => void }) {
  const create = useRfqAction("create_rfq", () => "Demande de prix créée");
  const [title, setTitle] = useState("");
  const [pr, setPr] = useState("");
  const [due, setDue] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: "1" }]);
  const [chosen, setChosen] = useState<string[]>([]);
  const approved = requisitions.filter(r => r.status === "approved" && !r.po_id);
  const active = suppliers.filter(s => s.status !== "inactive");
  const free = lines.filter(l => l.description.trim() && Number(l.quantity.replace(",", ".")) > 0);
  const submit = () => create.mutate({
    _title: title.trim() || null, _requisition: pr || null, _response_due: due || null,
    _lines: pr ? null : free.map(l => ({ description: l.description.trim(), quantity: Number(l.quantity.replace(",", ".")) })), _suppliers: chosen.length ? chosen : null,
  }, { onSuccess: (id: any) => onClose(String(id)) });
  return <Dialog open onOpenChange={o => { if (!o) onClose(); }}><DialogContent className="max-w-2xl" returnFocusRef={returnFocusRef}>
    <DialogHeader><DialogTitle>Nouvelle demande de prix</DialogTitle><DialogDescription>Définissez les besoins et les fournisseurs à consulter.</DialogDescription></DialogHeader>
    <div className="min-w-0 space-y-4 text-sm">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5"><Label htmlFor="rfq-title">Objet</Label><Input id="rfq-title" className={fieldClass} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor="rfq-due">Réponse attendue le</Label><Input id="rfq-due" type="date" className={fieldClass} value={due} onChange={e => setDue(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="rfq-pr">Demande d'achat approuvée (reprend ses lignes)</Label><select id="rfq-pr" className={selectClass} value={pr} onChange={e => setPr(e.target.value)}><option value="">— Aucune : lignes saisies ci-dessous —</option>{approved.map(r => <option key={r.id} value={r.id}>{r.pr_number} · {r.description ?? ""}</option>)}</select></div>
      {!pr && <div className="space-y-3">{lines.map((l, i) => <div key={i} className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div className="min-w-0 space-y-1.5"><Label htmlFor={`rfq-description-${i}`}>Désignation ligne {i + 1}</Label><Input id={`rfq-description-${i}`} aria-label={`Désignation ligne ${i + 1}`} className={fieldClass} placeholder="Désignation" value={l.description} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor={`rfq-quantity-${i}`}>Quantité ligne {i + 1}</Label><Input id={`rfq-quantity-${i}`} aria-label={`Quantité ligne ${i + 1}`} className={fieldClass} inputMode="decimal" value={l.quantity} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></div>
      </div>)}<Button size="sm" variant="outline" onClick={() => setLines([...lines, { description: "", quantity: "1" }])}>+ Ajouter une ligne</Button></div>}
      <fieldset className="min-w-0 space-y-2"><legend className="font-medium">Fournisseurs consultés</legend><p className="text-muted-foreground">Sans choix : les fournisseurs du catalogue des articles demandés.</p>
        <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{active.map(s => <label key={s.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={chosen.includes(s.id)} onChange={e => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter(x => x !== s.id))} /><span className="min-w-0 break-words">{s.name}</span>
        </label>)}</div>
      </fieldset>
    </div>
    <DialogFooter><Button variant="outline" size="sm" onClick={() => onClose()}>Annuler</Button><Button size="sm" disabled={create.isPending || (!pr && free.length === 0)} onClick={submit} data-testid="rfq-create">Créer la demande</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function RfqDetail({ rfq, suppliers, perms }: { rfq: any; suppliers: any[]; perms: string[] }) {
  const { lines, suppliers: consulted, comparison, awards } = useRfqDetail(rfq.id);
  const canRfq = perms.includes("procurement.rfq");
  const canAward = perms.includes("procurement.rfq_award");
  const send = useRfqAction("rfq_send", () => "Demande de prix envoyée : saisissez les offres reçues");
  const cancel = useRfqAction("rfq_cancel", () => "Demande de prix annulée");
  const setSuppliers = useRfqAction("rfq_set_suppliers", n => `${n} fournisseur(s) consulté(s)`);
  const award = useRfqAction("award_rfq", r => `Attribuée : ${(r?.purchase_orders ?? []).length} commande(s) brouillon créée(s)`);
  const heading = useRef<HTMLHeadingElement>(null);
  const quoteTrigger = useRef<HTMLElement | null>(null);
  const cancelReturn = useRef<HTMLElement | null>(null);
  const [quoting, setQuoting] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [adding, setAdding] = useState("");
  const offers = (comparison.data ?? []) as RfqOffer[];
  const lineIds = (lines.data ?? []).map((l: any) => l.id as string);
  const proposed = useMemo(() => defaultChoices(offers, lineIds), [offers, lineIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choices, setChoices] = useState<Record<string, RfqChoice>>({});
  const effective = { ...proposed, ...choices };
  const issues = awardIssues(offers, lineIds, effective);
  const supplierIds = (consulted.data ?? []).map((s: any) => s.supplier_id);
  const editable = rfq.status === "draft" || rfq.status === "sent";
  const offerDataReady = lines.isSuccess && comparison.isSuccess;
  const focusHeading = () => heading.current?.focus();
  const closeCancel = () => { setCancelling(false); setCancelReason(""); };
  return <div id={`rfq-detail-${rfq.id}`} className="min-w-0 space-y-6 rounded-lg border bg-card p-3 text-sm sm:p-5" data-testid="rfq-detail">
    <div className="flex flex-wrap items-center gap-3">
      <h3 ref={heading} tabIndex={-1} className="min-w-0 basis-full break-words text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{rfq.rfq_number} — {rfq.title} <span className="font-normal text-muted-foreground">· {RFQ_STATUS[rfq.status]}</span></h3>
      {canRfq && rfq.status === "draft" && <Button size="sm" disabled={send.isPending} onClick={() => send.mutate({ _rfq: rfq.id }, { onSuccess: focusHeading })} data-testid="rfq-send">Envoyer la demande</Button>}
      {canRfq && editable && <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={e => { cancelReturn.current = e.currentTarget; setCancelling(true); }}>Annuler</Button>}
    </div>
    <section className="space-y-3"><h4 className="font-semibold">Lignes demandées</h4>
      {lines.isError ? <ReadFailure error={lines.error} label="Réessayer le chargement des lignes" retry={() => void lines.refetch()} /> : <Table aria-label="Lignes demandées" mobileColumns={lineColumns}>
        <TableHeader><TableRow>{lineColumns.map(c => <TableHead key={c.label}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{lines.isPending ? <TableRow><TableCell colSpan={3}>Chargement des lignes…</TableCell></TableRow> : !(lines.data ?? []).length ? <TableRow><TableCell colSpan={3}>Aucune ligne demandée.</TableCell></TableRow> : (lines.data ?? []).map((l: any) => <TableRow key={l.id}><TableCell>{l.line_no}</TableCell><TableCell className="break-words">{l.description}</TableCell><TableCell className="tabular-nums md:text-right">{fmt(l.quantity)}</TableCell></TableRow>)}</TableBody>
      </Table>}
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Fournisseurs consultés</h4>
      {consulted.isError ? <ReadFailure error={consulted.error} label="Réessayer le chargement des fournisseurs" retry={() => void consulted.refetch()} /> : <Table aria-label="Fournisseurs consultés" mobileColumns={supplierColumns}>
        <TableHeader><TableRow>{supplierColumns.map(c => <TableHead key={c.label}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{consulted.isPending ? <TableRow><TableCell colSpan={3}>Chargement des fournisseurs…</TableCell></TableRow> : !(consulted.data ?? []).length ? <TableRow><TableCell colSpan={3}>Aucun fournisseur consulté.</TableCell></TableRow> : (consulted.data ?? []).map((s: any) => <TableRow key={s.id} data-testid="rfq-supplier-row">
          <TableCell className="break-words">{s.supplier_name}</TableCell><TableCell>{s.status === "responded" ? "Offre reçue" : s.status === "declined" ? "A décliné" : "Consulté"}{s.currency ? ` · ${s.currency}` : ""}{s.valid_until ? ` · valable au ${s.valid_until}` : ""}</TableCell>
          <TableCell className="md:text-right">{canRfq && rfq.status === "sent" && <Button size="sm" variant="outline" disabled={!offerDataReady} onClick={e => { quoteTrigger.current = e.currentTarget; setQuoting(s); }} data-testid="rfq-enter-quote">Saisir l'offre</Button>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {canRfq && editable && <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor={`rfq-add-${rfq.id}`}>Ajouter un fournisseur à consulter</Label><select id={`rfq-add-${rfq.id}`} className={selectClass} value={adding} onChange={e => setAdding(e.target.value)}><option value="">+ Consulter un autre fournisseur</option>{suppliers.filter(s => s.status !== "inactive" && !supplierIds.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <Button size="sm" variant="outline" disabled={!adding || !consulted.isSuccess || setSuppliers.isPending} onClick={() => setSuppliers.mutate({ _rfq: rfq.id, _suppliers: [...supplierIds, adding] }, { onSuccess: () => setAdding("") })}>Ajouter</Button>
      </div>}
    </section>
    <section className="space-y-3" data-testid="rfq-comparison"><h4 className="font-semibold">Comparatif des offres</h4><p className="text-muted-foreground">Prix convertis au cours du jour, XOF.</p>
      {comparison.isError ? <ReadFailure error={comparison.error} label="Réessayer le chargement du comparatif" retry={() => void comparison.refetch()} /> : <Table aria-label="Comparatif des offres" mobileColumns={offerColumns}>
        <TableHeader><TableRow>{offerColumns.map(c => <TableHead key={c.label}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{comparison.isPending ? <TableRow><TableCell colSpan={7}>Chargement des offres…</TableCell></TableRow> : !offers.length ? <TableRow><TableCell colSpan={7}>Aucune offre reçue.</TableCell></TableRow> : offers.map(o => {
          const c = effective[o.rfq_line_id]; const picked = c?.supplier_id === o.supplier_id;
          return <TableRow key={o.rfq_line_id + o.supplier_id} className={o.expired ? "text-muted-foreground" : undefined} data-testid="rfq-offer-row">
            <TableCell>{o.line_no}</TableCell><TableCell className="break-words">{o.supplier_name}{Number((o as any).price_rank) === 1 && !o.expired ? " · moins-disant" : ""}{o.expired && <span className="block text-xs">Offre expirée</span>}</TableCell>
            <TableCell className="tabular-nums md:text-right">{fmt(o.unit_price)} {o.currency ?? "XOF"}</TableCell><TableCell className="tabular-nums md:text-right">{fmt(o.unit_price_base)}</TableCell><TableCell className="tabular-nums md:text-right">{fmt(o.amount_base)}</TableCell><TableCell className="md:text-right">{o.lead_time_days != null ? `${o.lead_time_days} j` : "—"}</TableCell>
            <TableCell>{rfq.status === "sent" && canAward ? <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2"><input type="radio" className="size-5 shrink-0 accent-primary" name={`award-${o.rfq_line_id}`} aria-label={`Retenir ${o.supplier_name} pour la ligne ${o.line_no}`} checked={picked} disabled={o.expired || !offerDataReady} onChange={() => setChoices({ ...choices, [o.rfq_line_id]: { line_id: o.rfq_line_id, supplier_id: o.supplier_id, reason: c?.reason ?? "" } })} /><span className="text-xs md:sr-only">{o.expired ? "Expirée" : picked ? "Offre retenue" : "Retenir"}</span></label> : (awards.data ?? []).some((a: any) => a.rfq_line_id === o.rfq_line_id && a.supplier_id === o.supplier_id) ? "Oui" : "—"}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}
      {offers.length > 0 && rfq.status === "sent" && canAward && <div className="space-y-3 border-t pt-4">{Object.values(effective).filter(c => needsReason(offers, c)).map(c => {
        const o = offers.find(x => x.rfq_line_id === c.line_id && x.supplier_id === c.supplier_id)!;
        return <div key={c.line_id} className="space-y-1.5"><Label htmlFor={`rfq-reason-${c.line_id}`}>Motif — ligne {o.line_no} attribuée à {o.supplier_name} (hors moins-disant)</Label><Input id={`rfq-reason-${c.line_id}`} className={fieldClass} value={c.reason} onChange={e => setChoices({ ...choices, [c.line_id]: { ...c, reason: e.target.value } })} /></div>;
      })}{issues.length > 0 && <ul className="space-y-1 text-destructive">{issues.map(i => <li key={i}>{i}</li>)}</ul>}
        <Button size="sm" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!offerDataReady || !lineIds.length || issues.length > 0 || award.isPending} data-testid="rfq-award" onClick={() => award.mutate({ _rfq: rfq.id, _awards: lineIds.map(id => ({ line_id: id, supplier_id: effective[id].supplier_id, reason: effective[id].reason || null })) }, { onSuccess: focusHeading })}>Attribuer et créer les commandes</Button>
      </div>}
    </section>
    {awards.isError && <ReadFailure error={awards.error} label="Réessayer le chargement de l'attribution" retry={() => void awards.refetch()} />}
    {(awards.data ?? []).length > 0 && <section className="space-y-2" data-testid="rfq-awards"><h4 className="font-semibold">Attribution</h4><ul className="space-y-2 break-words">{(awards.data ?? []).map((a: any) => <li key={a.id}>{a.supplier_name} · commande {a.po_number ?? "—"}{a.cheapest ? "" : ` · motif : ${a.reason}`}</li>)}</ul></section>}
    {quoting && <QuoteDialog rfq={rfq} supplier={quoting} lines={lines.data ?? []} offers={offers} ready={offerDataReady && !lines.isFetching && !comparison.isFetching}
      error={lines.error ?? comparison.error} retry={() => { void lines.refetch(); void comparison.refetch(); }} returnFocusRef={quoteTrigger} onClose={() => setQuoting(null)} />}
    {cancelling && <Dialog open onOpenChange={open => { if (!open) closeCancel(); }}><DialogContent returnFocusRef={cancelReturn}>
      <DialogHeader><DialogTitle>Annuler la demande de prix</DialogTitle><DialogDescription>Indiquez le motif d'annulation de {rfq.rfq_number}.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label htmlFor="rfq-cancel-reason">Motif (obligatoire)</Label><Input id="rfq-cancel-reason" className={fieldClass} value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></div>
      <DialogFooter><Button size="sm" variant="outline" onClick={closeCancel}>Revenir</Button><Button size="sm" variant="destructive" className="h-auto min-h-11 whitespace-normal" disabled={!cancelReason.trim() || cancel.isPending} onClick={() => cancel.mutate({ _rfq: rfq.id, _reason: cancelReason.trim() }, { onSuccess: () => { cancelReturn.current = heading.current; closeCancel(); } })}>Confirmer l'annulation</Button></DialogFooter>
    </DialogContent></Dialog>}
  </div>;
}

function QuoteDialog({ rfq, supplier, lines, offers, ready, error, retry, returnFocusRef, onClose }: { rfq: any; supplier: any; lines: any[]; offers: RfqOffer[]; ready: boolean; error: unknown; retry: () => void; returnFocusRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const record = useRfqAction("record_rfq_quote", n => Number(n) > 0 ? `Offre de ${supplier.supplier_name} enregistrée (${n} ligne(s))` : `${supplier.supplier_name} a décliné`);
  const mine = (id: string) => offers.find(o => o.rfq_line_id === id && o.supplier_id === supplier.supplier_id);
  const [prices, setPrices] = useState<Record<string, { price: string; lead: string }>>(Object.fromEntries(lines.map(l => [l.id, { price: mine(l.id) ? String(mine(l.id)!.unit_price) : "", lead: mine(l.id)?.lead_time_days != null ? String(mine(l.id)!.lead_time_days) : "" }])));
  const [currency, setCurrency] = useState(supplier.currency ?? ""); const [valid, setValid] = useState(supplier.valid_until ?? "");
  const [terms, setTerms] = useState(supplier.payment_terms != null ? String(supplier.payment_terms) : ""); const [incoterm, setIncoterm] = useState(supplier.incoterm ?? "");
  const n = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
  // Une actualisation peut ajouter une ligne déjà chiffrée : préserver son offre
  // tant que l'utilisateur n'a pas créé de brouillon local pour cette ligne.
  const priceFor = (id: string) => {
    const offer = mine(id);
    return prices[id] ?? { price: offer ? String(offer.unit_price) : "", lead: offer?.lead_time_days != null ? String(offer.lead_time_days) : "" };
  };
  const quotes = lines.flatMap(l => {
    const p = priceFor(l.id);
    return p.price.trim() !== "" && n(p.price) >= 0 ? [{ line_id: l.id, unit_price: n(p.price), lead_time_days: p.lead.trim() ? Number(p.lead) : null }] : [];
  });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-w-2xl" returnFocusRef={returnFocusRef}>
    <DialogHeader><DialogTitle className="break-words">Offre de {supplier.supplier_name} — {rfq.rfq_number}</DialogTitle><DialogDescription>Renseignez les conditions et les prix reçus pour chaque ligne.</DialogDescription></DialogHeader>
    {error ? <ReadFailure error={error} label="Réessayer l'actualisation de l'offre" retry={retry} /> : !ready && <p role="status" className="text-sm text-muted-foreground">Actualisation des lignes et des offres…</p>}
    <fieldset disabled={!ready} className="min-w-0 space-y-4 text-sm"><div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5"><Label htmlFor="q-cur">Devise (vide = XOF)</Label><Input id="q-cur" className={`${fieldClass} uppercase`} value={currency} onChange={e => setCurrency(e.target.value)} /></div>
      <div className="min-w-0 space-y-1.5"><Label htmlFor="q-valid">Valable jusqu'au</Label><Input id="q-valid" type="date" className={fieldClass} value={valid} onChange={e => setValid(e.target.value)} /></div>
      <div className="min-w-0 space-y-1.5"><Label htmlFor="q-terms">Paiement (jours)</Label><Input id="q-terms" className={fieldClass} inputMode="numeric" value={terms} onChange={e => setTerms(e.target.value)} /></div>
      <div className="min-w-0 space-y-1.5"><Label htmlFor="q-inco">Incoterm</Label><Input id="q-inco" className={fieldClass} value={incoterm} onChange={e => setIncoterm(e.target.value)} /></div>
    </div>
      <p id="rfq-quote-scroll-hint" className="text-xs text-muted-foreground sm:hidden">Faites défiler le tableau horizontalement pour saisir les prix et les délais.</p>
      <div role="region" aria-label="Prix et délais de l'offre" aria-describedby="rfq-quote-scroll-hint" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full min-w-[36rem] text-sm"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-3 text-left">Ligne</th><th className="p-3 text-right">Qté</th><th className="p-3 text-right">Prix unitaire</th><th className="p-3 text-right">Délai (jours)</th></tr></thead><tbody>{lines.map(l => <tr key={l.id} className="border-t">
          <td className="p-3">{l.line_no}. {l.description}</td><td className="p-3 text-right tabular-nums">{fmt(l.quantity)}</td>
          <td className="p-3"><Input aria-label={`Prix unitaire ligne ${l.line_no}`} className={`${fieldClass} ml-auto w-28 text-right`} inputMode="decimal" value={priceFor(l.id).price} onChange={e => setPrices({ ...prices, [l.id]: { ...priceFor(l.id), price: e.target.value } })} /></td>
          <td className="p-3"><Input aria-label={`Délai ligne ${l.line_no}`} className={`${fieldClass} ml-auto w-24 text-right`} inputMode="numeric" value={priceFor(l.id).lead} onChange={e => setPrices({ ...prices, [l.id]: { ...priceFor(l.id), lead: e.target.value } })} /></td>
        </tr>)}</tbody></table>
      </div><p className="text-muted-foreground">Sans aucun prix, le fournisseur est noté comme ayant décliné.</p>
    </fieldset>
    <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Annuler</Button><Button size="sm" disabled={!ready || record.isPending} data-testid="rfq-save-quote" onClick={() => record.mutate({ _rfq: rfq.id, _supplier: supplier.supplier_id, _quotes: quotes, _currency: currency.trim() || null, _valid_until: valid || null, _payment_terms: terms.trim() ? Number(terms) : null, _incoterm: incoterm.trim() || null }, { onSuccess: onClose })}>Enregistrer l'offre</Button></DialogFooter>
  </DialogContent></Dialog>;
}
