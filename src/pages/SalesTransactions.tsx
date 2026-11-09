import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  Plus,
  FileText,
  ShoppingBag,
  Truck,
  BookOpen,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Receipt,
  Lock,
} from "lucide-react";
import { useTableFeatures } from "@/hooks/use-table-features";
import { SortableHead, FilterBar, PaginationBar } from "@/components/DataTableControls";
import { GLPostingKPIsLive, GLBatchHistoryLive } from "@/hooks/use-gl-batches";
import {
  useQuotations,
  useSalesOrders,
  useDeliveryNotes,
  useCreateQuotation,
  useCreateSalesOrder,
  useConvertQuoteToSO,
  useConfirmSO,
  usePostDelivery,
  useInvoiceFromDelivery,
  useMySalesRoles,
  useSoLines,
} from "@/hooks/use-sales-data";
import { useCustomers } from "@/hooks/use-ar-data";
import { exportToCSV } from "@/lib/csv-export";
import { toast } from "sonner";
import { SALES_ROLE_HINTS } from "@/lib/sales-roles";
import { SalesEmptyState } from "@/components/SalesEmptyState";


const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR");

const EXPORT_HINT_ID = "sales-tx-export-hint";

const statusStyle = (s: string) => {
  switch (s) {
    case "accepted":
    case "converted":
    case "delivered":
    case "completed":
      return "bg-success/15 text-success border-success/20";
    case "sent":
    case "confirmed":
    case "in_production":
    case "partially_delivered":
      return "bg-blue-500/15 text-blue-700 border-blue-500/20";
    case "expired":
    case "cancelled":
      return "bg-destructive/15 text-destructive border-destructive/20";
    case "pending_approval":
      return "bg-amber-500/15 text-amber-700 border-amber-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
};

function CreateQuotationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const create = useCreateQuotation();
  const [form, setForm] = useState({
    customer_id: "",
    quote_number: `QT-${Date.now().toString(36).toUpperCase()}`,
    quote_date: new Date().toISOString().split("T")[0],
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    total: "",
  });

  const handleCreate = async () => {
    if (!form.customer_id || !parseFloat(form.total)) {
      toast.error("Remplissez tous les champs");
      return;
    }
    await create.mutateAsync({ ...form, total: parseFloat(form.total) });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouveau devis</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <select
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={form.customer_id}
              onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            >
              <option value="">— Sélectionner —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">N° Devis</Label>
              <Input
                className="h-8 text-xs"
                value={form.quote_number}
                onChange={(e) => setForm((f) => ({ ...f, quote_number: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.quote_date}
                onChange={(e) => setForm((f) => ({ ...f, quote_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Validité</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Montant (XOF)</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={form.total}
                onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={handleCreate} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: customers = [] } = useCustomers();
  const create = useCreateSalesOrder();
  const [form, setForm] = useState({
    customer_id: "",
    so_number: `SO-${Date.now().toString(36).toUpperCase()}`,
    order_date: new Date().toISOString().split("T")[0],
    total: "",
  });

  const handleCreate = async () => {
    if (!form.customer_id || !parseFloat(form.total)) {
      toast.error("Remplissez tous les champs");
      return;
    }
    await create.mutateAsync({ ...form, total: parseFloat(form.total) });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle commande</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Client *</Label>
            <select
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={form.customer_id}
              onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            >
              <option value="">— Sélectionner —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">N° Commande</Label>
              <Input
                className="h-8 text-xs"
                value={form.so_number}
                onChange={(e) => setForm((f) => ({ ...f, so_number: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={form.order_date}
                onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Montant (XOF)</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={form.total}
              onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={handleCreate} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({
  soId,
  onClose,
}: {
  soId: string | null;
  onClose: () => void;
}) {
  const { data: lines = [] } = useSoLines(soId || undefined);
  const post = usePostDelivery();
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const submit = async () => {
    if (!soId) return;
    const payload = lines
      .map((l) => {
        const row = l as { id: string; quantity: number; quantity_delivered: number };
        const remaining = Number(row.quantity) - Number(row.quantity_delivered || 0);
        const q = parseFloat(qtys[row.id] ?? String(remaining));
        return { so_line_id: row.id, quantity: q };
      })
      .filter((x) => x.quantity > 0);
    if (payload.length === 0) {
      toast.error("Aucune quantité à livrer");
      return;
    }
    await post.mutateAsync({ so_id: soId, lines: payload });
    onClose();
  };

  return (
    <Dialog open={!!soId} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Enregistrer la livraison</DialogTitle>
        </DialogHeader>
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            Cette commande n'a pas de lignes — créez-les d'abord avant de livrer.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {lines.map((l) => {
              const row = l as {
                id: string;
                description: string | null;
                quantity: number;
                quantity_delivered: number;
              };
              const remaining = Number(row.quantity) - Number(row.quantity_delivered || 0);
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 p-2 border border-border rounded text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.description || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Commandé {fmt(row.quantity)} · Livré {fmt(row.quantity_delivered || 0)} ·
                      Reste {fmt(remaining)}
                    </div>
                  </div>
                  <Input
                    type="number"
                    className="h-7 w-24 text-xs"
                    placeholder={String(remaining)}
                    value={qtys[row.id] ?? ""}
                    onChange={(e) => setQtys((q) => ({ ...q, [row.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" className="text-xs" onClick={submit} disabled={post.isPending}>
            {post.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Livrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesTransactions() {
  const { data: quotations = [], isLoading: loadingQt } = useQuotations();
  const { data: orders = [], isLoading: loadingSo } = useSalesOrders();
  const { data: deliveries = [], isLoading: loadingDn } = useDeliveryNotes();
  const { data: customers = [] } = useCustomers();
  const { data: perms } = useMySalesRoles();
  const convert = useConvertQuoteToSO();
  const confirmSo = useConfirmSO();
  const invoice = useInvoiceFromDelivery();

  const [showNewQuote, setShowNewQuote] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [confirmConvertId, setConfirmConvertId] = useState<string | null>(null);
  const [confirmSoId, setConfirmSoId] = useState<string | null>(null);
  const [deliverSoId, setDeliverSoId] = useState<string | null>(null);
  const [confirmInvoiceDnId, setConfirmInvoiceDnId] = useState<string | null>(null);

  // Global filters: période + client + onglet actif (pour export CSV)
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(ninetyAgo);
  const [dateTo, setDateTo] = useState(today);
  const [customerId, setCustomerId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"quotations" | "orders" | "deliveries">("quotations");

  const inRange = (d?: string | null) =>
    !d || ((!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  const matchCustomer = (cid?: string | null) => !customerId || cid === customerId;

  const fQuotations = quotations.filter(
    (q) => inRange(q.quote_date) && matchCustomer(q.customer_id)
  );
  const fOrders = orders.filter(
    (o) => inRange(o.order_date) && matchCustomer(o.customer_id)
  );
  const fDeliveries = deliveries.filter(
    (d) => inRange(d.delivery_date) && matchCustomer(d.customer_id)
  );

  const customerOptions = customers.map((c) => c.name);

  const qtRows = fQuotations.map((q) => ({
    raw: q,
    id: q.quote_number,
    quoteId: q.id,
    date: q.quote_date,
    customer: q.customer?.name || "—",
    total: q.total,
    validUntil: q.valid_until || "—",
    status: q.status,
  }));

  const soRows = fOrders.map((o) => ({
    raw: o,
    id: o.so_number,
    soId: o.id,
    date: o.order_date,
    customer: o.customer?.name || "—",
    qtRef: o.quotation?.quote_number || "—",
    total: o.total,
    status: o.status,
  }));

  const dnRows = fDeliveries.map((d) => ({
    raw: d,
    id: d.dn_number,
    dnId: d.id,
    soRef: d.sales_order?.so_number || "—",
    date: d.delivery_date,
    customer: d.customer?.name || "—",
    status: d.status,
    invoiced: !!d.ar_invoice_id,
  }));

  const qtTable = useTableFeatures({
    data: qtRows,
    pageSize: 10,
    searchableKeys: ["id", "customer"],
    filterConfigs: [
      {
        key: "status",
        label: "Status",
        options: ["draft", "sent", "accepted", "expired", "converted"],
      },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });
  const soTable = useTableFeatures({
    data: soRows,
    pageSize: 10,
    searchableKeys: ["id", "customer"],
    filterConfigs: [
      {
        key: "status",
        label: "Status",
        options: ["draft", "confirmed", "partially_delivered", "delivered", "cancelled"],
      },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });
  const dnTable = useTableFeatures({
    data: dnRows,
    pageSize: 10,
    searchableKeys: ["id", "customer", "soRef"],
    filterConfigs: [
      { key: "status", label: "Status", options: ["draft", "completed", "cancelled"] },
      { key: "customer", label: "Customer", options: customerOptions },
    ],
  });

  const canConfirm = perms?.canConfirm;
  const canDeliver = perms?.canDeliver;
  const canInvoice = perms?.canInvoice;
  const noSalesRole = perms && !perms.isAdmin && (perms.roles?.length ?? 0) === 0;

  const customerName = customerId
    ? customers.find((c) => c.id === customerId)?.name ?? "—"
    : "Tous";
  const filterSummary = (statusFilter?: string) =>
    `Période ${dateFrom} → ${dateTo} · Client : ${customerName}${
      statusFilter ? ` · Statut : ${statusFilter}` : ""
    }`;

  const handleExport = () => {
    if (!perms?.canExport) {
      toast.error("Export refusé — rôle Manager ou Controller requis");
      return;
    }
    const rowsByTab = {
      quotations: qtTable.processedData,
      orders: soTable.processedData,
      deliveries: dnTable.processedData,
    } as const;
    if (rowsByTab[activeTab].length === 0) {
      toast.info("Aucune donnée à exporter (vérifiez les filtres)");
      return;
    }
    if (activeTab === "quotations") {

      exportToCSV(
        qtTable.processedData,
        [
          { key: "id", header: "Devis" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "total", header: "Total (XOF)" },
          { key: "validUntil", header: "Valide jusqu'au" },
          { key: "status", header: "Statut" },
        ],
        `quotations-${dateFrom}-${dateTo}`
      );
    } else if (activeTab === "orders") {
      exportToCSV(
        soTable.processedData,
        [
          { key: "id", header: "Commande" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "qtRef", header: "Devis" },
          { key: "total", header: "Total (XOF)" },
          { key: "status", header: "Statut" },
        ],
        `sales-orders-${dateFrom}-${dateTo}`
      );
    } else {
      exportToCSV(
        dnTable.processedData,
        [
          { key: "id", header: "BL" },
          { key: "date", header: "Date" },
          { key: "customer", header: "Client" },
          { key: "soRef", header: "Commande" },
          { key: "status", header: "Statut" },
          { key: "invoiced", header: "Facturé" },
        ],
        `deliveries-${dateFrom}-${dateTo}`
      );
    }
  };


  return (
    <PageShell>
      <Breadcrumb
        items={[{ label: "Finance" }, { label: "Sales", href: "/sales" }, { label: "Transactions" }]}
      />
      <GuidanceBanner
        title="Sales Transactions"
        description="Cycle Quote → SO → Delivery → Facture avec actions sécurisées par rôle."
      />

      {noSalesRole && (
        <Card className="border-amber-500/30 bg-amber-500/5 mb-4">
          <CardContent className="p-3 flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-700 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Lecture seule — aucun rôle Sales attribué. Demandez à un administrateur dans{" "}
              <strong>Settings → Users</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-foreground">Sales Transactions</h1>
        <div className="flex gap-2">
          {perms?.canCreate && (
            <>
              <Button size="sm" className="gap-1.5" onClick={() => setShowNewQuote(true)}>
                <Plus className="w-3.5 h-3.5" />
                New Quote
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowNewOrder(true)}>
                <ShoppingBag className="w-3.5 h-3.5" />
                New Order
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleExport}
            disabled={!perms?.canExport}
            aria-label={
              perms?.canExport
                ? `Exporter l'onglet ${activeTab} en CSV`
                : `Export CSV désactivé — ${SALES_ROLE_HINTS.export}`
            }
            aria-describedby={!perms?.canExport ? EXPORT_HINT_ID : undefined}
            title={
              perms?.canExport
                ? `Exporter l'onglet ${activeTab} en CSV (${filterSummary()})`
                : SALES_ROLE_HINTS.export
            }
          >
            {perms?.canExport ? (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Export CSV
          </Button>
          {!perms?.canExport && (
            <span id={EXPORT_HINT_ID} className="sr-only">
              {SALES_ROLE_HINTS.export}
            </span>
          )}

        </div>
      </div>

      {/* Global filters: période + client */}
      <Card className="border-border mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Du</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Au</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <div className="min-w-[200px]">
            <Label className="text-[10px] uppercase text-muted-foreground">Client</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-8 text-xs w-full border border-border rounded-md bg-background px-2"
            >
              <option value="">Tous les clients</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(dateFrom !== ninetyAgo || dateTo !== today || customerId) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-8"
              onClick={() => {
                setDateFrom(ninetyAgo);
                setDateTo(today);
                setCustomerId("");
              }}
            >
              Réinitialiser
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="quotations" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Quotations ({fQuotations.length})
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5" />
            Sales Orders ({fOrders.length})
          </TabsTrigger>
          <TabsTrigger value="deliveries" className="gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            Deliveries ({fDeliveries.length})
          </TabsTrigger>
        </TabsList>


        {/* QUOTATIONS */}
        <TabsContent value="quotations">
          <Card className="border-border">
            <CardContent className="p-0">
              <FilterBar
                search={qtTable.search}
                onSearch={qtTable.setSearch}
                filters={qtTable.filters}
                onFilter={qtTable.setFilter}
                onClear={qtTable.clearFilters}
                filterConfigs={qtTable.filterConfigs}
                activeCount={qtTable.activeFilterCount}
                searchPlaceholder="Search quotes…"
              />
              {loadingQt ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : qtTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      quotations.length === 0
                        ? "Aucun devis enregistré"
                        : "Aucun devis ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(qtTable.filters.status as string | undefined)}
                    hint={
                      quotations.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={!perms?.canCreate ? "create" : undefined}
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <SortableHead label="Quote #" sortKey="id" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Total (XOF)" sortKey="total" sort={qtTable.sort} onSort={qtTable.toggleSort} className="text-right" />
                      <SortableHead label="Valid Until" sortKey="validUntil" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <SortableHead label="Status" sortKey="status" sort={qtTable.sort} onSort={qtTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qtTable.pagedData.map((q) => (
                      <TableRow key={q.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{q.id}</TableCell>
                        <TableCell>{q.date}</TableCell>
                        <TableCell className="font-medium">{q.customer}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(q.total)}</TableCell>
                        <TableCell className="text-muted-foreground">{q.validUntil}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(q.status)}`} variant="outline">
                            {q.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {q.status !== "converted" && q.status !== "expired" ? (
                            canConfirm ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] gap-1"
                                onClick={() => setConfirmConvertId(q.quoteId)}
                              >
                                <ArrowRight className="w-3 h-3" />
                                Convertir → SO
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.confirm}`} title={SALES_ROLE_HINTS.confirm}>
                                <Lock className="w-3 h-3" />
                                RBAC
                              </Badge>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={qtTable.page}
                totalPages={qtTable.totalPages}
                totalItems={qtTable.totalItems}
                pageSize={qtTable.pageSize}
                onPageChange={qtTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* SALES ORDERS */}
        <TabsContent value="orders">
          <Card className="border-border">
            <CardContent className="p-0">
              <FilterBar
                search={soTable.search}
                onSearch={soTable.setSearch}
                filters={soTable.filters}
                onFilter={soTable.setFilter}
                onClear={soTable.clearFilters}
                filterConfigs={soTable.filterConfigs}
                activeCount={soTable.activeFilterCount}
                searchPlaceholder="Search orders…"
              />
              {loadingSo ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : soTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      orders.length === 0
                        ? "Aucune commande enregistrée"
                        : "Aucune commande ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(soTable.filters.status as string | undefined)}
                    hint={
                      orders.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={!canConfirm ? "confirm" : undefined}
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <SortableHead label="SO #" sortKey="id" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Quote Ref" sortKey="qtRef" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <SortableHead label="Total (XOF)" sortKey="total" sort={soTable.sort} onSort={soTable.toggleSort} className="text-right" />
                      <SortableHead label="Status" sortKey="status" sort={soTable.sort} onSort={soTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soTable.pagedData.map((so) => (
                      <TableRow key={so.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{so.id}</TableCell>
                        <TableCell>{so.date}</TableCell>
                        <TableCell className="font-medium">{so.customer}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{so.qtRef}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(so.total)}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(so.status)}`} variant="outline">
                            {so.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {so.status === "draft" &&
                              (canConfirm ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => setConfirmSoId(so.soId)}
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Confirmer
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.confirm}`} title={SALES_ROLE_HINTS.confirm}>
                                  <Lock className="w-3 h-3" />
                                  RBAC
                                </Badge>
                              ))}
                            {(so.status === "confirmed" || so.status === "partially_delivered") &&
                              (canDeliver ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => setDeliverSoId(so.soId)}
                                >
                                  <Truck className="w-3 h-3" />
                                  Livrer
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.deliver}`} title={SALES_ROLE_HINTS.deliver}>
                                  <Lock className="w-3 h-3" />
                                  RBAC
                                </Badge>
                              ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={soTable.page}
                totalPages={soTable.totalPages}
                totalItems={soTable.totalItems}
                pageSize={soTable.pageSize}
                onPageChange={soTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* DELIVERIES */}
        <TabsContent value="deliveries">
          <Card className="border-border">
            <CardContent className="p-0">
              <FilterBar
                search={dnTable.search}
                onSearch={dnTable.setSearch}
                filters={dnTable.filters}
                onFilter={dnTable.setFilter}
                onClear={dnTable.clearFilters}
                filterConfigs={dnTable.filterConfigs}
                activeCount={dnTable.activeFilterCount}
                searchPlaceholder="Search deliveries…"
              />
              {loadingDn ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : dnTable.pagedData.length === 0 ? (
                <div className="p-4">
                  <SalesEmptyState
                    title={
                      deliveries.length === 0
                        ? "Aucune livraison enregistrée"
                        : "Aucune livraison ne correspond aux filtres"
                    }
                    filterSummary={filterSummary(dnTable.filters.status as string | undefined)}
                    hint={
                      deliveries.length > 0
                        ? "Élargissez la période, changez de client ou réinitialisez le statut."
                        : undefined
                    }
                    missingRoleFor={
                      !canDeliver ? "deliver" : !canInvoice ? "invoice" : undefined
                    }
                  />
                </div>


              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <SortableHead label="DN #" sortKey="id" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="SO Ref" sortKey="soRef" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Date" sortKey="date" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Customer" sortKey="customer" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <SortableHead label="Status" sortKey="status" sort={dnTable.sort} onSort={dnTable.toggleSort} />
                      <TableCell className="text-[11px] font-medium text-muted-foreground">Actions</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dnTable.pagedData.map((d) => (
                      <TableRow key={d.id} className="text-xs">
                        <TableCell className="font-mono text-primary">{d.id}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{d.soRef}</TableCell>
                        <TableCell>{d.date}</TableCell>
                        <TableCell className="font-medium">{d.customer}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${statusStyle(d.status)}`} variant="outline">
                            {d.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {d.invoiced ? (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Receipt className="w-3 h-3" />
                              Facturé
                            </Badge>
                          ) : d.status === "completed" ? (
                            canInvoice ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] gap-1"
                                onClick={() => setConfirmInvoiceDnId(d.dnId)}
                              >
                                <Receipt className="w-3 h-3" />
                                Facturer
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-[10px] gap-1" role="img" aria-label={`Action verrouillée — ${SALES_ROLE_HINTS.invoice}`} title={SALES_ROLE_HINTS.invoice}>
                                <Lock className="w-3 h-3" />
                                RBAC
                              </Badge>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <PaginationBar
                page={dnTable.page}
                totalPages={dnTable.totalPages}
                totalItems={dnTable.totalItems}
                pageSize={dnTable.pageSize}
                onPageChange={dnTable.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">GL Posting — Sales</h2>
        </div>
        <GLPostingKPIsLive module="Sales" />
        <GLBatchHistoryLive module="Sales" />
      </div>

      <CreateQuotationDialog open={showNewQuote} onClose={() => setShowNewQuote(false)} />
      <CreateOrderDialog open={showNewOrder} onClose={() => setShowNewOrder(false)} />
      <DeliverDialog soId={deliverSoId} onClose={() => setDeliverSoId(null)} />

      <AlertDialog open={!!confirmConvertId} onOpenChange={(o) => !o && setConfirmConvertId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convertir ce devis en commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une nouvelle commande de vente sera créée avec les mêmes lignes. Le devis sera marqué
              comme converti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmConvertId) await convert.mutateAsync(confirmConvertId);
                setConfirmConvertId(null);
              }}
            >
              {convert.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Convertir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmSoId} onOpenChange={(o) => !o && setConfirmSoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer cette commande ?</AlertDialogTitle>
            <AlertDialogDescription>
              La commande passera au statut « confirmed » et pourra être livrée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmSoId) await confirmSo.mutateAsync(confirmSoId);
                setConfirmSoId(null);
              }}
            >
              {confirmSo.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmInvoiceDnId}
        onOpenChange={(o) => !o && setConfirmInvoiceDnId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Générer la facture client ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une facture AR sera créée à partir de cette livraison et reliée à la commande
              d'origine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmInvoiceDnId) await invoice.mutateAsync(confirmInvoiceDnId);
                setConfirmInvoiceDnId(null);
              }}
            >
              {invoice.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Facturer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
