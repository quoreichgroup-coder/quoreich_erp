import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { useReportTemplates, useSaveReportTemplate, useDeleteReportTemplate, useARAging, useARInvoices } from "@/hooks/use-ar-data";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { HelpIcon } from "@/components/HelpIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import {
  Search,
  Download,
  Save,
  Plus,
  FileText,
  FolderOpen,
  Clock,
  Layers,
  GripVertical,
  Printer,
  Filter,
  ChevronDown,
  ChevronRight,
  Trash2,
  Shield,
  Eye,
  X,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const fmt = (n: number) => n.toLocaleString("fr-FR");

/* ──────── DATA SOURCES ──────── */

const dataSources = [
  { id: "invoices", label: "Factures clients", fields: ["N° Facture", "Client", "Date", "Échéance", "Montant HT", "TVA", "Montant TTC", "Statut", "Journal", "Devise"] },
  { id: "receipts", label: "Encaissements", fields: ["N° Encaissement", "Client", "Date", "Montant", "Mode paiement", "Banque", "Statut", "Référence facture"] },
  { id: "credit_notes", label: "Avoirs", fields: ["N° Avoir", "Client", "Date", "Montant", "Motif", "Facture liée", "Statut"] },
  { id: "aging", label: "Balance âgée", fields: ["Client", "Total dû", "0-30j", "30-60j", "60-90j", "90+j", "Limite crédit", "DSO"] },
  { id: "customers", label: "Clients", fields: ["Code", "Raison sociale", "Pays", "Catégorie", "Limite crédit", "Solde", "Statut"] },
];

/* ──────── AVAILABLE COLUMNS ──────── */

const availableColumns = [
  { id: "client", label: "Client", type: "dimension" },
  { id: "invoice_no", label: "N° Facture", type: "dimension" },
  { id: "date", label: "Date", type: "dimension" },
  { id: "due_date", label: "Date échéance", type: "dimension" },
  { id: "amount_ht", label: "Montant HT", type: "measure" },
  { id: "tva", label: "TVA", type: "measure" },
  { id: "amount_ttc", label: "Montant TTC", type: "measure" },
  { id: "paid", label: "Montant réglé", type: "measure" },
  { id: "balance", label: "Solde restant", type: "measure" },
  { id: "status", label: "Statut", type: "dimension" },
  { id: "dso", label: "DSO", type: "measure" },
  { id: "aging_bucket", label: "Tranche âge", type: "dimension" },
  { id: "category", label: "Catégorie client", type: "dimension" },
  { id: "region", label: "Région", type: "dimension" },
  { id: "currency", label: "Devise", type: "dimension" },
];

/* ──────── GROUPING OPTIONS ──────── */

const groupingOptions = [
  { id: "client", label: "Par client" },
  { id: "aging", label: "Par tranche d'âge" },
  { id: "status", label: "Par statut" },
  { id: "period", label: "Par période" },
  { id: "region", label: "Par région" },
  { id: "category", label: "Par catégorie" },
];

/* ──────── SAVED TEMPLATES ──────── */

const savedTemplates = [
  { id: 1, name: "Balance âgée détaillée", source: "aging", columns: 8, createdBy: "A. Kouassi", date: "2026-02-20", status: "Active", permission: "Finance" },
  { id: 2, name: "Encaissements mensuels", source: "receipts", columns: 6, createdBy: "C. Bamba", date: "2026-02-15", status: "Active", permission: "Finance" },
  { id: 3, name: "Factures impayées > 60j", source: "invoices", columns: 7, createdBy: "B. Traoré", date: "2026-01-28", status: "Active", permission: "AR Manager" },
  { id: 4, name: "Suivi DSO par client", source: "customers", columns: 5, createdBy: "M. Diallo", date: "2026-01-10", status: "Draft", permission: "Direction" },
  { id: 5, name: "Rapport crédit client", source: "customers", columns: 6, createdBy: "A. Kouassi", date: "2025-12-15", status: "Active", permission: "Risk" },
];

