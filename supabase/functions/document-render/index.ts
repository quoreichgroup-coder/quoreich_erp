// Lot 6 D1: verified end-user request -> immutable snapshot RPC -> isolated PDF worker -> private archive.
// Required: QERP_PDF_URL (trusted Gotenberg endpoint), optional QERP_PDF_AUTHORIZATION, QERP_PDF_RENDERER_VERSION.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { editionRequestRpc, readEditionRequest, renderEdition, type EditionClaim } from "./worker.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return response({ error: "Méthode non autorisée." }, 405);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return response({ error: "Authentification requise." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) return response({ error: "Le service d'édition n'est pas configuré." }, 503);
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const userClient = createClient(url, anon, { ...clientOptions, global: { headers: { Authorization: authorization } } });
  const { data: identity, error: identityError } = await userClient.auth.getUser();
  if (identityError || !identity.user) return response({ error: "Session invalide ou expirée." }, 401);
  let input;
  try { input = await readEditionRequest(request); } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Demande d'édition invalide." }, 400);
  }
  const operation = editionRequestRpc(input);
  const result = await userClient.rpc(operation.name, operation.params);
  if (result.error) {
    const business = result.error.code === "QG038" || result.error.code === "QG039" || result.error.code === "42501";
    // Clé de traduction (V155) transmise seulement si elle a la forme canonique ; l'écran la revalide
    // contre le registre partagé et retombe sur le message français sinon.
    const keyed = business && typeof result.error.hint === "string" && /^errors:[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(result.error.hint);
    let params: unknown = undefined;
    if (keyed) { try { params = JSON.parse(result.error.details ?? "{}"); } catch { params = undefined; } }
    return response({ error: business ? result.error.message : "La demande d'édition a échoué.",
      ...(business && { code: result.error.code }), ...(keyed && params && typeof params === "object" && { key: result.error.hint, params }) },
      business ? 400 : 500);
  }
  const edition = result.data;
  if (!edition?.id) return response({ error: "L'édition n'a pas pu être créée." }, 500);
  if (edition.status !== "queued") return response(edition);

  const server = createClient(url, serviceKey, clientOptions);
  const actor = identity.user.id;
  const rpc = async (name: string, params: Record<string, unknown>) => {
    const { data, error } = await server.rpc(name, params);
    if (error) throw new Error("Erreur du traitement de l'édition.");
    return data;
  };
  const bucket = server.storage.from("issued-documents");
  const work = renderEdition(edition.id, {
    rendererUrl: Deno.env.get("QERP_PDF_URL") ?? "",
    rendererVersion: Deno.env.get("QERP_PDF_RENDERER_VERSION") ?? "9.2.0",
    authorization: Deno.env.get("QERP_PDF_AUTHORIZATION") ?? "",
    claim: async () => await rpc("claim_document_edition", { _id: edition.id, _actor: actor }) as EditionClaim | null,
    complete: (r) => rpc("complete_document_edition", {
      _id: edition.id, _actor: actor, _path: r.path, _sha256: r.sha256, _renderer: r.renderer, _renderer_version: r.rendererVersion,
    }),
    fail: (message) => rpc("fail_document_edition", { _id: edition.id, _actor: actor, _error: message }),
    read: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error) {
        const status = "statusCode" in error ? String(error.statusCode) : "";
        if (status === "404" || /not found|does not exist/i.test(error.message)) return null;
        throw new Error("Archive indisponible.");
      }
      if (data.size > 25 * 1024 * 1024) throw new Error("Archive trop volumineuse.");
      return new Uint8Array(await data.arrayBuffer());
    },
    write: async (path, bytes) => {
      const { error } = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (!error) return "created";
      const status = "statusCode" in error ? String(error.statusCode) : "";
      if (status === "409" || /already exists|duplicate/i.test(error.message)) return "exists";
      throw new Error("Dépôt de l'archive refusé.");
    },
  }).catch(() => { console.error("document-render: unable to persist the worker outcome"); });
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return response(edition);
});
