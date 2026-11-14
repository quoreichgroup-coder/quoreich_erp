import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Search, Pencil, Trash2, Truck, Loader2, ShieldCheck } from "lucide-react";
import {
  useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier, useVerifySupplierBank, useSupplierChangeLog, type Supplier,
} from "@/hooks/use-ap-data";
import { useMyAccess } from "@/hooks/use-my-access";
import { useAuth } from "@/contexts/AuthContext";
import { INCOTERMS, SUPPLIER_FIELD_LABELS, bankStatus, validateSupplier } from "@/lib/supplier";

/*
 * Fiches fournisseurs (V56 ; SAP fiche fournisseur, Sage fiche tiers). Identification, coordonnées,
 * conditions d'achat et coordonnées bancaires ; un changement de compte ou de BIC rend les
 * coordonnées « à valider » par une autre personne (double contrôle), sans quoi la base refuse
 * tout virement à ce fournisseur.
 */
type Form = Record<string, string>;
const FIELDS = ["name", "legal_name", "rccm", "tax_id", "tax_regime", "category", "contact_name", "email", "phone", "address", "city",
  "country", "currency", "default_incoterm", "lead_time_days", "payment_terms", "bank_name", "bank_account", "bank_swift", "notes", "status"] as const;
const emptyForm: Form = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Form;
Object.assign(emptyForm, { currency: "XOF", payment_terms: "30", lead_time_days: "0", status: "active" });

function toForm(s: Supplier): Form {
  return Object.fromEntries(FIELDS.map((f) => [f, (s as any)[f] == null ? "" : String((s as any)[f])])) as Form;
}

function toRow(f: Form) {
  const nul = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    name: f.name.trim(), legal_name: nul(f.legal_name), rccm: nul(f.rccm), tax_id: nul(f.tax_id), tax_regime: nul(f.tax_regime),
    category: nul(f.category), contact_name: nul(f.contact_name), email: nul(f.email), phone: nul(f.phone), address: nul(f.address),
    city: nul(f.city), country: nul(f.country.toUpperCase()), currency: (f.currency.trim() || "XOF").toUpperCase(),
    default_incoterm: nul(f.default_incoterm), lead_time_days: Number(f.lead_time_days || 0), payment_terms: Number(f.payment_terms || 30),
    bank_name: nul(f.bank_name), bank_account: nul(f.bank_account), bank_swift: nul(f.bank_swift.toUpperCase()), notes: nul(f.notes),
    status: f.status || "active",
  };
}

function Field({ id, label, value, onChange, placeholder, type = "text" }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} className="h-8 text-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ChangeLog({ supplierId }: { supplierId: string }) {
  const { data: rows = [] } = useSupplierChangeLog(supplierId);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Historique des changements sensibles" className="space-y-1">
      <h3 className="text-xs font-semibold">Historique des changements sensibles</h3>
      <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-28 overflow-auto">
        {rows.map((r) => (
          <li key={r.id}>{new Date(r.changed_at).toLocaleString("fr-FR")} — {SUPPLIER_FIELD_LABELS[r.field] ?? r.field} : {r.old_value || "∅"} → {r.new_value || "∅"}</li>
        ))}
      </ul>
    </section>
  );
}

