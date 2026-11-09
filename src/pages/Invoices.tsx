import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface InvoiceItem {
  id: number;
  product: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: string;
}

const clients = ["Acme Corp", "TechStart Inc", "Global Solutions", "Prime Consulting", "Nova Industries"];

let nextId = 3;

const Invoices = () => {
  const [client, setClient] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date());
  const [dueDate, setDueDate] = useState<Date>(new Date(Date.now() + 30 * 86400000));
  const [status, setStatus] = useState("draft");
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: 1, product: "", description: "", quantity: "1", unitPrice: "", tax: "20" },
    { id: 2, product: "", description: "", quantity: "1", unitPrice: "", tax: "20" },
  ]);

  const addItem = () => {
    setItems([...items, { id: nextId++, product: "", description: "", quantity: "1", unitPrice: "", tax: "20" }]);
  };

  const removeItem = (id: number) => {
    if (items.length > 1) setItems(items.filter((i) => i.id !== id));
  };

  const updateItem = (id: number, field: keyof InvoiceItem, value: string) => {
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  };

  const getLineTotal = (item: InvoiceItem) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unitPrice) || 0;
    const tax = parseFloat(item.tax) || 0;
    return qty * price * (1 + tax / 100);
  };

  const subtotal = items.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0);
  const totalTax = items.reduce((sum, i) => {
    const base = (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0);
    return sum + base * ((parseFloat(i.tax) || 0) / 100);
  }, 0);
  const total = subtotal + totalTax;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <TopNav />
          <main className="flex-1 p-4 lg:p-6 space-y-5 overflow-auto">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="hover:text-foreground cursor-pointer">Dashboard</span>
              <span>/</span>
              <span className="hover:text-foreground cursor-pointer">Invoices</span>
              <span>/</span>
              <span className="text-foreground font-medium">Create Invoice</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-foreground">Create Invoice</h1>
                <p className="text-xs text-muted-foreground">INV-2026-0087 · Status: {status.charAt(0).toUpperCase() + status.slice(1)}</p>
              </div>
            </div>

            {/* Header Fields */}
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Client</label>
                  <Select value={client} onValueChange={setClient}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Invoice Number</label>
                  <Input className="h-9 text-xs bg-muted/50" value="INV-2026-0087" readOnly />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Invoice Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal text-xs">
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {format(invoiceDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={invoiceDate} onSelect={(d) => d && setInvoiceDate(d)} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Due Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal text-xs">
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {format(dueDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dueDate} onSelect={(d) => d && setDueDate(d)} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Items Table + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Items Table */}
              <div className="lg:col-span-2 bg-card rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase tracking-wider">Product/Service</th>
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Description</th>
                        <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider w-16">Qty</th>
                        <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider w-24">Unit Price</th>
                        <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider w-16">Tax %</th>
                        <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider w-24">Total</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="py-1.5 px-4">
                            <Input className="border-0 bg-transparent shadow-none h-8 text-xs" placeholder="Product name" value={item.product} onChange={(e) => updateItem(item.id, "product", e.target.value)} />
                          </td>
                          <td className="py-1.5 px-4 hidden sm:table-cell">
                            <Input className="border-0 bg-transparent shadow-none h-8 text-xs" placeholder="Description" value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} />
                          </td>
                          <td className="py-1.5 px-3">
                            <Input className="border-0 bg-transparent shadow-none h-8 text-xs text-right tabular-nums" type="number" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} />
                          </td>
                          <td className="py-1.5 px-3">
                            <Input className="border-0 bg-transparent shadow-none h-8 text-xs text-right tabular-nums" placeholder="0.00" type="number" value={item.unitPrice} onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)} />
                          </td>
                          <td className="py-1.5 px-3">
                            <Input className="border-0 bg-transparent shadow-none h-8 text-xs text-right tabular-nums" type="number" value={item.tax} onChange={(e) => updateItem(item.id, "tax", e.target.value)} />
                          </td>
                          <td className="py-1.5 px-3 text-right font-medium text-card-foreground tabular-nums text-xs">
                            ${getLineTotal(item).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-border">
                  <Button variant="outline" size="sm" onClick={addItem} className="gap-1.5 text-xs h-8">
                    <Plus className="w-3.5 h-3.5" /> Add Line
                  </Button>
                </div>
              </div>

              {/* Summary Panel */}
              <div className="bg-card rounded-lg border border-border p-4 h-fit space-y-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Financial Summary</h3>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium text-card-foreground tabular-nums">${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium text-card-foreground tabular-nums">${totalTax.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-2.5 flex justify-between">
                    <span className="text-sm font-semibold text-card-foreground">Total Due</span>
                    <span className="text-lg font-semibold text-foreground tabular-nums">${total.toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Status</label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 pt-2">
                  <Button size="sm" className="w-full text-xs h-8">Send Invoice</Button>
                  <Button variant="outline" size="sm" className="w-full text-xs h-8">Download PDF</Button>
                  <Button variant="ghost" size="sm" className="w-full text-xs h-8">Save Draft</Button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Invoices;
