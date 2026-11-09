import { useState, useMemo, useCallback, useEffect } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: string[];
}

export interface UseTableFeaturesOptions<T> {
  data: T[];
  pageSize?: number;
  initialSort?: SortConfig;
  searchableKeys?: (keyof T)[];
  filterConfigs?: FilterConfig[];
  /** When set, sort/page/search/filters survive reloads via localStorage. */
  persistKey?: string;
}

type Persisted = {
  sort?: SortConfig; page?: number; search?: string; filters?: Record<string, string>;
};

function readPersisted(key?: string): Persisted {
  if (!key || typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(key) || "{}") as Persisted; }
  catch { return {}; }
}

export function useTableFeatures<T extends Record<string, any>>({
  data,
  pageSize = 10,
  initialSort,
  searchableKeys = [],
  filterConfigs = [],
  persistKey,
}: UseTableFeaturesOptions<T>) {
  const persisted = useMemo(() => readPersisted(persistKey), [persistKey]);
  const [sort, setSort] = useState<SortConfig>(persisted.sort ?? initialSort ?? { key: "", direction: null });
  const [page, setPage] = useState(persisted.page ?? 0);
  const [search, setSearch] = useState(persisted.search ?? "");
  const [filters, setFilters] = useState<Record<string, string>>(persisted.filters ?? {});

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(persistKey, JSON.stringify({ sort, page, search, filters }));
    } catch { /* ignore */ }
  }, [persistKey, sort, page, search, filters]);


  const toggleSort = useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      if (prev.direction === "desc") return { key: "", direction: null };
      return { key, direction: "asc" };
    });
    setPage(0);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === "" || value === "all") delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
    setPage(0);
  }, []);

  const processedData = useMemo(() => {
    let result = [...data];

    // Search
    if (search && searchableKeys.length) {
      const q = search.toLowerCase();
      result = result.filter(item =>
        searchableKeys.some(key => String(item[key]).toLowerCase().includes(q))
      );
    }

    // Filters
    for (const [key, value] of Object.entries(filters)) {
      result = result.filter(item => String(item[key]) === value);
    }

    // Sort
    if (sort.key && sort.direction) {
      result.sort((a, b) => {
        const aVal = a[sort.key];
        const bVal = b[sort.key];
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sort.direction === "asc" ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        if (aStr < bStr) return sort.direction === "asc" ? -1 : 1;
        if (aStr > bStr) return sort.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, search, searchableKeys, filters, sort]);

  const totalPages = Math.max(1, Math.ceil(processedData.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

  const pagedData = useMemo(
    () => processedData.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [processedData, safePage, pageSize]
  );

  const activeFilterCount = Object.keys(filters).length + (search ? 1 : 0);

  return {
    // Data
    pagedData,
    processedData,
    totalItems: processedData.length,
    totalPages,
    // Sort
    sort,
    toggleSort,
    // Pagination
    page: safePage,
    setPage,
    pageSize,
    // Search
    search,
    setSearch,
    // Filters
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    filterConfigs,
  };
}
