package com.quoreich.qerp.tenant;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Traduit le jeton en contexte de session pour la durée de la requête.
 *
 * <h2>Rang du filtre</h2>
 * Il doit s'exécuter <em>après</em> la chaîne de sécurité, sinon l'authentification
 * n'est pas encore établie et il ne trouverait aucun jeton. La chaîne Spring
 * Security est enregistrée à l'ordre -100 ; on se place juste derrière.
 *
 * <h2>Ce qui est refusé, et ce qui ne l'est pas</h2>
 * <ul>
 *   <li>{@code sub} absent ou non convertible en UUID : <strong>403</strong>. Sans
 *       lui {@code auth.uid()} vaut NULL et toutes les listes seraient vides ;
 *       rendre « aucune donnée » pour un jeton malformé enverrait l'exploitant
 *       chercher une panne de données inexistante.
 *   <li>Revendication société absente : <strong>accepté</strong>. La RLS ne s'en
 *       sert pas — elle résout la société depuis {@code profiles} — et l'exiger
 *       rejetterait des jetons parfaitement valides.
 *   <li>Revendication société présente mais illisible : <strong>403</strong>. Une
 *       revendication d'identité malformée est une erreur, pas une absence.
 * </ul>
 *
 * <p>Le message de refus est identique quelle que soit la cause : il ne doit pas
 * indiquer au porteur d'un jeton ce qui manque, ni révéler la structure des rôles.
 */
@Component
public class TenantContextFilter extends OncePerRequestFilter implements Ordered {

  private static final Logger log = LoggerFactory.getLogger(TenantContextFilter.class);

  private static final int ORDER = -90;

  private final String tenantClaim;

  public TenantContextFilter(@Value("${qerp.tenant.claim:tenant_id}") String tenantClaim) {
    this.tenantClaim = tenantClaim;
  }

  @Override
  public int getOrder() {
    return ORDER;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {

    try {
      Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
      if (authentication instanceof JwtAuthenticationToken token
          && !bindContext(token.getToken())) {
        refuse(response);
        return;
      }
      chain.doFilter(request, response);
    } finally {
      // Obligatoire : le thread retourne au pool et servirait sinon la requête
      // suivante avec l'identité de celle-ci.
      TenantContextHolder.clear();
    }
  }

  private boolean bindContext(Jwt jwt) {
    UUID userId = parseUuid(jwt.getSubject());
    if (userId == null) {
      log.debug("Jeton sans claim `sub` exploitable.");
      return false;
    }

    String rawTenant = jwt.getClaimAsString(tenantClaim);
    UUID tenantId = null;
    if (rawTenant != null && !rawTenant.isBlank()) {
      tenantId = parseUuid(rawTenant);
      if (tenantId == null) {
        log.debug("Claim `{}` présent mais illisible.", tenantClaim);
        return false;
      }
    }

    TenantContextHolder.set(new TenantPrincipal(userId, tenantId));
    return true;
  }

  private static UUID parseUuid(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    try {
      return UUID.fromString(raw.trim());
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static void refuse(HttpServletResponse response) throws IOException {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    response.getWriter().write("{\"error\":\"forbidden\"}");
  }
}
