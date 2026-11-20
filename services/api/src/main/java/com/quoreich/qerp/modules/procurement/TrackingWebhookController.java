package com.quoreich.qerp.modules.procurement;

import static com.quoreich.qerp.platform.Sql.args;

import com.quoreich.qerp.platform.Sql;
import com.quoreich.qerp.tenant.TenantContextHolder;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Suivi automatique par un prestataire (V134). La réception est publique (le prestataire n'a pas de compte QUOREICH) :
 * le jeton aléatoire de l'adresse identifie la société, et la base refuse un jeton inconnu ou désactivé. Les événements
 * arrivent au format DCSA Track &amp; Trace. Jumeau de la fonction tracking-webhook du nuage.
 */
@RestController
@Tag(name = "Approvisionnement", description = "Suivi automatique des expéditions par un prestataire")
public class TrackingWebhookController {

  private static final ObjectMapper JSON = new ObjectMapper();
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final Sql sql;

  public TrackingWebhookController(JdbcTemplate jdbc, TransactionTemplate tx, Sql sql) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.sql = sql;
  }

  @PostMapping("/api/v1/tracking-webhook/{token}")
  @Operation(operationId = "receiveTrackingEvents", summary = "Réception des événements d'un prestataire de suivi (format DCSA), adresse propre à la société")
  public JsonNode receive(@PathVariable String token, @RequestBody JsonNode payload) {
    if (token == null || !token.matches("[0-9a-f]{64}")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    TenantContextHolder.clear();
    try {
      String r = tx.execute(s -> jdbc.queryForObject("SELECT public.ingest_tracking_events(?, ?::jsonb)::text", String.class, token, payload.toString()));
      return JSON.readTree(r);
    } catch (org.springframework.dao.DataAccessException e) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
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
