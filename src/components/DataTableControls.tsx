import { ArrowUpDown, ArrowUp, ArrowDown, Search, X, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { SortConfig, FilterConfig } from "@/hooks/use-table-features";

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
      className={`text-[11px] font-semibold cursor-pointer select-none hover:bg-muted/50 transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon className={`w-3 h-3 ${active ? "text-primary" : "text-muted-foreground/50"}`} />
      </span>
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
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-7 pl-8 text-xs bg-background"
        />
      </div>
      {filterConfigs.map(fc => (
        <Select key={fc.key} value={filters[fc.key] ?? "all"} onValueChange={v => onFilter(fc.key, v)}>
          <SelectTrigger className="h-7 text-xs w-auto min-w-[100px] bg-background">
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
        <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
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
    <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20">
      <span className="text-[11px] text-muted-foreground">
        {from}–{to} sur {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
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
              className="h-6 w-6 text-[10px]"
              onClick={() => onPageChange(p)}
            >
              {p + 1}
            </Button>
          );
        })}
        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
