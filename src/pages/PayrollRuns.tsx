import { useMemo, useState } from "react";
import { TransactionTabsBar } from "@/components/TransactionTabsBar";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Wallet, CalendarClock, Users, TrendingUp, Lock, Download, Plus, ExternalLink,
  Search, ArrowUpDown, X,
} from "lucide-react";
import {
  usePayrollKpis, useMyHrRoles, useCreatePayrollRun, type PayrollRun,
} from "@/hooks/use-hr-data";
import { canDo, actionTooltip, maskAmount } from "@/lib/hr-roles";
import { exportToCSV } from "@/lib/csv-export";
import { PayrollRunDialog } from "@/components/PayrollRunDialog";

const STATUS_STYLES: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground border-muted",
  approved: "bg-blue-500/15 text-blue-700 border-blue-500/20",
  posted:   "bg-success/15 text-success border-success/20",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", approved: "Approuvé", posted: "Comptabilisé",
};

type SortKey = "period" | "pay_date" | "status" | "gross_total" | "net_total" | "employee_count";

export default function PayrollRuns() {
  const perms = useMyHrRoles();
  const canExport = canDo(perms, "export");
  const canCreate = canDo(perms, "create_payroll_run");
  const exportTip = actionTooltip(perms, "export", "Exporter CSV");
  const createTip = actionTooltip(perms, "create_payroll_run", "Créer un cycle");
  const kpis = usePayrollKpis();
  const [openRun, setOpenRun] = useState<PayrollRun | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Filters / search / sort
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>(""); // AAAA or AAAA-MM
  const [sortKey, setSortKey] = useState<SortKey>("pay_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let rows = kpis.runs.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (periodFilter && !r.period.startsWith(periodFilter)) return false;
      if (term && !(r.period.toLowerCase().includes(term) || r.pay_date.includes(term) || r.status.includes(term))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const va = a[sortKey] as string | number;
      const vb = b[sortKey] as string | number;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [kpis.runs, q, status, periodFilter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const resetFilters = () => { setQ(""); setStatus("all"); setPeriodFilter(""); };

  const handleExport = () => {
    if (!canExport) return;
    exportToCSV(
      filtered.map((r) => ({
        period: r.period,
        pay_date: r.pay_date,
        status: STATUS_LABEL[r.status] ?? r.status,
        employees: r.employee_count,
        gross: canDo(perms, "view_sensitive") ? r.gross_total : 0,
        net: canDo(perms, "view_sensitive") ? r.net_total : 0,
      })),
      [
        { key: "period", header: "Période" }, { key: "pay_date", header: "Date paie" },
        { key: "status", header: "Statut" }, { key: "employees", header: "Employés" },
        { key: "gross", header: "Brut" }, { key: "net", header: "Net" },
      ],
      `payroll-runs-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "RH et paie", href: "/hr" }, { label: "Transactions" }, { label: "Cycles de paie" }]} />
        <TransactionTabsBar module="/hr" />
      <GuidanceBanner
        title="Tableau de bord — Paie"
        description="KPI, derniers cycles et prochaines échéances. Montants masqués sans rôle hr_*."
      />

      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" /> Cycles de paie
        </h1>
        <div className="flex items-center gap-2">
          <CreateRunButton open={createOpen} onOpenChange={setCreateOpen} disabled={!canCreate} tip={createTip} />
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1"
            disabled={!canExport || filtered.length === 0}
            aria-label={exportTip} title={exportTip} onClick={handleExport}
          >
            {canExport ? <Download className="w-3 h-3" /> : <Lock className="w-3 h-3" />} CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Employés actifs" value={String(kpis.activeEmployees)} icon={Users} />
        <Kpi label="Cycles enregistrés" value={String(kpis.runsCount)} icon={CalendarClock} />
        <Kpi label="Brut YTD" value={maskAmount(perms, kpis.ytdGross)} suffix="XOF" icon={TrendingUp} />
        <Kpi
          label="Dernier cycle"
          value={kpis.lastRun ? kpis.lastRun.period : "—"}
          sub={kpis.lastRun ? `Net ${maskAmount(perms, Number(kpis.lastRun.net_total))} XOF` : ""}
          icon={Wallet}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-border lg:col-span-2">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold mr-auto">Cycles récents</h2>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher (période, date)…"
                  className="h-8 text-xs pl-7 w-56"
                />
              </div>
              <Input
                value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}
                placeholder="Année/mois (AAAA ou AAAA-MM)"
                className="h-8 text-xs w-44"
              />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="approved">Approuvé</SelectItem>
                  <SelectItem value="posted">Comptabilisé</SelectItem>
                </SelectContent>
              </Select>
              {(q || status !== "all" || periodFilter) && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={resetFilters}>
                  <X className="w-3 h-3 mr-1" /> Réinitialiser
                </Button>
              )}
            </div>
            <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-b border-border/50">
              {filtered.length} / {kpis.runs.length} cycle(s)
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <SortTh active={sortKey === "period"} dir={sortDir} onClick={() => toggleSort("period")}>Période</SortTh>
                    <SortTh active={sortKey === "pay_date"} dir={sortDir} onClick={() => toggleSort("pay_date")}>Date paie</SortTh>
                    <SortTh active={sortKey === "employee_count"} dir={sortDir} onClick={() => toggleSort("employee_count")}>Employés</SortTh>
                    <SortTh active={sortKey === "gross_total"} dir={sortDir} onClick={() => toggleSort("gross_total")} className="text-right">Brut</SortTh>
                    <SortTh active={sortKey === "net_total"} dir={sortDir} onClick={() => toggleSort("net_total")} className="text-right">Net</SortTh>
                    <SortTh active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")}>Statut</SortTh>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      {kpis.runs.length === 0 ? "Aucun cycle enregistré" : "Aucun cycle ne correspond aux filtres"}
                    </td></tr>
                  )}
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-primary">{r.period}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{r.pay_date}</td>
                      <td className="px-3 py-2">{r.employee_count}</td>
                      <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, Number(r.gross_total))}</td>
                      <td className="px-3 py-2 text-right font-mono">{maskAmount(perms, Number(r.net_total))}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => setOpenRun(r)}>
                          <ExternalLink className="w-3 h-3" /> Ouvrir
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5 text-primary" /> Prochaines échéances
              </h2>
            </div>
            <div className="p-3 space-y-2">
              {kpis.upcoming.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Aucune échéance à venir</p>
              )}
              {kpis.upcoming.map((r) => (
                <div key={r.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                  <div>
                    <div className="text-xs font-medium">{r.period}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{r.pay_date}</div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <PayrollRunDialog run={openRun} open={!!openRun} onOpenChange={(v) => !v && setOpenRun(null)} />
    </PageShell>
  );
}

function CreateRunButton({
  open, onOpenChange, disabled, tip,
}: { open: boolean; onOpenChange: (v: boolean) => void; disabled: boolean; tip: string }) {
  const create = useCreatePayrollRun();
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [period, setPeriod] = useState(defaultPeriod);
  const [payDate, setPayDate] = useState(today.toISOString().slice(0, 10));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs gap-1" disabled={disabled} title={tip}>
          {disabled ? <Lock className="w-3 h-3" /> : <Plus className="w-3 h-3" />} Nouveau cycle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouveau cycle de paie</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[11px] text-muted-foreground">Période (AAAA-MM)</label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Date de paie</label>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={create.isPending}>Annuler</Button>
          <Button
            size="sm" disabled={create.isPending || !/^\d{4}-\d{2}$/.test(period)}
            onClick={async () => {
              try {
                await create.mutateAsync({ period, pay_date: payDate });
                onOpenChange(false);
              } catch { /* toast handled in hook */ }
            }}
          >
            {create.isPending ? "Création…" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({
  label, value, sub, suffix, icon: Icon,
}: { label: string; value: string; sub?: string; suffix?: string; icon: React.ElementType }) {
  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold font-mono">
          {value} {suffix && <span className="text-[10px] text-muted-foreground font-normal">{suffix}</span>}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider ${className}`}>{children}</th>;
}

function SortTh({
  children, active, dir, onClick, className = "",
}: { children: React.ReactNode; active: boolean; dir: "asc" | "desc"; onClick: () => void; className?: string }) {
  return (
    <th className={`px-3 py-2 font-medium text-muted-foreground uppercase tracking-wider ${className}`}>
      <button
        type="button" onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {children}
        <ArrowUpDown className={`w-3 h-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[9px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