/* ──────── SCHEDULED REPORTS ──────── */

const scheduledReports = [
  { name: "Balance âgée hebdomadaire", frequency: "Hebdo", nextRun: "2026-03-07", recipients: "ar-team@quoreich.com", format: "Excel", status: "Active" },
  { name: "DSO mensuel", frequency: "Mensuel", nextRun: "2026-04-01", recipients: "cfo@quoreich.com", format: "PDF", status: "Active" },
  { name: "Rapport risque crédit", frequency: "Quotidien", nextRun: "2026-03-03", recipients: "risk@quoreich.com", format: "PDF + Excel", status: "Active" },
  { name: "Encaissements trimestriels", frequency: "Trimestriel", nextRun: "2026-04-01", recipients: "direction@quoreich.com", format: "PDF", status: "Draft" },
];

/* preview data and aging pie are now computed from DB inside component */

/* ──────── PERMISSION ROLES ──────── */

const permissionRoles = [
  { role: "AR Analyst", canView: true, canCreate: true, canExport: true, canSchedule: false, canAdmin: false },
  { role: "AR Manager", canView: true, canCreate: true, canExport: true, canSchedule: true, canAdmin: false },
  { role: "Finance Director", canView: true, canCreate: true, canExport: true, canSchedule: true, canAdmin: true },
  { role: "Auditor", canView: true, canCreate: false, canExport: true, canSchedule: false, canAdmin: false },
];

/* ──────── NAVIGATION ──────── */

const navSections = [
  { id: "builder", label: "Report Builder", icon: Layers },
  { id: "templates", label: "Templates sauvegardés", icon: FolderOpen },
  { id: "scheduled", label: "Rapports planifiés", icon: Clock },
  { id: "permissions", label: "Permissions", icon: Shield },
];

/* ──────── COMPONENT ──────── */

