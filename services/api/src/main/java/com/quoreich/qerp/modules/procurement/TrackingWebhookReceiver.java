package com.quoreich.qerp.modules.procurement;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Réception publique des événements DCSA (V134) : sans utilisateur connecté, la fonction {@code ingest_tracking_events}
 * (exécutable par qerp_api seulement) retrouve la société par le jeton de l'adresse. Hors du contrôleur, comme le veut
 * {@code ArchitectureTest} : seule cette classe parle à la base sans contexte de société, dans une transaction explicite
 * (la source de données ne valide rien hors transaction).
 */
@Service
class TrackingWebhookReceiver {

  private static final ObjectMapper JSON = new ObjectMapper();
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;

  TrackingWebhookReceiver(JdbcTemplate jdbc, TransactionTemplate tx) {
    this.jdbc = jdbc;
    this.tx = tx;
  }

  JsonNode receive(String token, JsonNode payload) {
    if (token == null || !token.matches("[0-9a-f]{64}")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    TenantContextHolder.clear();
    try {
      String r = tx.execute(s -> jdbc.queryForObject("SELECT public.ingest_tracking_events(?, ?::jsonb)::text", String.class, token, payload.toString()));
      return JSON.readTree(r);
    } catch (org.springframework.dao.DataAccessException e) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
  }
}
