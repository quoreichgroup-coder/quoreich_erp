import { ArrowUpDown, ArrowUp, ArrowDown, Search, X, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { SortConfig, FilterConfig } from "@/hooks/use-table-features";
import { cn } from "@/lib/utils";

/* ─── Sortable column header ─── */
interface SortableHeadProps {
  label: string;
  sortKey: string;
  sort: SortConfig;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableHead({ label, sortKey, sort, onSort, className = "" }: SortableHeadProps) {
  const active = sort.key === sortKey;
  const Icon = active && sort.direction === "asc" ? ArrowUp : active && sort.direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("text-xs font-semibold", className)}
    >
      <Button type="button" variant="ghost" size="compact" className="-mx-2 h-10 justify-start sm:h-8" onClick={() => onSort(sortKey)}>
        {label}
        <Icon className={`w-3 h-3 ${active ? "text-primary" : "text-muted-foreground/50"}`} />
      </Button>
    </TableHead>
  );
}

/* ─── Filter bar (search + dropdowns + clear) ─── */
interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  filters: Record<string, string>;
  onFilter: (key: string, value: string) => void;
  onClear: () => void;
  filterConfigs: FilterConfig[];
  activeCount: number;
  searchPlaceholder?: string;
}

export function FilterBar({ search, onSearch, filters, onFilter, onClear, filterConfigs, activeCount, searchPlaceholder = "Rechercher…" }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
      <div className="relative w-full min-w-0 sm:max-w-xs sm:flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-10 pl-8 bg-background sm:h-9"
        />
      </div>
      {filterConfigs.map(fc => (
        <Select key={fc.key} value={filters[fc.key] ?? "all"} onValueChange={v => onFilter(fc.key, v)}>
          <SelectTrigger aria-label={fc.label} className="h-10 w-full min-w-0 bg-background sm:h-9 sm:w-auto sm:min-w-32">
            <Filter className="w-3 h-3 mr-1 text-muted-foreground" />
            <SelectValue placeholder={fc.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            {fc.options.map(opt => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1 text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />
          Effacer
          <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">{activeCount}</Badge>
        </Button>
      )}
    </div>
  );
}

/* ─── Pagination ─── */
interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}

export function PaginationBar({ page, totalPages, totalItems, pageSize, onPageChange }: PaginationBarProps) {
  if (totalItems <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t border-border bg-muted/20">
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {from}–{to} sur {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-11 sm:size-8" aria-label="Page précédente" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let p = i;
          if (totalPages > 5) {
            const start = Math.max(0, Math.min(page - 2, totalPages - 5));
            p = start + i;
          }
          return (
            <Button
              key={p}
              variant={p === page ? "default" : "ghost"}
              size="icon"
              type="button"
              className={cn("size-11 p-0 text-xs sm:size-8", p !== page && "hidden sm:inline-flex")}
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPageChange(p)}
            >
              {p + 1}
            </Button>
          );
        })}
        <Button type="button" variant="ghost" size="icon" className="size-11 sm:size-8" aria-label="Page suivante" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
