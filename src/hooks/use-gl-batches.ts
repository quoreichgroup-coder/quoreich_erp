import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GLBatchHistory, GLPostingKPIs, GLAuditHistory, type GLBatch } from "@/components/GLPostingConfig";
import { useGLAuditLogs } from "@/hooks/use-gl-audit";

const SOURCE_TO_MODULE: Record<string, string> = {
  manual: "GL",
  ar_receipt: "AR",
  ar_invoice: "AR",
  ap_payment: "AP",
  ap_invoice: "AP",
  sales: "Sales",
  procurement: "Procurement",
  inventory: "Inventory",
  treasury: "Treasury",
  expense: "Expenses",
  asset: "Assets",
  depreciation: "Assets",
  budget: "Budget",
  project: "Projects",
};

function mapStatus(s: string): GLBatch["status"] {
  if (s === "posted") return "Posted";
  if (s === "draft") return "Pending";
  if (s === "validated") return "Validated";
  if (s === "rejected") return "Rejected";
  if (s === "cancelled") return "Cancelled";
  if (s === "reversed") return "Reversed";
  return "Pending";
}

export function useGLBatches(moduleFilter?: string) {
  return useQuery({
    queryKey: ["gl-batches", moduleFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, entry_number, entry_date, description, source, status, created_by, posted_at, posted_by, lines:journal_lines(debit, credit)")
        .order("entry_date", { ascending: false })
        .limit(200);

      if (error) throw error;

      const grouped: Record<string, { entries: typeof data; source: string; date: string }> = {};
      for (const je of data || []) {
        const module = SOURCE_TO_MODULE[je.source] || "GL";
        const key = `${module}-${je.entry_date}`;
        if (!grouped[key]) grouped[key] = { entries: [], source: je.source, date: je.entry_date };
        grouped[key].entries.push(je);
      }

      const batches: GLBatch[] = Object.entries(grouped).map(([key, g]) => {
        const module = key.split("-")[0];
        const totalDebit = g.entries.reduce((s, e) => s + (e.lines?.reduce((ls: number, l: any) => ls + Number(l.debit), 0) || 0), 0);
        const totalCredit = g.entries.reduce((s, e) => s + (e.lines?.reduce((ls: number, l: any) => ls + Number(l.credit), 0) || 0), 0);
        const firstPosted = g.entries.find(e => e.posted_at);
        const statuses = g.entries.map(e => e.status);
        const batchStatus = statuses.every(s => s === "posted") ? "Posted"
          : statuses.some(s => s === "posted") ? "Validated"
          : statuses.every(s => s === "draft") ? "Pending"
          : mapStatus(statuses[0]);

        return {
          id: `GLB-${module}-${g.date}`,
          date: g.date,
          module,
          type: g.source.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          entries: g.entries.length,
          totalDebit,
          totalCredit,
          journal: module === "AR" ? "VJ" : module === "AP" ? "AJ" : module === "Treasury" ? "CJ" : "GJ",
          status: batchStatus,
          createdBy: "System",
          approvedBy: firstPosted ? "System" : undefined,
          postedAt: firstPosted?.posted_at || undefined,
        };
      });

      if (moduleFilter) {
        return batches.filter(b => b.module === moduleFilter);
      }
      return batches;
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
  return React.createElement(GLBatchHistory, { batches });
}

export function GLAuditHistoryLive({ module }: { module?: string }) {
  const { data: batches = [] } = useGLBatches(module);
  const { data: auditTrail = [] } = useGLAuditLogs();
  return React.createElement(GLAuditHistory, { batches, auditTrail });
}
