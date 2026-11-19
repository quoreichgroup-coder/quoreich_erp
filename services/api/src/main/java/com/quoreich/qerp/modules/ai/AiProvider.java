package com.quoreich.qerp.modules.ai;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Fournisseur d'IA indépendant, même contrat que les fonctions du nuage (supabase/functions/_shared/ai-provider.ts) :
 * tout point d'accès compatible OpenAI (/chat/completions, appel d'outil imposé). Sur site, typiquement LiteLLM
 * devant Ollama ou vLLM. Configuration : QERP_AI_BASE_URL, QERP_AI_API_KEY, QERP_AI_MODEL (plusieurs modèles
 * séparés par des virgules : le suivant est essayé si le premier est saturé, limité ou retiré).
 */
@Component
public class AiProvider {

  /** Statuts pour lesquels on essaie le modèle suivant. */
  private static final Set<Integer> RETRYABLE = Set.of(404, 429, 500, 502, 503, 504);
  private static final ObjectMapper JSON = new ObjectMapper();

  public record Result(boolean ok, int status, String message, JsonNode json) {}

  private final String baseUrl;
  private final String apiKey;
  private final List<String> models;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  public AiProvider(@Value("${qerp.ai.base-url:}") String baseUrl, @Value("${qerp.ai.api-key:}") String apiKey, @Value("${qerp.ai.model:}") String model) {
    this.baseUrl = baseUrl.trim().replaceAll("/+$", "");
    this.apiKey = apiKey.trim();
    this.models = Arrays.stream(model.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
  }

  /** Message de configuration manquante, ou null si le fournisseur est configuré. */
  public String configurationError() {
    if (baseUrl.isEmpty() || models.isEmpty()) return "IA non configurée : définir QERP_AI_BASE_URL, QERP_AI_API_KEY et QERP_AI_MODEL";
    return null;
  }

  static String errorMessage(int status) {
    if (status == 429) return "Limite du fournisseur IA atteinte : réessayez plus tard.";
    if (status == 402) return "Crédits IA épuisés : rechargez le compte du fournisseur.";
    if (status == 401 || status == 403) return "Clé du fournisseur IA refusée : vérifiez QERP_AI_API_KEY.";
    if (status == 502 || status == 503 || status == 504) return "Fournisseur IA momentanément saturé : réessayez dans un instant.";
    if (status == 404) return "Modèle IA indisponible : vérifiez QERP_AI_MODEL.";
    return "Erreur du fournisseur IA.";
  }

  /** Appelle /chat/completions avec le premier modèle disponible ; ne lève pas d'exception pour un refus du fournisseur. */
  public Result chat(ObjectNode body) {
    Result last = new Result(false, 500, errorMessage(500), null);
    for (String model : models) {
      ObjectNode b = body.deepCopy();
      b.put("model", model);
      HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions")).timeout(Duration.ofSeconds(120))
          .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(b.toString()));
      if (!apiKey.isEmpty()) req.header("Authorization", "Bearer " + apiKey);
      HttpResponse<String> resp;
      try {
        resp = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
      } catch (java.io.IOException e) {
        last = new Result(false, 503, errorMessage(503), null);
        continue;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return new Result(false, 503, errorMessage(503), null);
      }
      if (resp.statusCode() / 100 == 2) {
        try {
          return new Result(true, 200, null, JSON.readTree(resp.body()));
        } catch (RuntimeException e) {
          return new Result(false, 502, errorMessage(502), null);
        }
      }
      last = new Result(false, resp.statusCode(), errorMessage(resp.statusCode()), null);
      if (!RETRYABLE.contains(resp.statusCode())) break;
    }
    return last;
  }

  /** Arguments de l'appel d'outil imposé, ou null si le modèle n'en a pas produit. */
  public static JsonNode toolArguments(JsonNode json) {
    JsonNode raw = json == null ? null : json.path("choices").path(0).path("message").path("tool_calls").path(0).path("function").path("arguments");
    if (raw == null || raw.isMissingNode() || raw.isNull()) return null;
    if (raw.isObject()) return raw;
    try {
      return JSON.readTree(raw.asString());
    } catch (RuntimeException e) {
      return null;
    }
  }
}
