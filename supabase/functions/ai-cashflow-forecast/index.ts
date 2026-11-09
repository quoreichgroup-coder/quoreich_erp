// Edge function: ai-cashflow-forecast
// Aggregates AR/AP open invoices + bank balances and asks the AI to project cash flow
// over user-supplied horizons (default 30/60/90 days) or a custom date range.
// Persists each run into ai_analysis_history.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  horizons?: number[];
  from?: string;
  to?: string;
  trigger_source?: "manual" | "scheduled";
  tenant_id?: string; // Only honored when called by service role (scheduler)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Detect service-role invocation (scheduler)
    const isService = authHeader.includes(serviceKey);
    const triggerSource = body.trigger_source ?? (isService ? "scheduled" : "manual");

    let tenantId: string | null = null;
    let userId: string | null = null;

    if (isService && body.tenant_id) {
      tenantId = body.tenant_id;
    } else {
      const supaUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supaUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
      const { data: profile } = await supaUser
        .from("profiles").select("tenant_id").eq("id", user.id).single();
      tenantId = profile?.tenant_id ?? null;
    }

    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for data + history persistence (RLS-safe via tenant_id filter)
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve horizons
    let horizons: number[] = [30, 60, 90];
    if (Array.isArray(body.horizons) && body.horizons.length > 0) {
      horizons = [...new Set(body.horizons.map((n) => Math.max(1, Math.min(365, Math.round(Number(n))))))]
        .sort((a, b) => a - b)
        .slice(0, 6);
    } else if (body.from && body.to) {
      const from = new Date(body.from);
      const to = new Date(body.to);
      const diff = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
      horizons = [diff];
    }

    const [arRes, apRes, bankRes] = await Promise.all([
      supabase.from("ar_invoices").select("total, amount_paid, due_date, status")
        .eq("tenant_id", tenantId).neq("status", "paid").limit(500),
      supabase.from("ap_invoices").select("total, amount_paid, due_date, status")
        .eq("tenant_id", tenantId).neq("status", "paid").limit(500),
      supabase.from("bank_accounts").select("balance, currency, name")
        .eq("tenant_id", tenantId).eq("is_active", true),
    ]);

    const today = new Date();
    const bucket = (rows: { total: number; amount_paid: number; due_date: string }[], days: number) => {
      const cutoff = new Date(today.getTime() + days * 86400000);
      return rows
        .filter((r) => new Date(r.due_date) <= cutoff)
        .reduce((s, r) => s + Math.max(0, Number(r.total) - Number(r.amount_paid ?? 0)), 0);
    };

    const ar = (arRes.data ?? []) as { total: number; amount_paid: number; due_date: string }[];
    const ap = (apRes.data ?? []) as { total: number; amount_paid: number; due_date: string }[];
    const banks = (bankRes.data ?? []) as { balance: number; currency: string; name: string }[];
    const cashOnHand = banks.reduce((s, b) => s + Number(b.balance ?? 0), 0);

    const horizonBuckets: Record<string, { ar: number; ap: number }> = {};
    for (const d of horizons) {
      horizonBuckets[`${d}j`] = { ar: bucket(ar, d), ap: bucket(ap, d) };
    }

    const summary = {
      cash_on_hand: cashOnHand,
      currency: banks[0]?.currency ?? "XOF",
      ar_open_total: ar.reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid ?? 0)), 0),
      ap_open_total: ap.reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid ?? 0)), 0),
      open_ar_count: ar.length,
      open_ap_count: ap.length,
      horizons,
      buckets: horizonBuckets,
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const horizonEnum = horizons.map((d) => `${d}j`);
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Tu es un analyste financier ERP. Tu produis des prévisions de trésorerie courtes, en français, basées uniquement sur les chiffres fournis. Sois factuel et concis.",
          },
          {
            role: "user",
            content: `Données du tenant (devise ${summary.currency}):\n${JSON.stringify(summary, null, 2)}\n\nProduis une prévision pour CHACUN des horizons demandés (${horizonEnum.join(", ")}) et 2-3 recommandations.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "cashflow_forecast",
            description: "Prévision de trésorerie structurée",
            parameters: {
              type: "object",
              properties: {
                projections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      horizon: { type: "string", enum: horizonEnum },
                      projected_cash: { type: "number" },
                      net_movement: { type: "number" },
                      confidence: { type: "string", enum: ["low", "medium", "high"] },
                    },
                    required: ["horizon", "projected_cash", "net_movement", "confidence"],
                  },
                },
                summary: { type: "string" },
                recommendations: { type: "array", items: { type: "string" } },
                risk_level: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["projections", "summary", "recommendations", "risk_level"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "cashflow_forecast" } },
      }),
    });

    if (!aiResp.ok) {
      const code = aiResp.status;
      const errMsg = code === 429
        ? "Limite de requêtes atteinte, réessayez dans un instant."
        : code === 402
          ? "Crédits IA épuisés. Ajoutez du crédit à votre espace."
          : "Erreur IA";
      await supabase.from("ai_analysis_history").insert({
        tenant_id: tenantId,
        analysis_type: "cashflow_forecast",
        trigger_source: triggerSource,
        status: "error",
        params: { horizons, from: body.from, to: body.to },
        result: {},
        inputs: summary,
        error_message: errMsg,
        duration_ms: Date.now() - startedAt,
        created_by: userId,
      });
      return new Response(JSON.stringify({ error: errMsg }), {
        status: code === 429 || code === 402 ? code : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const args = aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const forecast = args ? JSON.parse(args) : null;

    const payload = { forecast, inputs: summary };

    await supabase.from("ai_analysis_history").insert({
      tenant_id: tenantId,
      analysis_type: "cashflow_forecast",
      trigger_source: triggerSource,
      status: forecast ? "success" : "partial",
      params: { horizons, from: body.from, to: body.to },
      result: payload,
      inputs: summary,
      duration_ms: Date.now() - startedAt,
      created_by: userId,
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-cashflow-forecast error", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
