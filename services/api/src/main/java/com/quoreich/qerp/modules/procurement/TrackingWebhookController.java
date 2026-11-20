package com.quoreich.qerp.modules.procurement;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Suivi automatique par un prestataire (V134). La réception est publique (le prestataire n'a pas de compte QUOREICH) :
 * le jeton aléatoire de l'adresse identifie la société, et la base refuse un jeton inconnu ou désactivé. Les événements
 * arrivent au format DCSA Track &amp; Trace. Jumeau de la fonction tracking-webhook du nuage.
 */
@RestController
@Tag(name = "Approvisionnement", description = "Suivi automatique des expéditions par un prestataire")
public class TrackingWebhookController {

  private final TrackingWebhookReceiver receiver;
  private final Sql sql;

  public TrackingWebhookController(TrackingWebhookReceiver receiver, Sql sql) {
    this.receiver = receiver;
    this.sql = sql;
  }

  @PostMapping("/api/v1/tracking-webhook/{token}")
  @Operation(operationId = "receiveTrackingEvents", summary = "Réception des événements d'un prestataire de suivi (format DCSA), adresse propre à la société")
  public JsonNode receive(@PathVariable String token, @RequestBody JsonNode payload) {
    return receiver.receive(token, payload);
  }

  @GetMapping("/api/v1/procurement/tracking-connection")
  @Operation(operationId = "getTrackingConnection", summary = "Connexion au prestataire de suivi (sans la clé API, jamais lisible)")
  public JsonNode connection() {
    return sql.one("SELECT tenant_id, provider, enabled, webhook_token, last_received_at, last_result, updated_at FROM public.tracking_connections"
        + " WHERE tenant_id = public.get_user_tenant_id(auth.uid())");
  }

  @PutMapping("/api/v1/procurement/tracking-connection")
  @Operation(operationId = "saveTrackingConnection", summary = "Enregistrer la connexion au prestataire de suivi (droit procurement.settings)")
  public JsonNode saveConnection(@RequestBody Map<String, Object> b) {
    return sql.call("set_tracking_connection", args("_provider", b.get("provider"), "_enabled", b.getOrDefault("enabled", true),
        "_api_key", b.get("api_key"), "_regenerate", b.getOrDefault("regenerate", false)));
  }
}
