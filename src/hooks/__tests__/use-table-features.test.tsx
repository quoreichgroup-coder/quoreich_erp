import { describe, it, expect, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useTableFeatures } from "@/hooks/use-table-features";

type Row = {
  id: string;
  name: string;
  amount: number;
  status: string;
};

const STATUSES = ["open", "paid", "partial"];

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r-${String(i).padStart(5, "0")}`,
    name: `Client ${String(i % 137).padStart(3, "0")}`,
    amount: (i * 7919) % 100_000,
    status: STATUSES[i % STATUSES.length],
  }));
}

afterEach(cleanup);

describe("useTableFeatures — fenêtrage", () => {
  it("ne rend que la page courante, jamais le jeu complet", () => {
    const rows = makeRows(2000);
    const { result } = renderHook(() =>
      useTableFeatures<Row>({ data: rows, pageSize: 10, searchableKeys: ["name", "id"] }),
    );

    expect(result.current.totalItems).toBe(2000);
    expect(result.current.totalPages).toBe(200);
    // La page est la seule chose que le tableau monte dans le DOM : 2000 lignes
    // en état, 10 dans le document. C'est ce qui remplace une virtualisation.
    expect(result.current.pagedData).toHaveLength(10);
    expect(result.current.pagedData[0].id).toBe("r-00000");
  });

  it("atteint la dernière page et se recale quand le jeu rétrécit", () => {
    const rows = makeRows(2000);
    const { result, rerender } = renderHook(
      ({ data }) => useTableFeatures<Row>({ data, pageSize: 10 }),
      { initialProps: { data: rows } },
    );

    act(() => result.current.setPage(199));
    expect(result.current.page).toBe(199);
    expect(result.current.pagedData).toHaveLength(10);
    expect(result.current.pagedData[9].id).toBe("r-01999");

    rerender({ data: rows.slice(0, 35) });
    // La page persistée (199) ne doit pas produire de page vide.
    expect(result.current.page).toBe(3);
    expect(result.current.pagedData).toHaveLength(5);
  });

  it("trie et filtre l'ensemble des lignes, pas seulement la page visible", () => {
    const rows = makeRows(2000);
    const { result } = renderHook(() =>
      useTableFeatures<Row>({
        data: rows,
        pageSize: 10,
        searchableKeys: ["name"],
        filterConfigs: [{ key: "status", label: "Statut", options: STATUSES }],
      }),
    );

    act(() => result.current.toggleSort("amount"));
    expect(result.current.sort).toEqual({ key: "amount", direction: "asc" });
    const firstPage = result.current.pagedData.map((r) => r.amount);
    expect(firstPage).toEqual([...firstPage].sort((a, b) => a - b));

    act(() => result.current.toggleSort("amount"));
    const desc = result.current.pagedData.map((r) => r.amount);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    act(() => result.current.setFilter("status", "paid"));
    expect(result.current.totalItems).toBeGreaterThan(600);
    expect(result.current.pagedData.every((r) => r.status === "paid")).toBe(true);
    expect(result.current.page).toBe(0);
  });

  it("reste sous la seconde sur 2 000 lignes, tri et filtre compris", () => {
    const rows = makeRows(2000);
    const started = performance.now();
    const { result } = renderHook(() =>
      useTableFeatures<Row>({
        data: rows,
        pageSize: 10,
        searchableKeys: ["name", "id"],
        filterConfigs: [{ key: "status", label: "Statut", options: STATUSES }],
      }),
    );
    act(() => result.current.toggleSort("amount"));
    act(() => result.current.setFilter("status", "open"));
    act(() => result.current.setSearch("Client 04"));
    const elapsed = performance.now() - started;

    expect(result.current.totalItems).toBeGreaterThan(0);
    // Garde-fou anti-O(n²) : très large, il n'échoue que si le hook régresse
    // franchement (un tri par recherche linéaire réintroduit, par exemple).
    expect(elapsed).toBeLessThan(1000);
  });
});