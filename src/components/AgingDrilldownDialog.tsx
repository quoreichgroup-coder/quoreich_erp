import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowUp, ArrowDown, ArrowUpDown, Download, Inbox, RefreshCw, AlertTriangle } from "lucide-react";
import { exportToCSV } from "@/lib/csv-export";

export type AgingKind = "ar" | "ap";

const PAGE_SIZE = 25;

const fmt = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " XOF";

const daysBetween = (a: string, b: string) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

type Row = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  status: string;
};

type SortKey = "due_date" | "days";
type SortDir = "asc" | "desc";

export function AgingDrilldownDialog({
  open,
  onOpenChange,
  kind: initialKind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: AgingKind;
}) {
  const [kind, setKind] = useState<AgingKind>(initialKind);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  // Reset page when filters/sort change
  useEffect(() => {
    setPage(0);
  }, [kind, from, to, sortKey, sortDir]);

  const table = kind === "ar" ? "ar_invoices" : "ap_invoices";
  const title = kind === "ar" ? "Créances en retard" : "Dettes en retard";
  const today = new Date().toISOString().slice(0, 10);

  // sort by due_date server-side. "days overdue" is inverse of due_date.
  const orderAscending =
    sortKey === "due_date" ? sortDir === "asc" : sortDir === "desc";

  // Paged rows query (server-side pagination & sorting via .range/.order).
  const rowsQuery = useQuery({
    queryKey: ["aging-drilldown", "rows", kind, from, to, sortKey, sortDir, page],
    enabled: open,
    queryFn: async () => {
      const s = supabase as unknown as { from: (t: string) => any };
      let q = s
        .from(table)
        .select("id, invoice_number, invoice_date, due_date, total, amount_paid, status", {
          count: "exact",
        })
        .neq("status", "paid")
        .lt("due_date", today);
      if (from) q = q.gte("due_date", from);
      if (to) q = q.lte("due_date", to);
      q = q
        .order("due_date", { ascending: orderAscending })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Row[], count: count ?? 0 };
    },
  });

  // Summary across all pages (sum + count) — used for the header and CSV export.
  const summaryQuery = useQuery({
    queryKey: ["aging-drilldown", "summary", kind, from, to],
    enabled: open,
    queryFn: async () => {
      const s = supabase as unknown as { from: (t: string) => any };
      let q = s
        .from(table)
        .select("id, invoice_number, invoice_date, due_date, total, amount_paid, status")
        .neq("status", "paid")
        .lt("due_date", today)
        .order("due_date", { ascending: true });
      if (from) q = q.gte("due_date", from);
      if (to) q = q.lte("due_date", to);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const total = rows.reduce(
        (s, r) => s + (Number(r.total) - Number(r.amount_paid)),
        0,
      );
      return { rows, total };
    },
  });

  const totalCount = rowsQuery.data?.count ?? 0;
  const totalAmount = summaryQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = rowsQuery.data?.rows ?? [];

  const isLoading = rowsQuery.isLoading;
  const isError = rowsQuery.isError || summaryQuery.isError;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const sortIcon = (k: SortKey) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3" aria-hidden="true" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden="true" />
    );
  };

  const ariaSort = (k: SortKey): "ascending" | "descending" | "none" =>
    sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const handleExport = () => {
    const all = summaryQuery.data?.rows ?? [];
    exportToCSV(
      all.map((r) => ({
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        due_date: r.due_date,
        days_overdue: daysBetween(r.due_date, today),
        remaining: Number(r.total) - Number(r.amount_paid),
        status: r.status,
      })),
      [
        { key: "invoice_number", header: "N° facture" },
        { key: "invoice_date", header: "Date facture" },
        { key: "due_date", header: "Échéance" },
        { key: "days_overdue", header: "Jours en retard" },
        { key: "remaining", header: "Restant dû" },
        { key: "status", header: "Statut" },
      ],
      `aging-${kind}-${today}`,
    );
  };

  const resetFilters = () => {
    setFrom("");
    setTo("");
  };

  const retry = () => {
    rowsQuery.refetch();
    summaryQuery.refetch();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl" aria-describedby="aging-desc">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="aging-desc">
            {isLoading
              ? "Chargement…"
              : `${totalCount} facture(s) — ${fmt(totalAmount)}`}
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div
          className="flex flex-wrap items-end gap-3 border-b pb-3"
          role="group"
          aria-label="Filtres d'échéances"
        >
          <div className="space-y-1">
            <Label className="text-xs" id="aging-kind-label">Type</Label>
            <div
              className="flex rounded-md border overflow-hidden"
              role="radiogroup"
              aria-labelledby="aging-kind-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={kind === "ar"}
                onClick={() => setKind("ar")}
                className={`px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kind === "ar" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                data-testid="aging-filter-ar"
              >
                Créances (AR)
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "ap"}
                onClick={() => setKind("ap")}
                className={`px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kind === "ap" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                data-testid="aging-filter-ap"
              >
                Dettes (AP)
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aging-from" className="text-xs">Échéance du</Label>
            <Input
              id="aging-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-[160px]"
              aria-label="Échéance à partir du"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aging-to" className="text-xs">au</Label>
            <Input
              id="aging-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-[160px]"
              aria-label="Échéance jusqu'au"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            aria-label="Réinitialiser les filtres"
          >
            Réinitialiser
          </Button>
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={handleExport}
              disabled={(summaryQuery.data?.rows.length ?? 0) === 0 || summaryQuery.isLoading}
              data-testid="aging-export-csv"
              aria-label="Exporter en CSV"
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              Export CSV
            </Button>
          </div>
        </div>

        {isError ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-12 text-muted-foreground"
          >
            <AlertTriangle className="h-10 w-10 mb-2 text-destructive" aria-hidden="true" />
            <p className="text-sm mb-3">Impossible de charger les échéances.</p>
            <Button size="sm" variant="outline" onClick={retry}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Réessayer
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-12 text-muted-foreground"
            role="status"
          >
            <Inbox className="h-10 w-10 mb-2 opacity-50" aria-hidden="true" />
            <p className="text-sm font-medium">Aucune facture en retard</p>
            <p className="text-xs mt-1">
              Aucune {kind === "ar" ? "créance" : "dette"} ne correspond aux filtres
              sélectionnés.
            </p>
          </div>
        ) : (
          <>
            <div data-testid="aging-drilldown-table" className="max-h-[55vh] overflow-auto">
              <Table aria-label={title}>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">N° facture</TableHead>
                    <TableHead scope="col" aria-sort={ariaSort("due_date")}>
                      <button
                        type="button"
                        onClick={() => toggleSort("due_date")}
                        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                        aria-label={`Trier par échéance (${ariaSort("due_date")})`}
                      >
                        Échéance {sortIcon("due_date")}
                      </button>
                    </TableHead>
                    <TableHead scope="col" className="text-right" aria-sort={ariaSort("days")}>
                      <button
                        type="button"
                        onClick={() => toggleSort("days")}
                        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                        aria-label={`Trier par jours en retard (${ariaSort("days")})`}
                      >
                        Jours en retard {sortIcon("days")}
                      </button>
                    </TableHead>
                    <TableHead scope="col" className="text-right">Restant dû</TableHead>
                    <TableHead scope="col">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const remaining = Number(r.total) - Number(r.amount_paid);
                    const days = daysBetween(r.due_date, today);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                        <TableCell>{r.due_date}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={days > 60 ? "destructive" : "outline"}>{days} j</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{fmt(remaining)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <nav
              className="flex items-center justify-between pt-2 text-sm"
              aria-label="Pagination des échéances"
            >
              <span className="text-muted-foreground" aria-live="polite">
                Page {safePage + 1} / {totalPages} — {totalCount} ligne(s)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label="Page précédente"
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  aria-label="Page suivante"
                >
                  Suivant
                </Button>
              </div>
            </nav>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
