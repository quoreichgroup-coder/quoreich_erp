import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GLBatchHistory, GLPostingKPIs, GLAuditHistory, type GLBatch } from "@/components/GLPostingConfig";
import { useGLAuditLogs } from "@/hooks/use-gl-audit";

// Lots réels du grand livre (V38) : un lot par société, journal et mois, alimenté à l'insertion de
// chaque écriture des livres auxiliaires. Avant V38, ces écrans regroupaient dans le navigateur les
// 200 dernières écritures par module et par jour, avec des numéros de lot et des journaux inventés.
// Le journal de banque (BQ) reçoit les encaissements comme les paiements : il est montré côté
// clients, fournisseurs et trésorerie.
const MODULE_JOURNALS: Record<string, string[]> = {
  AR: ["VT", "BQ"],
  AP: ["AC", "BQ"],
  Procurement: ["AC"],
  Treasury: ["BQ"],
  Payroll: ["PA"],
};
const JOURNAL_MODULE: Record<string, string> = { VT: "AR", AC: "AP", BQ: "Treasury", PA: "Payroll", OD: "GL" };

type BatchRow = {
  id: string; batch_number: string; journal_code: string; journal_label: string; period: string;
  entry_count: number; total_debit: number; total_credit: number; first_piece: string | null;
  last_piece: string | null; status: "open" | "closed"; created_at: string;
};

export function useGLBatches(moduleFilter?: string) {
  return useQuery({
    queryKey: ["gl-batches", moduleFilter ?? "all"],
    queryFn: async (): Promise<GLBatch[]> => {
      let q = (supabase as any).from("journal_batch_summary").select("*").order("period", { ascending: false });
      const journals = moduleFilter ? MODULE_JOURNALS[moduleFilter] : undefined;
      if (journals) q = q.in("journal_code", journals);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as BatchRow[]).map((b) => ({
        id: b.batch_number,
        date: b.period,
        module: JOURNAL_MODULE[b.journal_code] ?? "GL",
        type: `${b.journal_label}${b.first_piece ? ` · ${b.first_piece} → ${b.last_piece}` : ""}`,
        entries: Number(b.entry_count),
        totalDebit: Number(b.total_debit),
        totalCredit: Number(b.total_credit),
        journal: b.journal_code,
        // Les écritures des livres auxiliaires sont comptabilisées à la source : le lot est
        // « comptabilisé » ; il est clôturé avec la période du grand livre.
        status: "Posted",
        createdBy: "Livres auxiliaires",
        approvedBy: b.status === "closed" ? "Période clôturée" : undefined,
        postedAt: b.created_at,
      }));
    },
  });
}

/** All batches grouped by module */
export function useGLBatchesByModule() {
  const { data: batches = [], ...rest } = useGLBatches();
  const byModule: Record<string, GLBatch[]> = {};
  for (const b of batches) {
    if (!byModule[b.module]) byModule[b.module] = [];
    byModule[b.module].push(b);
  }
  return { data: byModule, batches, ...rest };
}

/** Live wrapper components */
export function GLPostingKPIsLive({ module }: { module: string }) {
  const { data: batches = [] } = useGLBatches(module);
  return React.createElement(GLPostingKPIs, { batches });
}

export function GLBatchHistoryLive({ module }: { module: string }) {
  const { data: batches = [] } = useGLBatches(module);
  return React.createElement(GLBatchHistory, { batches, readOnly: true });
}

export function GLAuditHistoryLive({ module }: { module?: string }) {
  const { data: batches = [] } = useGLBatches(module);
  const { data: auditTrail = [] } = useGLAuditLogs();
  return React.createElement(GLAuditHistory, { batches, auditTrail });
}
