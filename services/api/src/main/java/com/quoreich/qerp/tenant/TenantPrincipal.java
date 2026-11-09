package com.quoreich.qerp.tenant;

import java.util.UUID;

/**
 * Identité du demandeur pour la requête en cours.
 *
 * <h2>Ce qui fait autorité</h2>
 * Seul {@code userId} (claim {@code sub}) est déterminant. C'est la valeur que
 * renvoie {@code auth.uid()}, et la politique RLS du schéma s'écrit :
 *
 * <pre>tenant_id = get_user_tenant_id(auth.uid())</pre>
 *
 * <p>La société effective est donc résolue <em>en base</em>, depuis
 * {@code profiles.tenant_id} — jamais depuis le jeton. Un client qui falsifierait
 * une revendication société ne changerait rien à ce qu'il peut lire : la RLS ne
 * la consulte pas.
 *
 * <p>{@code tenantId} est purement informatif : il est retransmis dans
 * {@code request.jwt.claims} pour les fonctions qui lisent explicitement
 * {@code auth.jwt() ->> 'tenant_id'}, comme les RPC de consolidation, qui
 * confrontent de toute façon la valeur à {@code get_accessible_tenants()}. Il
 * peut être absent sans que la requête cesse d'être valide — d'où le
 * {@code null} autorisé.
 *
 * @param userId identifiant du compte, tel que porté par le claim {@code sub}
 * @param tenantId société revendiquée par le jeton, ou {@code null} si le jeton
 *     n'en porte pas
 */
public record TenantPrincipal(UUID userId, UUID tenantId) {

  public TenantPrincipal {
    if (userId == null) {
      throw new IllegalArgumentException(
          "userId est obligatoire : sans lui, auth.uid() vaut NULL et la RLS ne renvoie rien");
    }
  }
}
