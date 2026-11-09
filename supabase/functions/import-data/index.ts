// Edge Function: import-data
// Validates and bulk-inserts records from a CSV/Excel-derived JSON payload.
// Supports: customers, suppliers, gl_accounts, items, ar_invoices, ap_invoices

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  allowedFields,
  type EntityType,
  normalizeRow,
  requiredFields,
} from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ImportPayload {
  entity: EntityType;
  rows: Record<string, unknown>[];
}

interface RowError {
  row: number;
  message: string;
}

// Re-export for tests that import this module via index. The pure logic lives
// in ./lib.ts and is fully covered by index.test.ts.
export { allowedFields, normalizeRow, requiredFields };


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "No tenant assigned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ImportPayload;
    if (!body?.entity || !Array.isArray(body.rows)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: entity & rows required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const required = requiredFields[body.entity];
    if (!required) {
      return new Response(
        JSON.stringify({ error: `Unsupported entity: ${body.entity}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const errors: RowError[] = [];
    const validRows: Record<string, unknown>[] = [];

    body.rows.forEach((raw, idx) => {
      const missing = required.filter(
        (f) => raw[f] === undefined || raw[f] === null || raw[f] === "",
      );
      if (missing.length) {
        errors.push({
          row: idx + 1,
          message: `Missing required field(s): ${missing.join(", ")}`,
        });
        return;
      }
      const normalized = normalizeRow(body.entity, raw);
      normalized.tenant_id = profile.tenant_id;
      if (
        body.entity === "ar_invoices" ||
        body.entity === "ap_invoices"
      ) {
        normalized.created_by = user.id;
      }
      validRows.push(normalized);
    });

    let inserted = 0;
    if (validRows.length) {
      const { data, error } = await supabase
        .from(body.entity)
        .insert(validRows)
        .select("id");
      if (error) {
        console.error("import-data insert error", error);
        return new Response(
          JSON.stringify({
            error: "Import failed — vérifiez le format des données.",
            inserted: 0,
            errors,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      inserted = data?.length ?? 0;
    }

    // Audit trail (visible via edge function logs). Keep PII out — log only counts.
    console.log(JSON.stringify({
      audit: "import-data",
      user_id: user.id,
      tenant_id: profile.tenant_id,
      entity: body.entity,
      total: body.rows.length,
      inserted,
      skipped: errors.length,
      ts: new Date().toISOString(),
    }));

    return new Response(
      JSON.stringify({
        success: true,
        entity: body.entity,
        total: body.rows.length,
        inserted,
        skipped: errors.length,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("import-data error", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
