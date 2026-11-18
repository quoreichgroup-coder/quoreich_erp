import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TableCell, TableHead } from "@/components/ui/table";

/*
 * Actions groupées, communes à toutes les listes : sélection par case à cocher (page affichée),
 * barre d'actions sur la sélection, et exécution pièce par pièce par les mêmes fonctions contrôlées
 * que les boutons de ligne — la base refuse ce qui n'est pas permis et chaque refus est rapporté.
 */
export function useSelection<T>(rows: T[], idOf: (r: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }), []);
  const setAll = useCallback((ids: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const id of ids) { if (on) n.add(id); else n.delete(id); }
    return n;
  }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  // Une pièce qui a quitté la liste (supprimée, filtrée) ne reste pas sélectionnée.
  const chosen = useMemo(() => rows.filter((r) => selected.has(idOf(r))), [rows, selected, idOf]);
  return { selected, toggle, setAll, clear, chosen, has: (id: string) => selected.has(id) };
}

export type Selection<T> = ReturnType<typeof useSelection<T>>;

export function SelectAllHead<T>({ sel, pageIds, label }: { sel: Selection<T>; pageIds: string[]; label: string }) {
  const all = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  return (
    <TableHead className="w-8">
      <input type="checkbox" aria-label={label} className="rounded border-input" checked={all} disabled={pageIds.length === 0}
        onChange={(e) => sel.setAll(pageIds, e.target.checked)} />
    </TableHead>
  );
}

export function SelectCell<T>({ sel, id, label }: { sel: Selection<T>; id: string; label: string }) {
  return (
    <TableCell onClick={(e) => e.stopPropagation()} className="w-8">
      <input type="checkbox" aria-label={label} className="rounded border-input" checked={sel.has(id)} onChange={() => sel.toggle(id)} />
    </TableCell>
  );
}

export function BulkBar({ count, onClear, children, testId = "bulk-bar" }: { count: number; onClear: () => void; children: ReactNode; testId?: string }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 text-xs" data-testid={testId}>
      <span className="font-medium">{count} sélectionnée(s)</span>
      {children}
      <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={onClear}>Effacer la sélection</Button>
    </div>
  );
}

/** Bouton d'action groupée : n'apparaît que si au moins une pièce sélectionnée est concernée. */
export function BulkButton({ count, label, onClick, disabled, danger }: {
  count: number; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  if (count === 0) return null;
  return (
    <Button size="sm" variant={danger ? "ghost" : "outline"} className={`h-7 text-xs ${danger ? "text-destructive" : ""}`} disabled={disabled} onClick={onClick}>
      {label} ({count})
    </Button>
  );
}

type BulkJob = {
  ids: string[];
  run: (id: string) => Promise<void>;
  /** Fin de phrase du message de succès : « 3 pièce(s) soumise(s) ». */
  done: string;
  invalidate: string[];
};

/** Exécution séquentielle (une pièce à la fois, chacune dans sa transaction) ; refus regroupés. */
export function useBulkRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: BulkJob) => {
      const echecs: string[] = [];
      let ok = 0;
      for (const id of job.ids) {
        try { await job.run(id); ok++; } catch (e) { echecs.push(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)); }
      }
      return { ok, echecs };
    },
    onSuccess: ({ ok, echecs }, job) => {
      for (const k of job.invalidate) qc.invalidateQueries({ queryKey: [k] });
      if (ok) toast.success(`${ok} ${job.done}`);
      if (echecs.length) toast.error(`${echecs.length} refus`, { description: [...new Set(echecs)].join(" · ") });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Erreur Supabase → exception (pour `run`). */
export function check({ error }: { error: { message: string } | null }) {
  if (error) throw new Error(error.message);
}
