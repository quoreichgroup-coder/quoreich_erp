package com.quoreich.qerp.authorization;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Vues et commandes de la matrice des autorisations (V23, V25). */
final class AuthorizationViews {
  private AuthorizationViews() {}
}

/** Matrice de la société du porteur : catalogue des droits, rôles, utilisateurs. */
record AuthorizationsView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Administrateur de la société") boolean canManage,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PermissionView> catalog,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<RoleView> roles,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UserView> users) {}

record PermissionView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String module,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String action,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label) {}

/**
 * Rôle de la société. {@code system} : rôle standard, en lecture seule ({@code code} = son
 * identifiant). {@code needsReview} : rôle sur mesure repris de l'ancienne matrice, sans effet
 * tant qu'il n'est pas activé.
 */
record RoleView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String description,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean system,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean needsReview,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> permissions,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int memberCount) {}

record UserView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String fullName,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UUID> roleIds) {}

record AuthorizationAuditView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime at,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String actor,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String action,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String roleName,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String targetUser,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String permission) {}

/** Rôles système détenus et droits accordés au porteur, dans sa société (my_access, V27). */
record MyAccessView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> roles,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> permissions) {}

record CreateRole(String name, String description, UUID copyFromRoleId) {
  String problem() {
    return name == null || name.isBlank() ? "name obligatoire" : null;
  }
}

/** {@code active} vrai : un rôle « à revoir » devient effectif. */
record UpdateRole(String name, String description, Boolean active) {
  String problem() {
    if (name == null || name.isBlank()) return "name obligatoire";
    if (active == null) return "active obligatoire";
    return null;
  }
}

record SetRolePermissions(List<String> permissions) {
  String problem() {
    return permissions == null ? "permissions obligatoire (liste, éventuellement vide)" : null;
  }
}

record AssignRole(UUID userId, UUID roleId) {
  String problem() {
    return userId == null || roleId == null ? "userId et roleId obligatoires" : null;
  }
}

/** Refus métier avec son statut HTTP ; message rédigé ici. */
class AuthorizationRefusal extends RuntimeException {
  private final int status;

  AuthorizationRefusal(int status, String message) {
    super(message);
    this.status = status;
  }

  int status() {
    return status;
  }
}
