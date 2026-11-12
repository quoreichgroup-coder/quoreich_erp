package com.quoreich.qerp.analytics;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Analytique : axes (département, centre de coûts, projet…), leurs sections, et les règles qui
 * rendent un axe obligatoire ou interdit selon le compte. Les écritures concernées sont refusées
 * à la comptabilisation (QG002) quand une règle n'est pas respectée.
 */
@RestController
@RequestMapping("/api/v1/analytics")
@Tag(name = "Analytique", description = "Axes, sections et règles analytiques de la société du porteur")
public class AnalyticsController {

  private static final Logger LOG = LoggerFactory.getLogger(AnalyticsController.class);

  private final AnalyticsQuery query;

  public AnalyticsController(AnalyticsQuery query) {
    this.query = query;
  }

  @GetMapping
  @Operation(operationId = "getAnalyticsSetup", summary = "Lire le paramétrage analytique de la société")
  public AnalyticsSetupView setup() {
    return query.setup();
  }

  @PostMapping("/axes")
  @Operation(
      operationId = "createAnalyticAxis",
      summary = "Créer un axe analytique",
      description = "Administrateur de la société. 409 si le code existe déjà.")
  public ResponseEntity<?> createAxis(@RequestBody CreateAnalyticAxis body) {
    return run(body.problem(), () -> query.createAxis(body));
  }

  @PutMapping("/axes/{axis}")
  @Operation(
      operationId = "updateAnalyticAxis",
      summary = "Renommer, ordonner, activer ou désactiver un axe",
      description = "Administrateur de la société. Un axe désactivé n'est plus contrôlé ni imputé.")
  public ResponseEntity<?> updateAxis(@PathVariable UUID axis, @RequestBody UpdateAnalyticAxis body) {
    return run(body.problem(), () -> query.updateAxis(axis, body));
  }

  @PostMapping("/axes/{axis}/values")
  @Operation(
      operationId = "createAnalyticValue",
      summary = "Créer une section sur un axe",
      description = "Administrateur ou comptable. 409 si le code existe sur l'axe, 422 si le parent est sur un autre axe.")
  public ResponseEntity<?> createValue(@PathVariable UUID axis, @RequestBody CreateAnalyticValue body) {
    return run(body.problem(), () -> query.createValue(axis, body));
  }

  @PutMapping("/values/{value}")
  @Operation(
      operationId = "updateAnalyticValue",
      summary = "Modifier une section (libellé, parent, validité, activation)",
      description = "Administrateur ou comptable. 422 si la hiérarchie devient circulaire.")
  public ResponseEntity<?> updateValue(@PathVariable UUID value, @RequestBody UpdateAnalyticValue body) {
    return run(body.problem(), () -> query.updateValue(value, body));
  }

  @PutMapping("/axes/{axis}/rules/{prefix}")
  @Operation(
      operationId = "setAnalyticRule",
      summary = "Rendre un axe obligatoire ou interdit sur une plage de comptes",
      description = "Administrateur de la société. Le préfixe le plus long l'emporte ; sans règle, l'axe est facultatif.")
  public ResponseEntity<?> setRule(
      @PathVariable UUID axis, @PathVariable String prefix, @RequestBody SetAnalyticRule body) {
    return run(body.problem(), () -> query.setRule(axis, prefix, body));
  }

  @DeleteMapping("/axes/{axis}/rules/{prefix}")
  @Operation(operationId = "deleteAnalyticRule", summary = "Retirer une règle analytique")
  public AnalyticsSetupView deleteRule(@PathVariable UUID axis, @PathVariable String prefix) {
    return query.deleteRule(axis, prefix);
  }

  private static ResponseEntity<?> run(String problem, Supplier<AnalyticsSetupView> action) {
    if (problem != null) return ResponseEntity.badRequest().body(Map.of("error", problem));
    return ResponseEntity.ok(action.get());
  }

  @ExceptionHandler(AnalyticsRefusal.class)
  public ResponseEntity<Map<String, String>> refused(AnalyticsRefusal e) {
    LOG.warn("Paramétrage analytique refusé ({}) : {}", e.status(), e.getMessage());
    return ResponseEntity.status(e.status()).body(Map.of("error", e.getMessage()));
  }

  /** Barrière de la base (contrainte, garde de hiérarchie) : message générique, détail au journal. */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException e) {
    LOG.warn("Paramétrage analytique refusé par la base : {}", e.getMostSpecificCause().getMessage());
    return ResponseEntity.status(422).body(Map.of("error", "Modification refusée par les règles de cohérence de l'analytique"));
  }
}
