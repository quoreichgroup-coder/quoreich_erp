package com.quoreich.qerp.authorization;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Matrice des autorisations : rôles (système, en lecture seule ; sur mesure, modifiables), leurs
 * droits du catalogue, et qui a quel rôle. Le seul endroit où se décident les droits ; la base
 * les applique (has_permission, has_role) et journalise chaque changement.
 */
@RestController
@RequestMapping("/api/v1/authorizations")
@Tag(name = "Autorisations", description = "Rôles, droits et affectations de la société du porteur")
public class AuthorizationController {

  private static final Logger LOG = LoggerFactory.getLogger(AuthorizationController.class);

  private final AuthorizationQuery query;

  public AuthorizationController(AuthorizationQuery query) {
    this.query = query;
  }

  @GetMapping
  @Operation(operationId = "getAuthorizations", summary = "Lire la matrice : catalogue, rôles, utilisateurs")
  public AuthorizationsView view() {
    return query.view();
  }

  @GetMapping("/me")
  @Operation(operationId = "getMyAccess", summary = "Mes rôles et mes droits dans la société courante",
      description = "Ce que les écrans utilisent pour activer ou verrouiller les actions ; la base vérifie de toute façon.")
  public MyAccessView me() {
    return query.me();
  }

  @GetMapping("/audit")
  @Operation(operationId = "listAuthorizationAudit", summary = "Journal des changements d'autorisations",
      description = "Administrateur de la société. Du plus récent au plus ancien.")
  public List<AuthorizationAuditView> audit(@RequestParam(defaultValue = "100") int limit) {
    return query.audit(limit);
  }

  @PostMapping("/roles")
  @Operation(operationId = "createRole", summary = "Créer un rôle sur mesure",
      description = "Administrateur. copyFromRoleId recopie les droits d'un rôle existant. 409 si le nom existe.")
  public ResponseEntity<?> createRole(@RequestBody CreateRole body) {
    return run(body.problem(), () -> query.createRole(body));
  }

  @PutMapping("/roles/{role}")
  @Operation(operationId = "updateRole", summary = "Renommer un rôle sur mesure, ou l'activer",
      description = "Administrateur. 409 pour un rôle système.")
  public ResponseEntity<?> updateRole(@PathVariable UUID role, @RequestBody UpdateRole body) {
    return run(body.problem(), () -> query.updateRole(role, body));
  }

  @PutMapping("/roles/{role}/permissions")
  @Operation(operationId = "setRolePermissions", summary = "Fixer les droits d'un rôle sur mesure",
      description = "Remplace la liste. 409 pour un rôle système, 422 si un droit est inconnu du catalogue.")
  public ResponseEntity<?> setPermissions(@PathVariable UUID role, @RequestBody SetRolePermissions body) {
    return run(body.problem(), () -> query.setPermissions(role, body));
  }

  @DeleteMapping("/roles/{role}")
  @Operation(operationId = "deleteRole", summary = "Supprimer un rôle sur mesure",
      description = "409 s'il est encore affecté, ou pour un rôle système.")
  public AuthorizationsView deleteRole(@PathVariable UUID role) {
    return query.deleteRole(role);
  }

  @PostMapping("/assignments")
  @Operation(operationId = "assignRole", summary = "Affecter un rôle à un utilisateur de la société",
      description = "Administrateur. 404 si l'utilisateur n'est pas de la société, 409 pour un rôle à revoir.")
  public ResponseEntity<?> assign(@RequestBody AssignRole body) {
    return run(body.problem(), () -> query.assign(body));
  }

  @DeleteMapping("/assignments/{user}/{role}")
  @Operation(operationId = "revokeRole", summary = "Retirer un rôle à un utilisateur",
      description = "409 pour le dernier administrateur de la société.")
  public AuthorizationsView revoke(@PathVariable UUID user, @PathVariable UUID role) {
    return query.revoke(user, role);
  }

  private static ResponseEntity<?> run(String problem, Supplier<AuthorizationsView> action) {
    if (problem != null) return ResponseEntity.badRequest().body(Map.of("error", problem));
    return ResponseEntity.ok(action.get());
  }

  @ExceptionHandler(AuthorizationRefusal.class)
  public ResponseEntity<Map<String, String>> refused(AuthorizationRefusal e) {
    LOG.warn("Autorisations : refus ({}) : {}", e.status(), e.getMessage());
    return ResponseEntity.status(e.status()).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<Map<String, String>> database(DataAccessException e) {
    LOG.warn("Autorisations : refus de la base : {}", e.getMostSpecificCause().getMessage());
    return ResponseEntity.status(409).body(Map.of("error", "Modification refusée par les règles d'autorisation"));
  }
}
