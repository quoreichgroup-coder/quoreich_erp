package com.quoreich.qerp.platform;

import java.sql.SQLException;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Traduction commune des refus de la base pour les modules portés (lots 3 à 5).
 *
 * <p>Les messages rédigés par la base (gardes {@code QGxxx}, {@code RAISE}, droits 42501, contraintes)
 * sont ceux que l'écran affiche déjà sur le chemin Supabase : ils sont rendus tels quels, ce qui garde la
 * parité entre nuage et sur site. Toute autre erreur reste générique (pas de détail technique au client),
 * avec son SQLSTATE dans le journal. Les contrôleurs du lot 2 gardent leurs propres gestionnaires, qui
 * priment sur celui-ci.
 */
@RestControllerAdvice(basePackages = "com.quoreich.qerp.modules")
@Order(Ordered.LOWEST_PRECEDENCE)
public class DatabaseRefusalAdvice {

  private static final Logger LOG = LoggerFactory.getLogger(DatabaseRefusalAdvice.class);
  private static final Set<String> UNPROCESSABLE = Set.of("P0001", "22023", "23514", "22P02", "22007", "22008", "22003", "23502", "22001", "22004");
  private static final Set<String> CONFLICT = Set.of("23505", "23503", "40001", "40P01", "55P03");

  @ExceptionHandler(ApiRefusal.class)
  public ResponseEntity<Map<String, String>> refused(ApiRefusal refusal) {
    return ResponseEntity.status(refusal.status()).body(Map.of("error", refusal.getMessage()));
  }

  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException error) {
    String state = null;
    String message = null;
    for (Throwable c = error; c != null && state == null; c = c.getCause()) {
      if (c instanceof SQLException sql) {
        state = sql.getSQLState();
        message = serverMessage(sql.getMessage());
      }
    }
    String s = state == null ? "" : state;
    int status = s.equals("42501") ? 403 : s.startsWith("QG") || UNPROCESSABLE.contains(s) ? 422 : CONFLICT.contains(s) ? 409 : 500;
    if (status == 500 || message == null) {
      LOG.warn("Erreur de base non traduite (SQLSTATE {})", s, error);
      return ResponseEntity.status(status == 500 ? 500 : status)
          .body(Map.of("error", "Le serveur a rencontré une erreur : réessayez, ou contactez l'administrateur"));
    }
    return ResponseEntity.status(status).body(Map.of("error", message));
  }

  /** Message du serveur sans le préfixe de gravité ni les lignes de contexte (Where, Detail…). */
  static String serverMessage(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String first = raw.lines().findFirst().orElse("").trim();
    int colon = first.indexOf(": ");
    if (colon > 0 && first.substring(0, colon).matches("[A-ZÉ]+")) first = first.substring(colon + 2);
    return first.isBlank() ? null : first;
  }

  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<Map<String, String>> invalid(IllegalArgumentException error) {
    return ResponseEntity.status(400).body(Map.of("error", "Requête invalide"));
  }
}
