package com.quoreich.qerp.customer;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Point d'entrée de recette du lot 1 (socle applicatif et identité).
 *
 * <p>Il existe pour porter le critère de sortie du lot : « une requête
 * authentifiée renvoie des données filtrées par société, et la recette négative
 * est refusée côté serveur ». Le contrôleur reste volontairement minimal — la
 * tranche verticale « comptes clients » complète appartient au lot 2.
 */
@RestController
@RequestMapping("/api/v1/customers")
@Tag(name = "Clients", description = "Comptes clients de la société du porteur du jeton")
public class CustomerController {

  private final CustomerQuery customerQuery;

  public CustomerController(CustomerQuery customerQuery) {
    this.customerQuery = customerQuery;
  }

  /**
   * {@code operationId} est explicite et qualifié par le domaine.
   *
   * <p>Laissé à Springdoc, il vaudrait {@code list} — le nom de la méthode. Les
   * tranches verticales des lots 2 à 4 auront toutes leur {@code list}, et des
   * identifiants d'opération dupliqués cassent les clients générés : la
   * bibliothèque les utilise comme noms de fonctions, et deux opérations
   * homonymes en écrasent une silencieusement.
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
}
