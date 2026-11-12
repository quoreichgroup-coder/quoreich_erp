package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Paramétrage comptable : quel compte du plan porte chaque rôle (compte clients, ventes, TVA,
 * banque…). C'est ce que lisent les comptabilisations automatiques ; un rôle sans compte actif
 * les fait refuser.
 */
@RestController
@RequestMapping("/api/v1/accounting")
@Tag(
    name = "Paramétrage comptable",
    description = "Référentiel et comptes de comptabilisation de la société du porteur")
public class AccountingSetupController {

  private static final Logger LOG = LoggerFactory.getLogger(AccountingSetupController.class);

  private final AccountingSetupQuery query;

  public AccountingSetupController(AccountingSetupQuery query) {
    this.query = query;
  }

  @GetMapping("/frameworks")
  @Operation(operationId = "listAccountingFrameworks", summary = "Lister les référentiels comptables")
  public List<AccountingFrameworkView> frameworks() {
    return query.frameworks();
  }

  @GetMapping("/setup")
  @Operation(
      operationId = "getAccountingSetup",
      summary = "Lire le paramétrage comptable de la société",
      description = "Référentiel appliqué, droit de modification du porteur, et compte de chaque rôle.")
  public AccountingSetupView setup() {
    return query.setup();
  }

  @GetMapping("/gl-accounts")
  @Operation(operationId = "listGlAccounts", summary = "Lister les comptes du plan de la société")
  public List<GlAccountOption> accounts() {
    return query.accounts();
  }

  @PostMapping("/frameworks/{code}/apply")
  @Operation(
      operationId = "applyAccountingFramework",
      summary = "Appliquer un référentiel à la société",
      description =
          "Crée les comptes absents du plan et associe les rôles non encore paramétrés ; ne"
              + " remplace jamais un choix existant. Rejouable sans effet. 403 hors administrateur"
              + " de la société, 404 si le référentiel est inconnu, 409 si la société en applique"
              + " déjà un autre.")
  public ApplyFrameworkResult apply(@PathVariable String code) {
    return query.apply(code);
  }

  @PutMapping("/posting-accounts/{role}")
  @Operation(
      operationId = "assignPostingAccount",
      summary = "Associer un compte à un rôle comptable",
      description =
          "404 si le rôle est inconnu, 403 hors administrateur de la société, 422 si le compte"
              + " n'appartient pas au plan de la société ou est inactif.")
  public ResponseEntity<?> assign(
      @PathVariable String role, @RequestBody AssignPostingAccount body) {
    String problem = body.problem();
    if (problem != null) {
      return ResponseEntity.badRequest().body(Map.of("error", problem));
    }
    return ResponseEntity.ok(query.assign(role, body.glAccountId()));
  }

  @GetMapping("/tax-codes")
  @Operation(operationId = "listTaxCodes", summary = "Lister les codes TVA de la société")
  public List<TaxCodeView> taxCodes() {
    return query.taxCodes();
  }

  @PostMapping("/tax-codes")
  @Operation(
      operationId = "createTaxCode",
      summary = "Créer un code TVA",
      description = "Administrateur de la société. Le taux est figé après création. 409 si le code existe.")
  public ResponseEntity<?> createTaxCode(@RequestBody CreateTaxCode body) {
    if (body.problem() != null) return ResponseEntity.badRequest().body(Map.of("error", body.problem()));
    return ResponseEntity.ok(query.createTaxCode(body));
  }

  @PutMapping("/tax-codes/{id}")
  @Operation(
      operationId = "updateTaxCode",
      summary = "Renommer, activer ou désactiver un code TVA, ou changer son compte",
      description = "Administrateur de la société. Le code et le taux ne se modifient pas.")
  public ResponseEntity<?> updateTaxCode(@PathVariable java.util.UUID id, @RequestBody UpdateTaxCode body) {
    if (body.problem() != null) return ResponseEntity.badRequest().body(Map.of("error", body.problem()));
    return ResponseEntity.ok(query.updateTaxCode(id, body));
  }

  @ExceptionHandler(AccountingRefusal.class)
  public ResponseEntity<Map<String, String>> refused(AccountingRefusal e) {
    LOG.warn("Paramétrage comptable refusé ({}) : {}", e.status().value(), e.getMessage());
    return ResponseEntity.status(e.status()).body(Map.of("error", e.getMessage()));
  }

  /** Refus levés par apply_accounting_framework() : codes SQL connus, messages rédigés ici. */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException e) {
    LOG.warn("Paramétrage comptable refusé par la base : {}", e.getMostSpecificCause().getMessage());
    String state = null;
    for (Throwable t = e; t != null && state == null; t = t.getCause()) {
      if (t instanceof SQLException sql) state = sql.getSQLState();
    }
    return switch (state == null ? "" : state) {
      case "22023" -> refus(HttpStatus.NOT_FOUND, "Référentiel comptable inconnu");
      case "23514" ->
          refus(
              HttpStatus.CONFLICT,
              "La société applique déjà un autre référentiel : en changer est une migration"
                  + " comptable, pas un paramètre");
      case "42501" -> refus(HttpStatus.FORBIDDEN, "Rôle administrateur requis dans la société courante");
      default -> refus(HttpStatus.CONFLICT, "Opération refusée par les règles comptables");
    };
  }

  private static ResponseEntity<Map<String, String>> refus(HttpStatus status, String message) {
    return ResponseEntity.status(status).body(Map.of("error", message));
  }
}
