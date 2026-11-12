package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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

  @PostMapping
  @Operation(
      operationId = "createArInvoice",
      summary = "Émettre une facture client",
      description =
          "Comptabilise l'écriture équilibrée dans la même transaction. 409 si refusée (période"
              + " close, règle comptable) : aucun effet partiel.")
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
          "Solde et statut recalculés côté base. 404 si la facture n'est pas visible, 409 si"
              + " l'encaissement est refusé (surpaiement, période close).")
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

  /** Message générique : le détail SQL ne sort pas du serveur. */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> refused(DataAccessException e) {
    LOG.warn("Opération AR refusée : {}", e.getMostSpecificCause().getMessage());
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(Map.of("error", "Opération refusée par les règles comptables"));
  }
}
