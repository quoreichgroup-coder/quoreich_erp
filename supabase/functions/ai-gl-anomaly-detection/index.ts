// Edge function: ai-gl-anomaly-detection
// Reviews recent journal entries and asks AI to flag anomalies.
// Returns detailed journal lines per anomaly + entry_id for drill-down.
// Persists each run into ai_analysis_history.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  days?: number;
  trigger_source?: "manual" | "scheduled";
  tenant_id?: string;
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
    const days = Math.max(1, Math.min(365, Math.round(Number(body.days ?? 90))));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const supabase = createClient(supabaseUrl, serviceKey);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const { data: entries } = await supabase
      .from("journal_entries")
      .select(`
        id, entry_number, entry_date, description, source, status,
        journal_lines(id, debit, credit, description, account_id, gl_accounts(code, name))
      `)
      .eq("tenant_id", tenantId)
      .gte("entry_date", since)
      .order("entry_date", { ascending: false })
      .limit(150);

    type Line = { id: string; debit: number; credit: number; description: string | null;
      account_id: string; gl_accounts: { code: string; name: string } | null };
    type Entry = { id: string; entry_number: string; entry_date: string; description: string | null;
      source: string; status: string; journal_lines: Line[] };

    const entryList = (entries ?? []) as unknown as Entry[];

    // Map entry_number -> full entry (so we can attach lines to anomalies later)
    const entryByRef = new Map<string, Entry>();
    for (const e of entryList) entryByRef.set(e.entry_number, e);

    const compact = entryList.map((e) => {
      const debit = (e.journal_lines ?? []).reduce((s, l) => s + Number(l.debit ?? 0), 0);
      const credit = (e.journal_lines ?? []).reduce((s, l) => s + Number(l.credit ?? 0), 0);
      return {
        id: e.id,
        ref: e.entry_number,
        date: e.entry_date,
        source: e.source,
        status: e.status,
        description: e.description,
        debit,
        credit,
        balanced: Math.abs(debit - credit) < 0.01,
        line_count: e.journal_lines?.length ?? 0,
      };
    });

    if (compact.length === 0) {
      const empty = { anomalies: [], summary: "Aucune écriture sur la période.", total_reviewed: 0 };
      await supabase.from("ai_analysis_history").insert({
        tenant_id: tenantId,
        analysis_type: "gl_anomaly_detection",
        trigger_source: triggerSource,
        status: "success",
        params: { days },
        result: empty,
        inputs: { total_entries: 0, since },
        duration_ms: Date.now() - startedAt,
        created_by: userId,
      });
      return new Response(JSON.stringify(empty), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Tu es un auditeur comptable. Identifie les écritures suspectes (déséquilibre, doublon potentiel, montant anormalement élevé, libellé absent, source inhabituelle). Réponds en français, sois précis et factuel.",
          },
          {
            role: "user",
            content: `Voici ${compact.length} écritures récentes:\n${JSON.stringify(compact)}\n\nIdentifie au maximum 10 anomalies réelles. Si rien d'anormal, retourne un tableau vide.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_anomalies",
            description: "Liste structurée d'anomalies détectées",
            parameters: {
              type: "object",
              properties: {
                anomalies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      entry_ref: { type: "string" },
                      severity: { type: "string", enum: ["low", "medium", "high"] },
                      type: { type: "string" },
                      description: { type: "string" },
                      recommendation: { type: "string" },
                    },
                    required: ["entry_ref", "severity", "type", "description", "recommendation"],
                  },
                },
                summary: { type: "string" },
              },
              required: ["anomalies", "summary"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_anomalies" } },
      }),
    });

    if (!aiResp.ok) {
      const code = aiResp.status;
      const errMsg = code === 429 ? "Limite de requêtes atteinte." : code === 402 ? "Crédits IA épuisés." : "Erreur IA";
      await supabase.from("ai_analysis_history").insert({
        tenant_id: tenantId,
        analysis_type: "gl_anomaly_detection",
        trigger_source: triggerSource,
        status: "error",
        params: { days },
        result: {},
        inputs: { total_entries: compact.length, since },
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
    const parsed = args ? JSON.parse(args) : { anomalies: [], summary: "" };

    // Attach entry_id and journal lines to each anomaly for UI drill-down
    const enrichedAnomalies = (parsed.anomalies as Array<{ entry_ref: string }>).map((a) => {
      const entry = entryByRef.get(a.entry_ref);
      return {
        ...a,
        entry_id: entry?.id ?? null,
        entry_date: entry?.entry_date ?? null,
        entry_description: entry?.description ?? null,
        lines: (entry?.journal_lines ?? []).map((l) => ({
          account_code: l.gl_accounts?.code ?? null,
          account_name: l.gl_accounts?.name ?? null,
          debit: Number(l.debit ?? 0),
          credit: Number(l.credit ?? 0),
          description: l.description ?? null,
        })),
      };
    });

    const payload = {
      anomalies: enrichedAnomalies,
      summary: parsed.summary ?? "",
      total_reviewed: compact.length,
    };

    await supabase.from("ai_analysis_history").insert({
      tenant_id: tenantId,
      analysis_type: "gl_anomaly_detection",
      trigger_source: triggerSource,
      status: "success",
      params: { days },
      result: payload,
      inputs: { total_entries: compact.length, since },
      duration_ms: Date.now() - startedAt,
      created_by: userId,
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-gl-anomaly-detection error", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
