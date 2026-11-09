package com.quoreich.qerp.tenant;

import java.util.Optional;

/**
 * Porte l'identité du demandeur pour la durée d'une requête HTTP.
 *
 * <p>Ce n'est pas la sécurité : c'est le <em>transport</em> de l'identité depuis
 * le jeton jusqu'à la connexion JDBC, où elle devient la variable de session que
 * lisent les politiques RLS. La sécurité reste la RLS elle-même, côté base : ce
 * champ peut être vidé ou falsifié en mémoire, l'effet est une liste vide, jamais
 * un accès élargi.
 *
 * <p>Le vidage est obligatoire en fin de requête. En l'absence de vidage, un
 * <em>thread</em> réutilisé du pool servirait la requête suivante avec l'identité
 * précédente — c'est la raison pour laquelle {@link TenantContextFilter} vide
 * dans un {@code finally} et que {@link TenantAwareDataSource} traite l'absence
 * de contexte comme un refus (revendications vides), jamais comme un passe-droit.
 */
public final class TenantContextHolder {

  private static final ThreadLocal<TenantPrincipal> CURRENT = new ThreadLocal<>();

  private TenantContextHolder() {}

  public static void set(TenantPrincipal principal) {
    CURRENT.set(principal);
  }

  public static Optional<TenantPrincipal> current() {
    return Optional.ofNullable(CURRENT.get());
  }

  /**
   * Vide le contexte. Toujours appelé dans un {@code finally} : ne pas le faire
   * fait fuiter une identité vers la requête suivante sur le même thread.
   */
  public static void clear() {
    CURRENT.remove();
  }
}
