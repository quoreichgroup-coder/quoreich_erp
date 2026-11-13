package com.quoreich.qerp.customer;

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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Comptes clients de la société du porteur du jeton : liste, création, modification.
 *
 * <p>La liste date du Lot 1 (critère de sortie : données filtrées par société, recette négative
 * refusée côté serveur). Création et modification arrivent le 14 novembre 2026 : sans elles,
 * le front en mode « sur site » créait ses clients dans Supabase et ses factures dans la base
 * locale. Les droits sont ceux de la politique RLS de {@code customers} (tout membre de la
 * société), comme dans le nuage.
 */
@RestController
@RequestMapping("/api/v1/customers")
@Tag(name = "Clients", description = "Comptes clients de la société du porteur du jeton")
public class CustomerController {

  private static final Logger LOG = LoggerFactory.getLogger(CustomerController.class);

  private final CustomerQuery customerQuery;

  public CustomerController(CustomerQuery customerQuery) {
    this.customerQuery = customerQuery;
  }

  /**
   * {@code operationId} est explicite et qualifié par le domaine : laissé à Springdoc, il vaudrait
   * {@code list}, et des identifiants dupliqués entre tranches cassent les clients générés.
   */
  @GetMapping
  @Operation(
      operationId = "listCustomers",
      summary = "Lister les clients visibles",
      description =
          """
          Renvoie les clients de la société du porteur du jeton, triés par nom.

          Aucun paramètre de société : le périmètre est résolu côté serveur depuis le profil \
          de l'utilisateur et appliqué par les politiques RLS de PostgreSQL. Une requête \
          portant le jeton d'une autre société renvoie les clients de cette autre société, \
          jamais un élargissement.""")
  public List<CustomerView> list() {
    return customerQuery.findVisible();
  }

  @PostMapping
  @Operation(
      operationId = "createCustomer",
      summary = "Créer un client",
      description = "Le client est créé dans la société du profil de l'appelant ; 400 si la saisie est invalide.")
  public ResponseEntity<?> create(@RequestBody CustomerInput body) {
    if (body.problem() != null) return ResponseEntity.badRequest().body(Map.of("error", body.problem()));
    return ResponseEntity.status(HttpStatus.CREATED).body(customerQuery.create(body));
  }

  @PutMapping("/{id}")
  @Operation(
      operationId = "updateCustomer",
      summary = "Modifier un client",
      description = "404 si le client n'appartient pas à la société de l'appelant.")
  public ResponseEntity<?> update(@PathVariable UUID id, @RequestBody CustomerInput body) {
    if (body.problem() != null) return ResponseEntity.badRequest().body(Map.of("error", body.problem()));
    CustomerView updated = customerQuery.update(id, body);
    if (updated == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Client introuvable"));
    return ResponseEntity.ok(updated);
  }

  /** Refus de la base (RLS, contrainte) : message générique, détail dans le journal seulement. */
  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException e) {
    LOG.warn("Écriture client refusée par la base : {}", e.getMostSpecificCause().getMessage());
    return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Opération refusée par la base"));
  }
}
