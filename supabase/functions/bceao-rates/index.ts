// Edge function: bceao-rates (V130) — jumeau de BceaoRates (API Java sur site).
// Lit les « cours des devises contre franc CFA à appliquer aux transferts » publiés par la BCEAO pour une date
// (bceao.int, une page publique, aucune donnée de la société n'est envoyée) et les enregistre comme cours de
// référence par public.import_reference_rates (exécutable par service_role seulement).
//
// AUTH : `verify_jwt = false`, donc la fonction s'authentifie elle-même :
//   1. planificateur (pg_cron ou externe) : en-tête `x-scheduler-secret: <BCEAO_RATES_SECRET>` ;
//   2. utilisateur : jeton Supabase d'un membre ayant le droit currency.rates (reprise d'une date passée).
// Corps facultatif : { "date": "AAAA-MM-JJ" } (aujourd'hui par défaut).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
};
const BCEAO_URL = "https://www.bceao.int/fr/cours/get_all_devise_by_date";
const SOURCE = "BCEAO — cours des transferts";
const CURRENCIES: Record<string, string> = {
  "euro": "EUR", "dollar us": "USD", "yen japonais": "JPY", "livre sterling": "GBP", "franc suisse": "CHF",
  "dollar canadien": "CAD", "yuan chinois": "CNY", "dirham emirats arabes unis": "AED",
};
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const key = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");
const num = (s: string) => Number(s.replace(/[\s .]/g, "").replace(",", "."));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Même lecture que BceaoRates.parse : date du titre, lignes Devise / Achat / Vente. */
export function parseBceao(html: string): { date: string | null; rates: { currency: string; buy: number; sell: number }[] } {
  const t = /Cours des devises du\s+\S+\s+(\d{1,2})\s+([^\s<]+)\s+(\d{4})/i.exec(html);
  const month = t ? MONTHS[key(t[2])] : undefined;
  const date = t && month ? `${t[3]}-${String(month).padStart(2, "0")}-${t[1].padStart(2, "0")}` : null;
  const rates: { currency: string; buy: number; sell: number }[] = [];
  const row = /<tr>\s*<td>([^<]+)<\/td>\s*<td>([0-9 ., ]+)<\/td>\s*<td>([0-9 ., ]+)<\/td>/gi;
  for (let m = row.exec(html); m; m = row.exec(html)) {
    const code = CURRENCIES[key(m[1])];
    if (code) rates.push({ currency: code, buy: num(m[2]), sell: num(m[3]) });
  }
  return { date, rates };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const secret = Deno.env.get("BCEAO_RATES_SECRET") ?? "";

    let authorized = Boolean(secret) && req.headers.get("x-scheduler-secret") === secret;
    let userId: string | null = null;
    if (!authorized) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await asUser.auth.getUser();
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      userId = u.user.id;
      const { data: allowed } = await asUser.rpc("has_permission", { _user_id: userId, _code: "currency.rates" });
      if (!allowed) return json({ error: "Droit insuffisant : saisir les cours de change" }, 403);
      authorized = true;
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const requested = /^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? "") ? body.date : new Date().toISOString().slice(0, 10);
    // Jour sans publication (week-end, férié, cours du jour pas encore publié) : dernier jour publié des 7 jours précédents.
    let parsed: ReturnType<typeof parseBceao> = { date: null, rates: [] };
    for (let back = 0; back < 7 && parsed.rates.length === 0; back++) {
      const day = new Date(`${requested}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - back);
      const res = await fetch(`${BCEAO_URL}?dateJour=${day.toISOString().slice(0, 10)}`, { headers: { "User-Agent": "QERP-cours-BCEAO/1.0" } });
      if (!res.ok) return json({ error: `BCEAO : réponse ${res.status}` }, 502);
      parsed = parseBceao(await res.text());
    }
    const { date, rates } = parsed;
    if (!date || rates.length === 0) return json({ error: `BCEAO : aucun cours publié dans les 7 jours précédant le ${requested}` }, 502);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: imported, error } = await admin.rpc("import_reference_rates", { _base: "XOF", _date: date, _source: SOURCE, _rates: rates });
    if (error) throw error;
    console.log(JSON.stringify({ audit: "bceao-rates", user_id: userId, requested, published_date: date, imported, ts: new Date().toISOString() }));
    return json({ published_date: date, imported });
  } catch (e) {
    console.error("bceao-rates", e);
    return json({ error: "Internal server error" }, 500);
  }
});
