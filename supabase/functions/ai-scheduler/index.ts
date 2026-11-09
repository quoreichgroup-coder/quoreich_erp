// Edge function: ai-scheduler
// Invoked hourly by pg_cron. Iterates over due ai_analysis_schedules and triggers
// the relevant AI analysis function for each tenant. Updates last_run_at / next_run_at.
//
// AUTH: this endpoint is public (`verify_jwt = false`) so it MUST authenticate
// callers itself. We require either:
//   1. an `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header, OR
//   2. an `x-scheduler-secret: <AI_SCHEDULER_SECRET>` header (shared secret
//      used by pg_cron / external schedulers).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
};

const FREQ_INCREMENT_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const schedulerSecret = Deno.env.get("AI_SCHEDULER_SECRET") ?? "";

    // ── Auth gate ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const presentedSecret = req.headers.get("x-scheduler-secret") ?? "";
    const authorized =
      (serviceKey && authHeader === `Bearer ${serviceKey}`) ||
      (schedulerSecret && presentedSecret === schedulerSecret);

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: due, error } = await supabase
      .from("ai_analysis_schedules")
      .select("*")
      .eq("enabled", true)
      .lte("next_run_at", new Date().toISOString())
      .limit(50);

    if (error) throw error;

    const results: Array<{ id: string; tenant_id: string; type: string; ok: boolean; msg?: string }> = [];

    for (const schedule of due ?? []) {
      const fnName = schedule.analysis_type === "cashflow_forecast"
        ? "ai-cashflow-forecast"
        : "ai-gl-anomaly-detection";

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            ...(schedule.params ?? {}),
            tenant_id: schedule.tenant_id,
            trigger_source: "scheduled",
          }),
        });
        const ok = resp.ok;
        results.push({
          id: schedule.id,
          tenant_id: schedule.tenant_id,
          type: schedule.analysis_type,
          ok,
          msg: ok ? "" : `status_${resp.status}`,
        });
      } catch (e) {
        console.error("ai-scheduler: downstream call failed", e);
        results.push({
          id: schedule.id,
          tenant_id: schedule.tenant_id,
          type: schedule.analysis_type,
          ok: false,
          msg: "downstream_error",
        });
      }

      const inc = FREQ_INCREMENT_MS[schedule.frequency] ?? FREQ_INCREMENT_MS.daily;
      await supabase
        .from("ai_analysis_schedules")
        .update({
          last_run_at: new Date().toISOString(),
          next_run_at: new Date(Date.now() + inc).toISOString(),
        })
        .eq("id", schedule.id);
    }

    console.log(JSON.stringify({
      audit: "ai-scheduler",
      processed: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      ts: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-scheduler error", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
