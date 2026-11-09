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
import { Plus, Search, Pencil, Trash2, Truck, Loader2 } from "lucide-react";
import { useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier, type Supplier } from "@/hooks/use-ap-data";

const emptyForm = { name: "", email: "", phone: "", address: "", tax_id: "", status: "active", payment_terms: 30 };

const Suppliers = () => {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      tax_id: supplier.tax_id || "",
      status: supplier.status,
      payment_terms: supplier.payment_terms || 30,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingSupplier) {
      await updateSupplier.mutateAsync({ id: editingSupplier.id, ...form });
    } else {
      await createSupplier.mutateAsync(form as any);
    }
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (deletingSupplier) {
      await deleteSupplier.mutateAsync(deletingSupplier.id);
      setDeleteDialogOpen(false);
      setDeletingSupplier(null);
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
                <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
                <p className="text-sm text-muted-foreground">Manage your supplier relationships</p>
              </div>
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" /> Add Supplier
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Suppliers</p>
                  <p className="text-2xl font-bold text-foreground">{suppliers.length}</p>
                </CardContent>
              </Card>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-green-600">{suppliers.filter(s => s.status === "active").length}</p>
                </CardContent>
              </Card>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Payment Terms (avg)</p>
                  <p className="text-2xl font-bold text-primary">
                    {suppliers.length > 0 ? Math.round(suppliers.reduce((s, sup) => s + (sup.payment_terms || 30), 0) / suppliers.length) : 0} days
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="border border-border">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary" /> Supplier Directory
                  </CardTitle>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search suppliers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden md:table-cell">Email</TableHead>
                        <TableHead className="hidden lg:table-cell">Phone</TableHead>
                        <TableHead className="hidden md:table-cell">Tax ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Terms</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ) : filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No suppliers found.</TableCell>
                        </TableRow>
                      ) : (
                        filtered.map(supplier => (
                          <TableRow key={supplier.id}>
                            <TableCell className="font-medium text-foreground">{supplier.name}</TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground">{supplier.email}</TableCell>
                            <TableCell className="hidden lg:table-cell text-muted-foreground">{supplier.phone}</TableCell>
                            <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">{supplier.tax_id}</TableCell>
                            <TableCell>
                              <Badge variant={supplier.status === "active" ? "default" : "secondary"} className={supplier.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                                {supplier.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">{supplier.payment_terms || 30}j</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(supplier)}>
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeletingSupplier(supplier); setDeleteDialogOpen(true); }}>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "New Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Supplier Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company name" />
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
                <Input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="XX-SUP-000" />
              </div>
              <div className="grid gap-1.5">
                <Label>Payment Terms (days)</Label>
                <Input type="number" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || createSupplier.isPending || updateSupplier.isPending} className="bg-primary hover:bg-primary/90">
              {(createSupplier.isPending || updateSupplier.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : editingSupplier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Supplier</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{deletingSupplier?.name}</span>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteSupplier.isPending}>
              {deleteSupplier.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
};

export default Suppliers;
