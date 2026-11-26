// Authenticated cloud endpoint for manual customer dunning. SMTP is implicit TLS on 465:
// Supabase-hosted Edge Functions block outbound SMTP on ports 25 and 587.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { probeSmtp, sendSmtp, validateSmtpConfig, type SmtpConfig, type SmtpConnect } from "./smtp.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
const cors = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const smtpConfig = (): SmtpConfig => validateSmtpConfig({
  host: Deno.env.get("QERP_SMTP_HOST") ?? "", port: Number(Deno.env.get("QERP_SMTP_PORT") ?? 0),
  username: Deno.env.get("QERP_SMTP_USERNAME") ?? "", password: Deno.env.get("QERP_SMTP_PASSWORD") ?? "",
  from: Deno.env.get("QERP_SMTP_FROM") ?? "",
});
const connectTls: SmtpConnect = (hostname, port) => Deno.connectTls({ hostname, port });
const safeError = (error: unknown) => error instanceof Error ? error.message : "smtp_error";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Authentification requise." }, 401);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !key) return json({ error: "Le service de relance n'est pas configuré." }, 503);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const userClient = createClient(url, anon, { ...options, global: { headers: { Authorization: authorization } } });
  const { data: identity, error: authError } = await userClient.auth.getUser();
  if (authError || !identity.user) return json({ error: "Session invalide ou expirée." }, 401);
  const service = createClient(url, key, options);
  let input: Record<string, unknown>;
  try {
    const raw = await request.text(); if (raw.length > 4096) return json({ error: "Demande trop volumineuse." }, 413);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch { return json({ error: "Demande JSON invalide." }, 400); }
  const action = input.action;
  const allowedFields: Record<string, string[]> = {
    candidates: ["action"], history: ["action"], status: ["action"], probe: ["action"], send: ["action", "invoice_id", "rule_id"],
  };
  if (typeof action !== "string" || !allowedFields[action] || Object.keys(input).some((field) => !allowedFields[action].includes(field)))
    return json({ error: "Action ou champ invalide." }, 400);
  if (action === "status" || action === "probe") {
    const { error } = await service.rpc("dunning_actor_tenant", { _actor: identity.user.id });
    if (error) return json({ error: error.code === "42501" ? "Accès refusé." : "Service de relance indisponible." }, error.code === "42501" ? 403 : 500);
  }
  if (action === "status") {
    try { smtpConfig(); return json({ configured: true }); } catch { return json({ configured: false }); }
  }
  const actor = identity.user.id;
  const rpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
    const { data, error } = await service.rpc(name, params);
    if (error) {
      if (error.code === "42501") throw Object.assign(new Error("Accès refusé."), { status: 403 });
      if (error.code === "QG032") throw Object.assign(new Error(error.message), { status: 422 });
      throw new Error("Le traitement de la relance a échoué.");
    }
    return data as T;
  };
  try {
    if (action === "candidates") return json(await rpc("ar_dunning_candidates_actor", { _actor: actor }));
    if (action === "history") return json(await rpc("ar_dunning_history_actor", { _actor: actor }));
    if (action === "probe") {
      try { await probeSmtp(smtpConfig(), connectTls); return json({ ok: true }); }
      catch { return json({ ok: false, error: "Connexion ou authentification SMTP impossible." }, 502); }
    }
    if (action === "send") {
      if (typeof input.invoice_id !== "string" || !uuid.test(input.invoice_id) || typeof input.rule_id !== "string" || !uuid.test(input.rule_id))
        return json({ error: "Facture ou règle de relance invalide." }, 400);
      let config: SmtpConfig;
      try { config = smtpConfig(); } catch { return json({ error: "Le serveur SMTP n'est pas configuré." }, 503); }
      const event = await rpc<Record<string, unknown>>("prepare_ar_dunning_event_actor", { _actor: actor, _invoice_id: input.invoice_id, _rule_id: input.rule_id });
      if (!event?.id) throw new Error("Événement de relance indisponible.");
      const claimed = await rpc<Record<string, unknown> | null>("claim_ar_dunning_event_actor", { _actor: actor, _event_id: event.id });
      if (!claimed?.id || claimed.status !== "sending") return json(event);
      let outcome = "sent", errorText: string | null = null;
      try { await sendSmtp(config, String(claimed.recipient), String(claimed.subject), String(claimed.message), connectTls); }
      catch (error) { outcome = safeError(error) === "smtp_delivery_uncertain" ? "uncertain" : "failed"; errorText = outcome === "failed" ? "Échec SMTP avant acceptation du message" : "Acceptation SMTP impossible à confirmer"; }
      return json(await rpc("finish_ar_dunning_event_actor", { _actor: actor, _event_id: event.id, _outcome: outcome, _error: errorText }));
    }
    return json({ error: "Action invalide." }, 400);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    return json({ error: error instanceof Error ? error.message : "Erreur du traitement de la relance." }, status);
  }
});
