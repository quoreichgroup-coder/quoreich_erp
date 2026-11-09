import { useState, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2, Check, AlertCircle, X, Search, Download, Upload, RotateCcw, ChevronLeft, ChevronRight as ChevronRightIcon, ChevronsLeft, ChevronsRight, ArrowUpDown, Filter, Loader2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useJournalEntries, useGLAccounts, useCreateJournalEntry, type JournalEntry } from "@/hooks/use-journal-data";
import { useReverseJournalEntry } from "@/hooks/use-gl-data";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const fmt = (n: number) => n.toLocaleString("fr-FR");

interface FormLine { id: number; account_id: string; label: string; debit: string; credit: string; costCenter: string; department: string; project: string; }

const costCenters = ["CC-100", "CC-200", "CC-300", "CC-400"];
const departments = ["Administration", "Commercial", "Operations", "HR", "Finance"];

let nextLineId = 3;

const JournalEntries = () => {
  const { data: entries = [], isLoading } = useJournalEntries();
  const { data: glAccounts = [] } = useGLAccounts();
  const createEntry = useCreateJournalEntry();
  const reverseEntry = useReverseJournalEntry();

  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [sortField, setSortField] = useState<"date" | "id" | "debitTotal">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // New entry form state
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const [entryJournal, setEntryJournal] = useState("");
  const [entryRef, setEntryRef] = useState("");
  const [entryDesc, setEntryDesc] = useState("");
  const [lines, setLines] = useState<FormLine[]>([
    { id: 1, account_id: "", label: "", debit: "", credit: "", costCenter: "", department: "", project: "" },
    { id: 2, account_id: "", label: "", debit: "", credit: "", costCenter: "", department: "", project: "" },
  ]);

  const addRow = () => setLines([...lines, { id: nextLineId++, account_id: "", label: "", debit: "", credit: "", costCenter: "", department: "", project: "" }]);
  const removeRow = (id: number) => { if (lines.length > 2) setLines(lines.filter((l) => l.id !== id)); };
  const updateLine = (id: number, field: keyof FormLine, value: string) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = totalDebit > 0 && totalDebit === totalCredit;

  // Derive display data from entries
  const enriched = useMemo(() => entries.map(e => {
    const debitTotal = (e.lines || []).reduce((s, l) => s + (l.debit || 0), 0);
    const creditTotal = (e.lines || []).reduce((s, l) => s + (l.credit || 0), 0);
    return { ...e, debitTotal, creditTotal };
  }), [entries]);

  // Filtering
  const filtered = useMemo(() => enriched
    .filter(e => {
      const q = search.toLowerCase();
      const matchSearch = !q || e.entry_number.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q);
      const matchStatus = filterStatus === "All" || e.status.toLowerCase() === filterStatus.toLowerCase();
      const matchSource = filterSource === "All" || e.source.toLowerCase() === filterSource.toLowerCase();
      return matchSearch && matchStatus && matchSource;
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "date") return dir * a.entry_date.localeCompare(b.entry_date);
      if (sortField === "id") return dir * a.entry_number.localeCompare(b.entry_number);
      return dir * (a.debitTotal - b.debitTotal);
    }), [enriched, search, filterStatus, filterSource, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // KPIs
  const totalPosted = enriched.filter(e => e.status === "posted").length;
  const totalDraft = enriched.filter(e => e.status === "draft").length;
  const periodDebits = enriched.filter(e => e.status === "posted").reduce((s, e) => s + e.debitTotal, 0);
  const periodCredits = enriched.filter(e => e.status === "posted").reduce((s, e) => s + e.creditTotal, 0);

  const sourceColors: Record<string, string> = {
    ar_receipt: "bg-primary/10 text-primary",
    ap_payment: "bg-amber-100/80 text-amber-800",
    treasury: "bg-success/10 text-success",
    manual: "bg-muted text-muted-foreground",
  };

  const sourceLabel = (s: string) => {
    const map: Record<string, string> = { ar_receipt: "AR", ap_payment: "AP", treasury: "Treasury", manual: "Manual" };
    return map[s] || s;
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { posted: "Posted", draft: "Draft", reversed: "Reversed" };
    return map[s] || s;
  };

  const handleSave = async (status: "draft" | "posted") => {
    const ref = entryRef || `JE-${format(new Date(), "yyyyMMdd-HHmmss")}`;
    await createEntry.mutateAsync({
      entry_number: ref,
      entry_date: format(entryDate, "yyyy-MM-dd"),
      description: entryDesc,
      source: "manual",
      status,
      lines: lines.filter(l => l.account_id).map(l => ({
        account_id: l.account_id,
        description: l.label,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        cost_center: l.costCenter || undefined,
        department: l.department || undefined,
        project: l.project || undefined,
      })),
    });
    setShowNewEntry(false);
    setLines([
      { id: 1, account_id: "", label: "", debit: "", credit: "", costCenter: "", department: "", project: "" },
      { id: 2, account_id: "", label: "", debit: "", credit: "", costCenter: "", department: "", project: "" },
    ]);
    setEntryDesc("");
    setEntryRef("");
  };

  if (showNewEntry) {
    return (
      <PageShell>
        <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "GL", href: "/journal" }, { label: "Journal Entries", href: "/journal" }, { label: "New Entry" }]} />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">New Journal Entry</h1>
            <p className="text-xs text-muted-foreground">Create a balanced double-entry journal entry</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowNewEntry(false)} className="gap-1.5 text-xs">
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
        </div>

        <div className="card-elevated p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal text-xs", !entryDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {entryDate ? format(entryDate, "dd MMM yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={entryDate} onSelect={(d) => d && setEntryDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Journal</label>
              <Select value={entryJournal} onValueChange={setEntryJournal}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select journal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="purchases">Purchases</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Reference</label>
              <Input className="h-9 text-xs" value={entryRef} onChange={(e) => setEntryRef(e.target.value)} placeholder="Auto-generated if empty" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 uppercase tracking-wider">Description</label>
              <Input className="h-9 text-xs" placeholder="Entry description…" value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Account</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Debit</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Credit</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Cost Center</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Department</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground uppercase tracking-wider">Project</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-1.5 px-3">
                      <Select value={line.account_id} onValueChange={(v) => updateLine(line.id, "account_id", v)}>
                        <SelectTrigger className="border-0 bg-transparent shadow-none h-8 text-xs"><SelectValue placeholder="Account" /></SelectTrigger>
                        <SelectContent>{glAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.code} – {a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 px-3"><Input className="border-0 bg-transparent shadow-none h-8 text-xs" placeholder="Label" value={line.label} onChange={(e) => updateLine(line.id, "label", e.target.value)} /></td>
                    <td className="py-1.5 px-3"><Input className="border-0 bg-transparent shadow-none h-8 text-xs text-right tabular-nums" placeholder="0" type="number" value={line.debit} onChange={(e) => updateLine(line.id, "debit", e.target.value)} /></td>
                    <td className="py-1.5 px-3"><Input className="border-0 bg-transparent shadow-none h-8 text-xs text-right tabular-nums" placeholder="0" type="number" value={line.credit} onChange={(e) => updateLine(line.id, "credit", e.target.value)} /></td>
                    <td className="py-1.5 px-3">
                      <Select value={line.costCenter} onValueChange={(v) => updateLine(line.id, "costCenter", v)}>
                        <SelectTrigger className="border-0 bg-transparent shadow-none h-8 text-xs"><SelectValue placeholder="CC" /></SelectTrigger>
                        <SelectContent>{costCenters.map(cc => <SelectItem key={cc} value={cc}>{cc}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 px-3">
                      <Select value={line.department} onValueChange={(v) => updateLine(line.id, "department", v)}>
                        <SelectTrigger className="border-0 bg-transparent shadow-none h-8 text-xs"><SelectValue placeholder="Dept" /></SelectTrigger>
                        <SelectContent>{departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 px-3"><Input className="border-0 bg-transparent shadow-none h-8 text-xs" placeholder="Project" value={line.project} onChange={(e) => updateLine(line.id, "project", e.target.value)} /></td>
                    <td className="py-1.5 px-3 text-center"><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeRow(line.id)}><Trash2 className="w-3.5 h-3.5" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5 text-xs h-8"><Plus className="w-3.5 h-3.5" /> Add Line</Button>
          </div>
        </div>

        {/* Validation Footer */}
        <div className="card-elevated p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div><span className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Debit</span><p className="text-base font-semibold tabular-nums">{fmt(totalDebit)}</p></div>
              <div><span className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Credit</span><p className="text-base font-semibold tabular-nums">{fmt(totalCredit)}</p></div>
              <div className="flex items-center gap-2">
                {isBalanced ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 border border-success/20">
                    <Check className="w-4 h-4 text-success" />
                    <span className="text-sm font-medium text-success">Balanced</span>
                  </div>
                ) : totalDebit > 0 || totalCredit > 0 ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Unbalanced ({fmt(Math.abs(totalDebit - totalCredit))})</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted border border-border">
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Enter amounts</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="text-xs" disabled={createEntry.isPending} onClick={() => handleSave("draft")}>Save as Draft</Button>
              <Button size="sm" disabled={!isBalanced || createEntry.isPending} className="text-xs gap-1.5" onClick={() => handleSave("posted")}>
                {createEntry.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Post Entry
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "GL", href: "/journal" }, { label: "Journal Entries" }]} />
      <GuidanceBanner message="Post, review, and reverse journal entries. Each entry must be balanced (Total Debit = Total Credit) before posting." />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Journal Entries</h1>
          <p className="text-xs text-muted-foreground">General Ledger · FY 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"><Upload className="w-3.5 h-3.5" /> Import Journal</Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"><Download className="w-3.5 h-3.5" /> Export</Button>
          <Button size="sm" onClick={() => setShowNewEntry(true)} className="gap-1.5 text-xs h-8"><Plus className="w-3.5 h-3.5" /> New Journal Entry</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-elevated p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Posted Entries</p>
          <p className="text-xl font-semibold tabular-nums mt-1">{totalPosted}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Draft Entries</p>
          <p className="text-xl font-semibold tabular-nums mt-1 text-amber-600">{totalDraft}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total Debits (Period)</p>
          <p className="text-xl font-semibold tabular-nums mt-1">{fmt(periodDebits)} <span className="text-xs font-normal text-muted-foreground">XOF</span></p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total Credits (Period)</p>
          <p className="text-xl font-semibold tabular-nums mt-1">{fmt(periodCredits)} <span className="text-xs font-normal text-muted-foreground">XOF</span></p>
        </div>
      </div>

      {/* Main Table with Filters + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn("space-y-4", selectedEntry ? "lg:col-span-2" : "lg:col-span-3")}>
          <div className="card-elevated">
            {/* Search + Filters */}
            <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Search by journal ID, description, source…" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                  className="w-full h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter className="w-3 h-3 text-muted-foreground" />
                {["All", "Draft", "Posted", "Reversed"].map(s => (
                  <button key={s} onClick={() => { setFilterStatus(s); setCurrentPage(1); }}
                    className={cn("h-7 px-2.5 rounded text-xs font-medium transition-colors",
                      filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                    )}>{s}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {["All", "ar_receipt", "ap_payment", "manual"].map(s => (
                  <button key={s} onClick={() => { setFilterSource(s); setCurrentPage(1); }}
                    className={cn("h-7 px-2.5 rounded text-xs font-medium transition-colors",
                      filterSource === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                    )}>{s === "All" ? "All" : sourceLabel(s)}</button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="cursor-pointer" onClick={() => toggleSort("id")}>
                        <span className="flex items-center gap-1">Entry # <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th className="cursor-pointer" onClick={() => toggleSort("date")}>
                        <span className="flex items-center gap-1">Date <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th>Description</th>
                      <th>Source</th>
                      <th className="text-right cursor-pointer" onClick={() => toggleSort("debitTotal")}>
                        <span className="flex items-center justify-end gap-1">Debit Total <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th className="text-right">Credit Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No journal entries found</td></tr>
                    ) : paged.map(e => (
                      <tr key={e.id} onClick={() => setSelectedEntry(e)}
                        className={cn("cursor-pointer", selectedEntry?.id === e.id && "bg-muted/40")}>
                        <td className="font-medium text-foreground tabular-nums">{e.entry_number}</td>
                        <td className="tabular-nums">{e.entry_date}</td>
                        <td className="max-w-[200px] truncate">{e.description || "—"}</td>
                        <td>
                          <span className={cn("text-[10px] px-2 py-0.5 rounded font-medium", sourceColors[e.source] || "bg-muted text-muted-foreground")}>{sourceLabel(e.source)}</span>
                        </td>
                        <td className="text-right tabular-nums font-medium">{fmt(e.debitTotal)}</td>
                        <td className="text-right tabular-nums font-medium">{fmt(e.creditTotal)}</td>
                        <td><StatusBadge status={statusLabel(e.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            <div className="p-3 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{filtered.length} entries · Page {currentPage} of {totalPages || 1}</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}><ChevronsLeft className="w-3.5 h-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft className="w-3.5 h-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRightIcon className="w-3.5 h-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}><ChevronsRight className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          </div>
        </div>

        {/* Detail Panel (Right) */}
        {selectedEntry && (
          <div className="card-elevated lg:col-span-1">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Entry Details</p>
              <div className="flex items-center gap-1">
                {selectedEntry.status === "posted" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={reverseEntry.isPending}>
                        {reverseEntry.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Contre-passer
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Contre-passer l'écriture {selectedEntry.entry_number} ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Une nouvelle écriture de contre-passation (inversion débit/crédit) sera créée et postée à la date du jour. L'écriture d'origine sera marquée comme "reversed". Action irréversible.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => reverseEntry.mutate({ entryId: selectedEntry.id })}>Contre-passer</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <button onClick={() => setSelectedEntry(null)} className="p-1 rounded hover:bg-muted"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry #</p><p className="text-sm font-medium tabular-nums">{selectedEntry.entry_number}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</p><p className="text-sm tabular-nums">{selectedEntry.entry_date}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</p><p className="text-sm"><span className={cn("text-[10px] px-2 py-0.5 rounded font-medium", sourceColors[selectedEntry.source])}>{sourceLabel(selectedEntry.source)}</span></p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p><StatusBadge status={statusLabel(selectedEntry.status)} /></div>
                <div className="col-span-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</p><p className="text-sm">{selectedEntry.description || "—"}</p></div>
              </div>

              {/* Balanced indicator */}
              {(() => {
                const dt = (selectedEntry.lines || []).reduce((s, l) => s + (l.debit || 0), 0);
                const ct = (selectedEntry.lines || []).reduce((s, l) => s + (l.credit || 0), 0);
                const bal = dt === ct;
                return (
                  <div className={cn("flex items-center gap-2 px-3 py-2 rounded-md border", bal ? "bg-success/10 border-success/20" : "bg-destructive/10 border-destructive/20")}>
                    {bal ? <><Check className="w-4 h-4 text-success" /><span className="text-xs font-medium text-success">Balanced</span></> : <><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-xs font-medium text-destructive">Unbalanced</span></>}
                  </div>
                );
              })()}

              {/* Ledger detail */}
              <div className="border-t border-border pt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Ledger Lines</p>
                <div className="space-y-2">
                  {(selectedEntry.lines || []).map((l, i) => (
                    <div key={i} className="p-2.5 rounded-md border border-border bg-muted/20 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{l.account ? `${l.account.code} – ${l.account.name}` : "Unknown Account"}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{l.description || "—"}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-[10px] text-muted-foreground">Debit</span><p className="text-xs tabular-nums font-medium">{l.debit > 0 ? fmt(l.debit) : "—"}</p></div>
                        <div><span className="text-[10px] text-muted-foreground">Credit</span><p className="text-xs tabular-nums font-medium">{l.credit > 0 ? fmt(l.credit) : "—"}</p></div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {l.cost_center && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l.cost_center}</span>}
                        {l.department && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l.department}</span>}
                        {l.project && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l.project}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t border-border pt-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Debit</span>
                  <p className="text-sm font-semibold tabular-nums">{fmt((selectedEntry.lines || []).reduce((s, l) => s + (l.debit || 0), 0))}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Credit</span>
                  <p className="text-sm font-semibold tabular-nums">{fmt((selectedEntry.lines || []).reduce((s, l) => s + (l.credit || 0), 0))}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
};

export default JournalEntries;