const Suppliers = () => {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const verify = useVerifySupplierBank();
  const { user } = useAuth();
  const { data: access } = useMyAccess();
  const roles = new Set(access?.roles ?? []);
  const canManage = ["admin", "accountant", "procurement_controller", "procurement_l1", "procurement_l2", "procurement_l3"].some((r) => roles.has(r));
  const canVerify = roles.has("admin") || roles.has("accountant");

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const q = search.toLowerCase();
  const filtered = suppliers.filter((s) => `${s.name} ${s.email ?? ""} ${s.tax_id ?? ""} ${s.city ?? ""}`.toLowerCase().includes(q));
  const aValider = suppliers.filter((s) => bankStatus(s) === "pending").length;
  const error = validateSupplier(toRow(form));

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm(toForm(s)); setDialogOpen(true); };
  const handleSave = async () => {
    if (error) return;
    if (editing) await updateSupplier.mutateAsync({ id: editing.id, ...toRow(form) } as any);
    else await createSupplier.mutateAsync(toRow(form) as any);
    setDialogOpen(false);
  };
  const current = editing ? suppliers.find((s) => s.id === editing.id) ?? editing : null;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Achats et fournisseurs" }, { label: "Fournisseurs" }]} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Fournisseurs</h1>
          <p className="text-xs text-muted-foreground">Fiches tiers : identification, coordonnées, conditions d'achat et coordonnées bancaires</p>
        </div>
        {canManage && <Button onClick={openCreate} className="gap-1.5"><Plus className="w-4 h-4" /> Ajouter un fournisseur</Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="border border-border"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Fournisseurs</p><p className="text-2xl font-bold">{suppliers.length}</p>
        </CardContent></Card>
        <Card className="border border-border"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Actifs</p><p className="text-2xl font-bold text-success">{suppliers.filter((s) => s.status === "active").length}</p>
        </CardContent></Card>
        <Card className="border border-border"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Coordonnées bancaires à valider</p>
          <p className={aValider > 0 ? "text-2xl font-bold text-destructive" : "text-2xl font-bold"}>{aValider}</p>
        </CardContent></Card>
      </div>

      <Card className="border border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2"><Truck className="w-5 h-5 text-primary" /> Répertoire des fournisseurs</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher un fournisseur…" aria-label="Rechercher un fournisseur" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nom</TableHead><TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell">IFU</TableHead><TableHead className="hidden lg:table-cell">Ville</TableHead>
                <TableHead>Conditions</TableHead><TableHead>Banque</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucun fournisseur.</TableCell></TableRow>
                ) : filtered.map((s) => {
                  const b = bankStatus(s);
                  return (
                    <TableRow key={s.id} data-testid="supplier-row">
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">{s.contact_name || s.email || s.phone || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{s.tax_id || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{[s.city, s.country].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell className="text-xs">{s.payment_terms ?? 30} j · {s.currency ?? "XOF"}{s.default_incoterm ? ` · ${s.default_incoterm}` : ""}{s.lead_time_days ? ` · livré en ${s.lead_time_days} j` : ""}</TableCell>
                      <TableCell>{b === "none" ? <span className="text-xs text-muted-foreground">—</span>
                        : b === "verified" ? <StatusBadge status="success" label="Validées" /> : <StatusBadge status="error" label="À valider" />}</TableCell>
                      <TableCell>{s.status === "active" ? <StatusBadge status="success" label="Actif" /> : <StatusBadge status="neutral" label="Inactif" />}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canManage && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifier ${s.name}`} onClick={() => openEdit(s)}><Pencil className="w-4 h-4 text-muted-foreground" /></Button>}
                          {canVerify && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Supprimer ${s.name}`} onClick={() => setDeleting(s)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Fournisseur ${editing.name}` : "Nouveau fournisseur"}</DialogTitle>
            <DialogDescription className="text-xs">Un changement de compte bancaire ou de BIC devra être validé par une autre personne avant tout virement.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <section aria-label="Identification" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field id="sup-name" label="Nom du fournisseur *" value={form.name} onChange={set("name")} placeholder="Nom commercial" />
              <Field id="sup-legal" label="Raison sociale" value={form.legal_name} onChange={set("legal_name")} />
              <Field id="sup-tax" label="IFU / NIF" value={form.tax_id} onChange={set("tax_id")} />
              <Field id="sup-rccm" label="RCCM" value={form.rccm} onChange={set("rccm")} />
              <Field id="sup-regime" label="Régime fiscal" value={form.tax_regime} onChange={set("tax_regime")} placeholder="RNI, RSI, CME…" />
              <Field id="sup-category" label="Catégorie" value={form.category} onChange={set("category")} />
            </section>
            <section aria-label="Coordonnées" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field id="sup-contact" label="Contact" value={form.contact_name} onChange={set("contact_name")} />
              <Field id="sup-email" label="E-mail" type="email" value={form.email} onChange={set("email")} />
              <Field id="sup-phone" label="Téléphone" value={form.phone} onChange={set("phone")} placeholder="+226 70 00 00 00" />
              <Field id="sup-address" label="Adresse" value={form.address} onChange={set("address")} />
              <Field id="sup-city" label="Ville" value={form.city} onChange={set("city")} />
              <Field id="sup-country" label="Pays (code ISO, ex. BF, CI, FR)" value={form.country} onChange={set("country")} />
            </section>
            <section aria-label="Conditions d'achat" className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field id="sup-terms" label="Délai de paiement (jours)" type="number" value={form.payment_terms} onChange={set("payment_terms")} />
              <Field id="sup-lead" label="Délai de livraison (jours)" type="number" value={form.lead_time_days} onChange={set("lead_time_days")} />
              <Field id="sup-currency" label="Devise" value={form.currency} onChange={set("currency")} />
              <div className="grid gap-1.5">
                <Label htmlFor="sup-incoterm" className="text-xs">Incoterm par défaut</Label>
                <select id="sup-incoterm" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={form.default_incoterm} onChange={(e) => set("default_incoterm")(e.target.value)}>
                  <option value="">—</option>{INCOTERMS.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.label}</option>)}
                </select>
              </div>
            </section>
            <section aria-label="Coordonnées bancaires" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field id="sup-bank" label="Banque" value={form.bank_name} onChange={set("bank_name")} />
              <Field id="sup-account" label="Compte / RIB / IBAN" value={form.bank_account} onChange={set("bank_account")} />
              <Field id="sup-swift" label="BIC / SWIFT" value={form.bank_swift} onChange={set("bank_swift")} />
            </section>
            {current && bankStatus(current) === "pending" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs flex items-center justify-between gap-2 flex-wrap" role="status">
                <span>Coordonnées bancaires à valider : aucun virement n'est possible tant qu'une autre personne ne les a pas validées.</span>
                {canVerify && current.bank_changed_by !== user?.id && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={verify.isPending} onClick={() => verify.mutate(current.id)}>
                    <ShieldCheck className="w-3.5 h-3.5" /> Valider les coordonnées bancaires
                  </Button>
                )}
              </div>
            )}
            {editing && (
              <div className="grid gap-1.5">
                <Label htmlFor="sup-status" className="text-xs">Statut</Label>
                <select id="sup-status" className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs" value={form.status} onChange={(e) => set("status")(e.target.value)}>
                  <option value="active">Actif</option><option value="inactive">Inactif</option>
                </select>
              </div>
            )}
            {editing && canVerify && <ChangeLog supplierId={editing.id} />}
            {error && form.name && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={!!error || createSupplier.isPending || updateSupplier.isPending}>
              {(createSupplier.isPending || updateSupplier.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Supprimer le fournisseur</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Supprimer <span className="font-medium text-foreground">{deleting?.name}</span> ? Un fournisseur cité par une pièce ne se supprime pas : désactivez-le.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Annuler</Button>
            <Button variant="destructive" disabled={deleteSupplier.isPending}
              onClick={async () => { if (deleting) { await deleteSupplier.mutateAsync(deleting.id); setDeleting(null); } }}>
              {deleteSupplier.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default Suppliers;
