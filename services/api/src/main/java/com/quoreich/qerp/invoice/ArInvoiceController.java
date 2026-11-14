package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ar/invoices")
@Tag(name = "Factures clients", description = "Factures et encaissements AR de la société du porteur")
public class ArInvoiceController {

  private static final Logger LOG = LoggerFactory.getLogger(ArInvoiceController.class);

  private final ArInvoiceQuery query;

  public ArInvoiceController(ArInvoiceQuery query) {
    this.query = query;
  }

  @GetMapping
  @Operation(operationId = "listArInvoices", summary = "Lister les factures clients visibles")
  public List<ArInvoiceView> list() {
    return query.findVisible();
  }

  @GetMapping(value = "/export", produces = "text/csv;charset=UTF-8")
  @Operation(
      operationId = "exportArInvoices",
      summary = "Exporter les factures clients en CSV",
      description =
          "Même périmètre que la liste : uniquement la société du porteur (RLS), jamais d'autre.")
  public ResponseEntity<String> export() {
    return ResponseEntity.ok()
        .header("Content-Disposition", "attachment; filename=\"factures-clients.csv\"")
        .body(ArInvoiceCsv.render(query.findVisible()));
  }

  @GetMapping("/{id}")
  @Operation(operationId = "getArInvoice", summary = "Lire une facture client")
  public ResponseEntity<ArInvoiceView> get(@PathVariable UUID id) {
    return query.findById(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/{id}/lines")
  @Operation(operationId = "listArInvoiceLines", summary = "Lire les lignes d'une facture client",
      description = "Liste vide pour une facture d'en-tête (sans ligne). 404 si la facture n'est pas visible.")
  public ResponseEntity<List<ArInvoiceQuery.ArInvoiceLineView>> lines(@PathVariable UUID id) {
    return query.lines(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
  }

  @PostMapping
  @Operation(
      operationId = "createArInvoice",
      summary = "Émettre une facture client",
      description =
          "Comptabilise l'écriture équilibrée dans la même transaction. 409 si refusée (période"
              + " close, règle comptable) : aucun effet partiel. 403 sans rôle admin ou accountant dans"
              + " la société courante. 422 si le plan comptable de la société est incomplet (le"
              + " message nomme les comptes manquants).")
  public ResponseEntity<?> create(@RequestBody CreateArInvoice body) {
    String problem = body.problem();
    if (problem != null) {
      return ResponseEntity.badRequest().body(Map.of("error", problem));
    }
    return ResponseEntity.status(HttpStatus.CREATED).body(query.create(body));
  }

  @PostMapping("/{id}/payments")
  @Operation(
      operationId = "recordArPayment",
      summary = "Enregistrer un encaissement",
      description =
          "Solde et statut recalculés côté base. 404 si la facture n'est pas visible, 422 si la"
              + " base refuse avec un motif (reste dû dépassé, facture non ouverte, plan comptable"
              + " incomplet), 409 pour un autre refus (période close), 403 sans rôle admin ou"
              + " accountant, ou sans le droit ar.receipt (V42).")
  public ResponseEntity<?> pay(@PathVariable UUID id, @RequestBody RecordArPayment body) {
    String problem = body.problem();
    if (problem != null) {
      return ResponseEntity.badRequest().body(Map.of("error", problem));
    }
    return query
        .pay(id, body)
        .<ResponseEntity<?>>map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/{id}/payments")
  @Operation(operationId = "listArPayments", summary = "Lire les règlements d'une facture client",
      description = "Encaissements et annulations (montant négatif, V42). 404 si la facture n'est pas visible.")
  public ResponseEntity<List<ArPaymentView>> payments(@PathVariable UUID id) {
    return query.payments(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
  }

  @PostMapping("/{id}/payments/{paymentId}/reversal")
  @Operation(
      operationId = "reverseArPayment",
      summary = "Annuler un encaissement (contre-passation)",
      description =
          "L'écriture bancaire est contre-passée et la facture redevient due ; l'encaissement"
              + " d'origine est conservé. 404 si la facture ou le règlement n'est pas visible, 422"
              + " si la base refuse (déjà annulé, motif, date), 403 sans le droit ar.reverse_receipt.")
  public ResponseEntity<?> reverse(
      @PathVariable UUID id, @PathVariable UUID paymentId, @RequestBody ReverseArPayment body) {
    String problem = body.problem();
    if (problem != null) {
      return ResponseEntity.badRequest().body(Map.of("error", problem));
    }
    return query
        .reverse(id, paymentId, body)
        .<ResponseEntity<?>>map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  /**
   * Refus de la base.
   *
   * <p>Par défaut, message générique : le détail SQL ne sort pas du serveur. Seules exceptions, les
   * codes {@code QG001} (paramétrage comptable incomplet) et {@code QG002} (imputation analytique) : son message est rédigé par le schéma, ne
   * contient que des codes de comptes, et c'est précisément ce que l'utilisateur doit lire pour
   * corriger — comme le « détermination de compte impossible » de SAP. 422 et non 409 : la requête
   * est bien formée, mais le paramétrage de la société ne permet pas de la traiter.
   */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> refused(DataAccessException e) {
    LOG.warn("Opération AR refusée : {}", e.getMostSpecificCause().getMessage());
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && REFUS_METIER.contains(sql.getSQLState())) {
        return ResponseEntity.status(422).body(Map.of("error", premiereLigne(sql)));
      }
    }
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && "42501".equals(sql.getSQLState())) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", premiereLigne(sql)));
      }
    }
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && "23505".equals(sql.getSQLState())) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(Map.of("error", "Ce numéro de facture existe déjà dans la société"));
      }
    }
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(Map.of("error", "Opération refusée par les règles comptables"));
  }

  /**
   * QG001 : paramétrage comptable incomplet (V17, V18) ; QG002 : imputation analytique (V19) ;
   * QG005 : règlement refusé (V36, V42 : reste dû, facture non ouverte, déjà annulé, motif) ;
   * QG009 : facture émise figée (V42). Messages rédigés par le schéma, en français, sans donnée
   * d'une autre société.
   */
  private static final java.util.Set<String> REFUS_METIER = java.util.Set.of("QG001", "QG002", "QG005", "QG009");

  /** « ERROR: message\n  Hint: … » → « message » (préfixe de sévérité éventuellement localisé). */
  private static String premiereLigne(SQLException e) {
    String message = String.valueOf(e.getMessage()).lines().findFirst().orElse("");
    return message.replaceFirst("^[\\p{Lu}]+:\\s*", "");
  }

  @ExceptionHandler(ArInvoiceUnprocessable.class)
  public ResponseEntity<Map<String, String>> unprocessable(ArInvoiceUnprocessable e) {
    LOG.warn("Facture AR inapplicable : {}", e.getMessage());
    return ResponseEntity.status(422).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(ArWriteForbidden.class)
  public ResponseEntity<Map<String, String>> forbidden(ArWriteForbidden e) {
    LOG.warn("Écriture AR refusée : rôle insuffisant");
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
  }
}
