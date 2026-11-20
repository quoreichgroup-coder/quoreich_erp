// Edge function: tracking-webhook (V134) — jumeau de TrackingWebhookController (API Java sur site).
// Reçoit les événements d'un prestataire de suivi (format DCSA Track & Trace) à l'adresse
// /functions/v1/tracking-webhook?token=<jeton de la société>. Le jeton aléatoire identifie la société ; la base
// (public.ingest_tracking_events, exécutable par service_role seulement) refuse un jeton inconnu ou désactivé.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "Not found" }, 404);
  try {
    const payload = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("ingest_tracking_events", { _token: token, _payload: payload });
    if (error) return json({ error: "Not found" }, 404);
    console.log(JSON.stringify({ audit: "tracking-webhook", result: data, ts: new Date().toISOString() }));
    return json(data);
  } catch (e) {
    console.error("tracking-webhook", e);
    return json({ error: "Bad request" }, 400);
  }
});
