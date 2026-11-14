import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, Users, Loader2 } from "lucide-react";
import { useCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer, useSetCustomersStatus, type Customer } from "@/hooks/use-ar-data";
import { exportToCSV } from "@/lib/csv-export";
import { CustomerAnalyticDefaults } from "@/components/AnalyticSelectors";

const emptyForm: { name: string; email: string; phone: string; address: string; tax_id: string; status: string; credit_limit: number; payment_terms: number } = { name: "", email: "", phone: "", address: "", tax_id: "", status: "active", credit_limit: 0, payment_terms: 30 };

const Customers = () => {
  const { data: customers = [], isLoading } = useCustomers();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  // Actions groupées : sélection de fiches, export, activation / désactivation.
  const setStatus = useSetCustomersStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditingCustomer(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      address: customer.address || "",
      tax_id: customer.tax_id || "",
      status: customer.status as "active" | "inactive",
      credit_limit: customer.credit_limit,
      payment_terms: customer.payment_terms,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingCustomer) {
      await updateCustomer.mutateAsync({ id: editingCustomer.id, ...form });
    } else {
      await createCustomer.mutateAsync(form as any);
    }
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (deletingCustomer) {
      await deleteCustomer.mutateAsync(deletingCustomer.id);
      setDeleteDialogOpen(false);
      setDeletingCustomer(null);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XOF", minimumFractionDigits: 0 }).format(amount);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <TopNav />
          <main className="flex-1 p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Customers</h1>
                <p className="text-sm text-muted-foreground">Manage your customer relationships</p>
              </div>
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" /> Add Customer
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Customers</p>
                  <p className="text-2xl font-bold text-foreground">{customers.length}</p>
                </CardContent>
              </Card>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-success">{customers.filter(c => c.status === "active").length}</p>
                </CardContent>
              </Card>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Credit Limit</p>
                  <p className="text-2xl font-bold text-primary">{formatCurrency(customers.reduce((s, c) => s + (c.credit_limit || 0), 0))}</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border border-border">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" /> Customer Directory
                  </CardTitle>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {selected.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 text-xs" data-testid="customers-bulk-bar">
                    <span className="font-medium">{selected.size} fiche(s) sélectionnée(s)</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportToCSV(
                      customers.filter((c) => selected.has(c.id)).map((c) => ({ nom: c.name, email: c.email ?? "", telephone: c.phone ?? "",
                        identifiant_fiscal: c.tax_id ?? "", adresse: c.address ?? "", limite_credit: c.credit_limit ?? 0,
                        delai_paiement: c.payment_terms ?? "", statut: c.status })),
                      [{ key: "nom", header: "Nom" }, { key: "email", header: "E-mail" }, { key: "telephone", header: "Téléphone" },
                        { key: "identifiant_fiscal", header: "IFU / NIF" }, { key: "adresse", header: "Adresse" },
                        { key: "limite_credit", header: "Limite de crédit" }, { key: "delai_paiement", header: "Délai de paiement (jours)" },
                        { key: "statut", header: "Statut" }], "clients-selection")}>Exporter la sélection</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ ids: [...selected], status: "inactive" }, { onSuccess: () => setSelected(new Set()) })}>Désactiver</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ ids: [...selected], status: "active" }, { onSuccess: () => setSelected(new Set()) })}>Réactiver</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelected(new Set())}>Effacer la sélection</Button>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <input type="checkbox" aria-label="Tout sélectionner" className="rounded border-input"
                            checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                            onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())} />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden md:table-cell">Email</TableHead>
                        <TableHead className="hidden lg:table-cell">Phone</TableHead>
                        <TableHead className="hidden lg:table-cell">Tax ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Credit Limit</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ) : filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No customers found.</TableCell>
                        </TableRow>
                      ) : (
                        filtered.map(customer => (
                          <TableRow key={customer.id}>
                            <TableCell>
                              <input type="checkbox" aria-label={`Sélectionner ${customer.name}`} className="rounded border-input"
                                checked={selected.has(customer.id)} onChange={() => toggle(customer.id)} />
                            </TableCell>
                            <TableCell className="font-medium text-foreground">{customer.name}</TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground">{customer.email}</TableCell>
                            <TableCell className="hidden lg:table-cell text-muted-foreground">{customer.phone}</TableCell>
                            <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">{customer.tax_id}</TableCell>
                            <TableCell>
                              <Badge variant={customer.status === "active" ? "default" : "secondary"} className={customer.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                                {customer.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(customer.credit_limit || 0)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifier ${customer.name}`} onClick={() => openEdit(customer)}>
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Supprimer ${customer.name}`} onClick={() => { setDeletingCustomer(customer); setDeleteDialogOpen(true); }}>
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Customer Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company or individual name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+225 07 00 00 00" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="City, Country" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>Tax ID</Label>
                <Input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="XX-2024-000" />
              </div>
              <div className="grid gap-1.5">
                <Label>Credit Limit (XOF)</Label>
                <Input type="number" value={form.credit_limit} onChange={e => setForm(f => ({ ...f, credit_limit: Number(e.target.value) }))} />
              </div>
            </div>
            {/* Une section par défaut se rattache à un client existant : visible en modification seulement. */}
            {editingCustomer && <CustomerAnalyticDefaults customerId={editingCustomer.id} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || createCustomer.isPending || updateCustomer.isPending} className="bg-primary hover:bg-primary/90">
              {(createCustomer.isPending || updateCustomer.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : editingCustomer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{deletingCustomer?.name}</span>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteCustomer.isPending}>
              {deleteCustomer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
};

export default Customers;
