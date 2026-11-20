import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPut, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";

/*
 * Notes annexes (V123) : référentiel des notes, lignes chiffrées calculées par la base (annex_note_lines) et
 * commentaires rédigés par la société pour une date d'arrêté (annex_note_texts, droit accounting.annex).
 */
const db = supabase as any;

export interface AnnexNote { code: string; title: string; line_order: number; kind: "balance" | "flow" | "text"; normal_side: "debit" | "credit"; guidance: string | null }
export interface AnnexNoteLine {
  group_code: string; group_label: string; group_order: number; account_code: string; account_name: string;
  opening: number; increase: number; decrease: number; closing: number;
}
export interface AnnexNoteText { note_code: string; body: string; updated_at: string }

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export function useAnnexNotes() {
  return useQuery({
    queryKey: ["annex-notes"],
    staleTime: Infinity,
    queryFn: async (): Promise<AnnexNote[]> => isApiEnabled()
      ? apiGet<AnnexNote[]>("/api/v1/gl/annex-notes")
      : check<AnnexNote[]>(db.from("annex_notes").select("code, title, line_order, kind, normal_side, guidance").order("line_order")),
  });
}

export function useAnnexNoteLines(code: string | null, from: string, to: string, enabled = true) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["annex-note-lines", tenantId, code, from, to],
    enabled: Boolean(tenantId && code && from && to && from <= to && enabled),
    retry: false,
    queryFn: async (): Promise<AnnexNoteLine[]> => isApiEnabled()
      ? apiGet<AnnexNoteLine[]>(`/api/v1/gl/annex-notes/${encodeURIComponent(code!)}/lines?from=${from}&to=${to}`)
      : check<AnnexNoteLine[]>(db.rpc("annex_note_lines", { _note: code, _from: from, _to: to })),
  });
}

export function useAnnexNoteTexts(periodEnd: string) {
  const { data: tenantId } = useTenantId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["annex-note-texts", tenantId, periodEnd],
    enabled: Boolean(tenantId && periodEnd),
    queryFn: async (): Promise<AnnexNoteText[]> => isApiEnabled()
      ? apiGet<AnnexNoteText[]>(`/api/v1/gl/annex-notes/texts?periodEnd=${periodEnd}`)
      : check<AnnexNoteText[]>(db.from("annex_note_texts").select("note_code, body, updated_at").eq("tenant_id", tenantId).eq("period_end", periodEnd)),
  });
  const save = useMutation({
    mutationFn: async ({ code, body }: { code: string; body: string }) => {
      if (isApiEnabled()) { await apiPut(`/api/v1/gl/annex-notes/${encodeURIComponent(code)}/text`, { period_end: periodEnd, body }); return; }
      const rows = await check<unknown[]>(db.from("annex_note_texts")
        .upsert({ tenant_id: tenantId, note_code: code, period_end: periodEnd, body, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id,note_code,period_end" }).select("note_code"));
      if (!rows?.length) throw new Error("Refusé : droit « Rédiger les notes annexes » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["annex-note-texts"] }); toast.success("Commentaire de la note enregistré"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { query, save };
}

/** Rubriques d'une note : sous-totaux dans l'ordre du référentiel, comptes en détail. */
export function groupAnnexLines(lines: AnnexNoteLine[]) {
  const groups = new Map<string, { code: string; label: string; order: number; opening: number; increase: number; decrease: number; closing: number; accounts: AnnexNoteLine[] }>();
  for (const l of lines) {
    const g = groups.get(l.group_code) ?? { code: l.group_code, label: l.group_label, order: l.group_order, opening: 0, increase: 0, decrease: 0, closing: 0, accounts: [] };
    g.opening += Number(l.opening); g.increase += Number(l.increase); g.decrease += Number(l.decrease); g.closing += Number(l.closing);
    g.accounts.push(l);
    groups.set(l.group_code, g);
  }
  const list = [...groups.values()].sort((a, b) => a.order - b.order);
  const total = list.reduce((t, g) => ({ opening: t.opening + g.opening, increase: t.increase + g.increase, decrease: t.decrease + g.decrease, closing: t.closing + g.closing }),
    { opening: 0, increase: 0, decrease: 0, closing: 0 });
  return { groups: list, total };
}