export default function ARReporting() {
  const [activeSection, setActiveSection] = useState("builder");
  const [selectedSource, setSelectedSource] = useState("invoices");
  const [selectedColumns, setSelectedColumns] = useState<string[]>(["client", "invoice_no", "date", "due_date", "amount_ttc", "paid", "balance", "status"]);
  const [groupBy, setGroupBy] = useState("client");
  const [showPreview, setShowPreview] = useState(true);
  const [searchTemplates, setSearchTemplates] = useState("");

  // Filters state
  const [filterStatus, setFilterStatus] = useState("Tous");
  const [filterPeriodFrom, setFilterPeriodFrom] = useState("2026-01-01");
  const [filterPeriodTo, setFilterPeriodTo] = useState("2026-12-31");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterClient, setFilterClient] = useState("Tous");

  // DB hooks
  const { data: templates = [] } = useReportTemplates("ar");
  const saveTemplate = useSaveReportTemplate();
  const deleteTemplate = useDeleteReportTemplate();
  const { data: invoices = [] } = useARInvoices();
  const { data: aging = [] } = useARAging();

  const previewRows = useMemo(() => {
    return invoices
      .filter((inv: any) => {
        if (filterStatus !== "Tous" && inv.status !== filterStatus.toLowerCase()) return false;
        if (filterClient !== "Tous" && inv.customer?.name !== filterClient) return false;
        if (filterPeriodFrom && inv.invoice_date < filterPeriodFrom) return false;
        if (filterPeriodTo && inv.invoice_date > filterPeriodTo) return false;
        const total = Number(inv.total || 0);
        if (filterAmountMin && total < Number(filterAmountMin)) return false;
        if (filterAmountMax && total > Number(filterAmountMax)) return false;
        return true;
      })
      .slice(0, 100)
      .map((inv: any) => ({
        client: inv.customer?.name ?? "—",
        invoice: inv.invoice_number,
        date: inv.invoice_date,
        due: inv.due_date,
        amountHT: Number(inv.subtotal || 0),
        tva: Number(inv.tax_amount || 0),
        amountTTC: Number(inv.total || 0),
        paid: Number(inv.amount_paid || 0),
        balance: Number(inv.total || 0) - Number(inv.amount_paid || 0),
        status: inv.status,
        bucket: "—",
      }));
  }, [invoices, filterStatus, filterClient, filterPeriodFrom, filterPeriodTo, filterAmountMin, filterAmountMax]);

  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i: any) => i.customer?.name && set.add(i.customer.name));
    return Array.from(set);
  }, [invoices]);

  const agingPieData = useMemo(() => {
    const sums = aging.reduce(
      (acc: any, r: any) => {
        acc.b1 += Number(r.bucket_0_30 || 0);
        acc.b2 += Number(r.bucket_31_60 || 0);
        acc.b3 += Number(r.bucket_61_90 || 0);
        acc.b4 += Number(r.bucket_90_plus || 0);
        return acc;
      },
      { b1: 0, b2: 0, b3: 0, b4: 0 }
    );
    return [
      { name: "0-30j", value: sums.b1, color: "hsl(var(--primary))" },
      { name: "30-60j", value: sums.b2, color: "hsl(var(--muted-foreground))" },
      { name: "60-90j", value: sums.b3, color: "hsl(210, 40%, 60%)" },
      { name: "90+j", value: sums.b4, color: "hsl(var(--destructive))" },
    ];
  }, [aging]);

  const topCustomers = useMemo(() => {
    return [...aging]
      .sort((a: any, b: any) => Number(b.total_outstanding || 0) - Number(a.total_outstanding || 0))
      .slice(0, 5)
      .map((r: any) => ({ client: (r.customer_name || "—").slice(0, 12), amount: Number(r.total_outstanding || 0) / 1000 }));
  }, [aging]);

  const toggleColumn = (colId: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colId) ? prev.filter((c) => c !== colId) : [...prev, colId]
    );
  };

  const handleSaveTemplate = () => {
    const name = window.prompt("Nom du modèle ?");
    if (!name) return;
    saveTemplate.mutate({
      module: "ar",
      name,
      data_source: selectedSource,
      columns: selectedColumns as any,
      filters: { status: filterStatus, client: filterClient, from: filterPeriodFrom, to: filterPeriodTo, min: filterAmountMin, max: filterAmountMax } as any,
      group_by: groupBy,
    });
  };

  const handleLoadTemplate = (t: any) => {
    setSelectedSource(t.data_source);
    setSelectedColumns(t.columns || []);
    setGroupBy(t.group_by || "client");
    const f = t.filters || {};
    setFilterStatus(f.status ?? "Tous");
    setFilterClient(f.client ?? "Tous");
    setFilterPeriodFrom(f.from ?? "");
    setFilterPeriodTo(f.to ?? "");
    setFilterAmountMin(f.min ?? "");
    setFilterAmountMax(f.max ?? "");
    setActiveSection("builder");
  };

  const currentSource = dataSources.find((s) => s.id === selectedSource);

  return (
    <PageShell>
      <Breadcrumb
        items={[
          { label: "Finance", href: "/" },
          { label: "AR", href: "/receivables" },
          { label: "Reporting" },
        ]}
      />
      <GuidanceBanner message="Moteur de reporting dynamique AR — construisez des rapports personnalisés avec sélection de colonnes, filtres avancés, groupement dynamique et export PDF/Excel. Sauvegardez vos configurations en modèles réutilisables." />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Reporting — Comptes Clients</h1>
          <p className="text-xs text-muted-foreground">Moteur de reporting dynamique · FY 2025-2026</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Navigation */}
        <div className="lg:w-48 shrink-0">
          <nav className="space-y-0.5">
            {navSections.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors rounded-md",
                  activeSection === item.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <item.icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 space-y-4">

          {/* ════════════ REPORT BUILDER ════════════ */}
          {activeSection === "builder" && (
            <>
              {/* Step 1: Data Source */}
              <div className="card-elevated p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                  <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                    Source de données
                    <HelpIcon text="Sélectionnez la table source principale pour votre rapport. Les champs disponibles dépendent de cette sélection." />
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dataSources.map((src) => (
                    <button
                      key={src.id}
                      onClick={() => setSelectedSource(src.id)}
                      className={cn(
                        "px-3 py-2 rounded-md text-xs font-medium border transition-colors",
                        selectedSource === src.id
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {src.label}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">({src.fields.length} champs)</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2: Columns */}
              <div className="card-elevated p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                  <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                    Colonnes du rapport
                    <HelpIcon text="Sélectionnez les colonnes à inclure. Les dimensions (texte) et mesures (numériques) sont différenciées par couleur." />
                  </p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {availableColumns.map((col) => (
                    <label
                      key={col.id}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-xs",
                        selectedColumns.includes(col.id)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedColumns.includes(col.id)}
                        onChange={() => toggleColumn(col.id)}
                        className="rounded border-input"
                      />
                      <GripVertical className="w-3 h-3 text-muted-foreground" />
                      <span className="text-foreground">{col.label}</span>
                      <span className={cn(
                        "ml-auto text-[9px] px-1.5 py-0.5 rounded uppercase font-medium",
                        col.type === "measure" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      )}>
                        {col.type === "measure" ? "Mesure" : "Dim"}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">{selectedColumns.length} colonnes sélectionnées</p>
              </div>

              {/* Step 3: Advanced Filters */}
              <div className="card-elevated p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">3</span>
                  <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                    Filtres avancés
                    <HelpIcon text="Appliquez des filtres pour restreindre les données du rapport. Combinez plusieurs critères." />
                  </p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Statut</label>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                    >
                      <option>Tous</option>
                      <option>Ouvert</option>
                      <option>Soldé</option>
                      <option>Overdue</option>
                      <option>Draft</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Client</label>
                    <select
                      value={filterClient}
                      onChange={(e) => setFilterClient(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                    >
                      <option>Tous</option>
                      {customerOptions.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Période du</label>
                    <input
                      type="date"
                      value={filterPeriodFrom}
                      onChange={(e) => setFilterPeriodFrom(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Période au</label>
                    <input
                      type="date"
                      value={filterPeriodTo}
                      onChange={(e) => setFilterPeriodTo(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Montant min</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={filterAmountMin}
                      onChange={(e) => setFilterAmountMin(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Montant max</label>
                    <input
                      type="number"
                      placeholder="∞"
                      value={filterAmountMax}
                      onChange={(e) => setFilterAmountMax(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Devise</label>
                    <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs">
                      <option>Toutes</option>
                      <option>XOF</option>
                      <option>EUR</option>
                      <option>USD</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">Tranche d'âge</label>
                    <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs">
                      <option>Toutes</option>
                      <option>0-30 jours</option>
                      <option>30-60 jours</option>
                      <option>60-90 jours</option>
                      <option>90+ jours</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Step 4: Grouping */}
              <div className="card-elevated p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">4</span>
                  <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                    Groupement dynamique
                    <HelpIcon text="Regroupez les lignes du rapport par une dimension. Les sous-totaux sont calculés automatiquement." />
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {groupingOptions.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGroupBy(g.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                        groupBy === g.id
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions Bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-primary h-8 px-4 text-xs flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Générer l'aperçu
                </button>
                <button onClick={handleSaveTemplate} disabled={saveTemplate.isPending} className="btn-outline h-8 px-3 text-xs flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5" /> Sauvegarder modèle
                </button>
                <button className="btn-outline h-8 px-3 text-xs flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export PDF
                </button>
                <button className="btn-outline h-8 px-3 text-xs flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export Excel
                </button>
                <button className="btn-outline h-8 px-3 text-xs flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Imprimer
                </button>
              </div>

              {/* Preview Table */}
              {showPreview && (
                <div className="card-elevated overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Aperçu du rapport</p>
                      <p className="text-[10px] text-muted-foreground">
                        Source : {currentSource?.label} · {selectedColumns.length} colonnes · Groupé {groupingOptions.find(g => g.id === groupBy)?.label.toLowerCase()}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{previewRows.length} lignes</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {selectedColumns.includes("client") && <th>Client</th>}
                          {selectedColumns.includes("invoice_no") && <th>N° Facture</th>}
                          {selectedColumns.includes("date") && <th>Date</th>}
                          {selectedColumns.includes("due_date") && <th>Échéance</th>}
                          {selectedColumns.includes("amount_ht") && <th className="text-right">Montant HT</th>}
                          {selectedColumns.includes("tva") && <th className="text-right">TVA</th>}
                          {selectedColumns.includes("amount_ttc") && <th className="text-right">Montant TTC</th>}
                          {selectedColumns.includes("paid") && <th className="text-right">Réglé</th>}
                          {selectedColumns.includes("balance") && <th className="text-right">Solde</th>}
                          {selectedColumns.includes("status") && <th>Statut</th>}
                          {selectedColumns.includes("aging_bucket") && <th>Tranche</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={row.invoice}>
                            {selectedColumns.includes("client") && <td className="font-medium text-foreground">{row.client}</td>}
                            {selectedColumns.includes("invoice_no") && <td className="tabular-nums font-medium">{row.invoice}</td>}
                            {selectedColumns.includes("date") && <td className="tabular-nums">{row.date}</td>}
                            {selectedColumns.includes("due_date") && <td className="tabular-nums">{row.due}</td>}
                            {selectedColumns.includes("amount_ht") && <td className="text-right tabular-nums">{fmt(row.amountHT)}</td>}
                            {selectedColumns.includes("tva") && <td className="text-right tabular-nums">{fmt(row.tva)}</td>}
                            {selectedColumns.includes("amount_ttc") && <td className="text-right tabular-nums font-medium">{fmt(row.amountTTC)}</td>}
                            {selectedColumns.includes("paid") && <td className="text-right tabular-nums">{fmt(row.paid)}</td>}
                            {selectedColumns.includes("balance") && (
                              <td className={cn("text-right tabular-nums font-medium", row.balance > 0 ? "text-destructive" : "text-success")}>
                                {fmt(row.balance)}
                              </td>
                            )}
                            {selectedColumns.includes("status") && <td><StatusBadge status={row.status} /></td>}
                            {selectedColumns.includes("aging_bucket") && <td className="text-muted-foreground">{row.bucket}</td>}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={selectedColumns.includes("client") && selectedColumns.includes("invoice_no") ? 2 : 1} className="text-xs">Total</td>
                          {selectedColumns.includes("date") && <td />}
                          {selectedColumns.includes("due_date") && <td />}
                          {selectedColumns.includes("amount_ht") && <td className="text-right tabular-nums">{fmt(previewRows.reduce((s, r) => s + r.amountHT, 0))}</td>}
                          {selectedColumns.includes("tva") && <td className="text-right tabular-nums">{fmt(previewRows.reduce((s, r) => s + r.tva, 0))}</td>}
                          {selectedColumns.includes("amount_ttc") && <td className="text-right tabular-nums">{fmt(previewRows.reduce((s, r) => s + r.amountTTC, 0))}</td>}
                          {selectedColumns.includes("paid") && <td className="text-right tabular-nums">{fmt(previewRows.reduce((s, r) => s + r.paid, 0))}</td>}
                          {selectedColumns.includes("balance") && <td className="text-right tabular-nums text-destructive">{fmt(previewRows.reduce((s, r) => s + r.balance, 0))}</td>}
                          {selectedColumns.includes("status") && <td />}
                          {selectedColumns.includes("aging_bucket") && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Aging Pie Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card-elevated p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    Répartition par tranche d'âge
                    <HelpIcon text="Visualisation de la répartition des créances ouvertes par tranche d'antériorité." />
                  </p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={agingPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {agingPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => [`${fmt(value)} XOF`, ""]}
                          contentStyle={{
                            fontSize: 11,
                            borderRadius: 6,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--card))",
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 11 }}
                          formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card-elevated p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    Top 5 clients par encours
                  </p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topCustomers}
                        layout="vertical"
                        barCategoryGap="15%"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis dataKey="client" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={60} />
                        <Tooltip
                          formatter={(value: number) => [`${fmt(value * 1000)} XOF`, "Encours"]}
                          contentStyle={{
                            fontSize: 11,
                            borderRadius: 6,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--card))",
                          }}
                        />
                        <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ════════════ TEMPLATES ════════════ */}
          {activeSection === "templates" && (
            <div className="card-elevated overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Modèles de rapports sauvegardés</h3>
                  <HelpIcon text="Modèles réutilisables. Cliquez pour charger un modèle dans le Report Builder." />
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Rechercher..."
                      value={searchTemplates}
                      onChange={(e) => setSearchTemplates(e.target.value)}
                      className="h-8 pl-8 pr-3 w-48 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <button className="btn-primary h-7 px-3 text-[11px] flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Nouveau modèle
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nom du modèle</th>
                      <th>Source</th>
                      <th>Colonnes</th>
                      <th>Créé par</th>
                      <th>Date</th>
                      <th>Statut</th>
                      <th>Permission</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates
                      .filter((t: any) => t.name.toLowerCase().includes(searchTemplates.toLowerCase()))
                      .map((t: any) => (
                        <tr key={t.id}>
                          <td className="font-medium text-foreground">{t.name}</td>
                          <td className="text-muted-foreground">{dataSources.find(s => s.id === t.data_source)?.label ?? t.data_source}</td>
                          <td className="tabular-nums">{(t.columns || []).length}</td>
                          <td className="text-muted-foreground">—</td>
                          <td className="tabular-nums text-muted-foreground">{new Date(t.created_at).toLocaleDateString("fr-FR")}</td>
                          <td><StatusBadge status={t.status} /></td>
                          <td>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{t.permission ?? "—"}</span>
                          </td>
                          <td className="text-right">
                            <button onClick={() => handleLoadTemplate(t)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Charger">
                              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            <button onClick={() => deleteTemplate.mutate(t.id)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Supprimer">
                              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    {templates.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-6">Aucun modèle sauvegardé</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════════════ SCHEDULED ════════════ */}
          {activeSection === "scheduled" && (
            <div className="card-elevated overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground">Rapports planifiés</h3>
                  <HelpIcon text="Automatisez la génération et l'envoi de rapports par email selon un calendrier défini." />
                </div>
                <button className="btn-primary h-7 px-3 text-[11px] flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Planifier un rapport
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Rapport</th>
                      <th>Fréquence</th>
                      <th>Prochaine exécution</th>
                      <th>Destinataires</th>
                      <th>Format</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledReports.map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium text-foreground">{r.name}</td>
                        <td>{r.frequency}</td>
                        <td className="tabular-nums text-muted-foreground">{r.nextRun}</td>
                        <td className="text-muted-foreground">{r.recipients}</td>
                        <td>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{r.format}</span>
                        </td>
                        <td><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════════════ PERMISSIONS ════════════ */}
          {activeSection === "permissions" && (
            <div className="card-elevated overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
                <h3 className="text-sm font-medium text-foreground">Matrice des permissions — Reporting AR</h3>
                <HelpIcon text="Contrôlez l'accès aux rapports par rôle. Les permissions déterminent qui peut voir, créer, exporter, planifier et administrer les rapports." />
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Rôle</th>
                      <th className="text-center">Consulter</th>
                      <th className="text-center">Créer</th>
                      <th className="text-center">Exporter</th>
                      <th className="text-center">Planifier</th>
                      <th className="text-center">Administrer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissionRoles.map((r) => (
                      <tr key={r.role}>
                        <td className="font-medium text-foreground">{r.role}</td>
                        {[r.canView, r.canCreate, r.canExport, r.canSchedule, r.canAdmin].map((can, i) => (
                          <td key={i} className="text-center">
                            {can ? (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-success/10 text-success text-[10px]">✓</span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-[10px]">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-border">
                <p className="text-[10px] text-muted-foreground">
                  Les permissions sont gérées dans Administration → User & Roles. Contactez un administrateur pour modifier les accès.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
