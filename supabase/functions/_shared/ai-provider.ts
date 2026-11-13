// Fournisseur d'IA indépendant : tout point d'accès compatible OpenAI (/chat/completions,
// appels d'outils). Le même contrat sert au nuage (Gemini, OpenRouter…) et au sur-site
// (LiteLLM devant Ollama ou vLLM) : changer de fournisseur, c'est changer trois secrets.
//
//   AI_BASE_URL  ex. https://generativelanguage.googleapis.com/v1beta/openai   (Gemini)
//                    https://openrouter.ai/api/v1                              (OpenRouter)
//                    http://litellm:4000/v1                                    (sur site)
//   AI_API_KEY   clé du fournisseur (ou de la passerelle)
//   AI_MODEL     un modèle, ou plusieurs séparés par des virgules : si le premier est saturé,
//                limité ou retiré, le suivant est essayé (ex. « gemini-3.5-flash,gemini-3.8-flash »)
//
// Repli de compatibilité : sans AI_API_KEY mais avec LOVABLE_API_KEY, la passerelle Lovable est
// utilisée comme avant. Module pur (environnement et fetch injectés) : testé par Vitest.

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export type AiResult =
  | { ok: true; json: any; model: string }
  | { ok: false; status: number; message: string };

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const LOVABLE_DEFAULT_MODEL = "google/gemini-2.5-flash";

/** Statuts pour lesquels on essaie le modèle suivant : saturé, limité, retiré ou inconnu. */
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

export function readAiConfig(env: (name: string) => string | undefined): AiConfig | { error: string } {
  const apiKey = env("AI_API_KEY")?.trim();
  if (apiKey) {
    const baseUrl = env("AI_BASE_URL")?.trim().replace(/\/+$/, "");
    const models = (env("AI_MODEL") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    if (!baseUrl || models.length === 0) {
      return { error: "IA non configurée : AI_BASE_URL et AI_MODEL sont requis avec AI_API_KEY" };
    }
    return { baseUrl, apiKey, models };
  }
  const lovable = env("LOVABLE_API_KEY")?.trim();
  if (lovable) return { baseUrl: LOVABLE_GATEWAY, apiKey: lovable, models: [LOVABLE_DEFAULT_MODEL] };
  return { error: "IA non configurée : définir AI_BASE_URL, AI_API_KEY et AI_MODEL" };
}

/** Message affiché à l'utilisateur pour un refus du fournisseur. */
export function aiErrorMessage(status: number): string {
  if (status === 429) return "Limite du fournisseur IA atteinte : réessayez plus tard.";
  if (status === 402) return "Crédits IA épuisés : rechargez le compte du fournisseur.";
  if (status === 401 || status === 403) return "Clé du fournisseur IA refusée : vérifiez AI_API_KEY.";
  if (status === 503 || status === 502 || status === 504) return "Fournisseur IA momentanément saturé : réessayez dans un instant.";
  if (status === 404) return "Modèle IA indisponible : vérifiez AI_MODEL.";
  return "Erreur du fournisseur IA.";
}

/**
 * Appelle /chat/completions avec le premier modèle disponible de la liste. `body` ne contient
 * pas de modèle : il est ajouté ici. Ne lève jamais d'exception pour un refus du fournisseur.
 */
export async function chatCompletion(
  config: AiConfig,
  body: Record<string, unknown>,
  doFetch: typeof fetch = fetch,
): Promise<AiResult> {
  let last: AiResult = { ok: false, status: 500, message: aiErrorMessage(500) };
  for (const model of config.models) {
    let resp: Response;
    try {
      resp = await doFetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model }),
      });
    } catch {
      last = { ok: false, status: 503, message: aiErrorMessage(503) };
      continue;
    }
    if (resp.ok) return { ok: true, json: await resp.json(), model };
    last = { ok: false, status: resp.status, message: aiErrorMessage(resp.status) };
    if (!RETRYABLE.has(resp.status)) break;
  }
  return last;
}

/** Arguments de l'appel d'outil imposé, ou null si le modèle n'en a pas produit. */
export function toolArguments(json: any): any | null {
  const raw = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
