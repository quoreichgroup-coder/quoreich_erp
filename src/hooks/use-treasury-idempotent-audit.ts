import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { periodBounds } from "@/lib/treasury-close";

export type TreasuryIdempotentAuditRow = {
  id: string;
  tenant_id: string;
  actor_id: string;
  target_user_id: string;
  action: string;
  comment: string | null;
  created_at: string;
  /** Derived from `comment` (YYYY-MM). Null if format unexpected. */
  period: string | null;
  /** Derived bounds for the period — first/last day of the month. */
  period_start: string | null;
  period_end: string | null;
};

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Lists `period_close_idempotent` audit rows for the current tenant.
 * Each row corresponds to a retry where `close_treasury_period` reused an
 * existing history entry instead of creating a new one. The hook derives the
 * `period_start` / `period_end` bounds from the audit `comment` so the UI can
 * surface them alongside `tenant_id`.
 */
export function useTreasuryIdempotentAudit(limit = 50) {
  return useQuery({
    queryKey: ["treasury-idempotent-audit", limit],
    queryFn: async (): Promise<TreasuryIdempotentAuditRow[]> => {
      type Raw = Omit<TreasuryIdempotentAuditRow, "period" | "period_start" | "period_end">;
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              order: (
                c: string,
                o: { ascending: boolean },
              ) => {
                limit: (
                  n: number,
                ) => Promise<{ data: Raw[] | null; error: { message: string } | null }>;
              };
            };
          };
        };
      })
        .from("treasury_role_audit")
        .select("id,tenant_id,actor_id,target_user_id,action,comment,created_at")
        .eq("action", "period_close_idempotent")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => {
        const candidate = r.comment?.split(" | ")[0]?.trim() ?? null;
        const period = candidate && PERIOD_RE.test(candidate) ? candidate : null;
        const bounds = period ? periodBounds(period) : null;
        return {
          ...r,
          period,
          period_start: bounds?.start ?? null,
          period_end: bounds?.end ?? null,
        };
      });
    },
  });
}
