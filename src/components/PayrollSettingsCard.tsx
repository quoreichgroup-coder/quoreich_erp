import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";

/*
 * Paramètres de paie (V63) : taux des cotisations patronales lu par la comptabilisation de la paie
 * (16,4 % par défaut, comme avant V63). Les comptes de paie se paramètrent dans Paramètres →
 * Comptabilisation (rôles « Paie »).
 */
export function PayrollSettingsCard() {
  const qc = useQueryClient();
  const { data: tenantId } = useTenantId();
  const { data: access } = useMyAccess();
  const canEdit = (access?.permissions ?? []).includes("hr.payroll_settings");
  const { data } = useQuery({
    queryKey: ["hr-payroll-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("hr_payroll_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data as { employer_contribution_pct: number } | null;
    },
  });
  const [rate, setRate] = useState("16.4");
  useEffect(() => { if (data) setRate(String(data.employer_contribution_pct)); }, [data]);
  const save = useMutation({
    mutationFn: async () => {
      const { data: r, error } = await (supabase as any).from("hr_payroll_settings")
        .upsert({ tenant_id: tenantId, employer_contribution_pct: Number(rate), updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("tenant_id");
      if (error) throw error;
      if (!r?.length) throw new Error("Refusé : droit « Modifier les paramètres de paie » requis.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr-payroll-settings"] }); toast.success("Paramètres de paie enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const n = Number(rate);
  const ok = Number.isFinite(n) && n >= 0 && n <= 100;
  return (
    <section aria-label="Paramètres de paie" className="bg-card border border-border rounded-lg p-4 space-y-3 max-w-xl">
      <h2 className="text-sm font-semibold">Paramètres de paie</h2>
      <div className="flex items-end gap-3">
        <div className="space-y-1.5"><Label className="text-xs" htmlFor="pay-employer-rate">Taux des cotisations patronales (%)</Label>
          <Input id="pay-employer-rate" type="number" step="0.01" className="h-8 text-xs w-32" value={rate} disabled={!canEdit} onChange={(e) => setRate(e.target.value)} /></div>
        {canEdit && <Button size="sm" className="h-8 text-xs" disabled={!ok || save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>}
      </div>
      <p className="text-[11px] text-muted-foreground">Appliqué au salaire brut à la comptabilisation de la paie. Comptes : Paramètres → Comptabilisation, rôles « Paie » (SYSCOHADA 661, 664, 422, 431, 447).</p>
      {!canEdit && <p className="text-[11px] text-muted-foreground">Lecture seule : le droit « Modifier les paramètres de paie » est requis.</p>}
    </section>
  );
}
