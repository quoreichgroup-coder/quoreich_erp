package com.quoreich.qerp.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Donne un identifiant commun à tous les journaux d'une même requête.
 *
 * <p>Sans lui, relier une erreur signalée par un utilisateur à sa trace serveur
 * demande de recouper les horodatages — ce qui ne fonctionne pas dès qu'il y a de
 * la concurrence.
 *
 * <h2>L'en-tête entrant n'est pas repris tel quel</h2>
 * Il vient du client. Le verser brut dans les journaux ouvrirait deux brèches :
 * une injection de faux événements par retour chariot, et une croissance non
 * bornée des lignes. Seuls les identifiants d'une forme stricte sont acceptés ;
 * tout le reste est remplacé par un identifiant engendré côté serveur. Le client
 * conserve ainsi la corrélation qu'il a initiée sans pouvoir écrire dans nos
 * journaux.
 *
 * <p>Rang le plus élevé : le MDC doit être peuplé avant la chaîne de sécurité,
 * pour que les refus d'authentification soient eux aussi corrélés.
 */
@Component
public class CorrelationIdFilter extends OncePerRequestFilter implements Ordered {

  public static final String HEADER = "X-Correlation-Id";
  public static final String MDC_KEY = "correlationId";

  /** Forme acceptée : ni espace, ni retour chariot, ni antislash. */
  private static final Pattern SAFE = Pattern.compile("[A-Za-z0-9._:-]{8,128}");

  @Override
  public int getOrder() {
    return Ordered.HIGHEST_PRECEDENCE;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {

    String correlationId = sanitize(request.getHeader(HEADER));
    response.setHeader(HEADER, correlationId);

    try (MDC.MDCCloseable ignored = MDC.putCloseable(MDC_KEY, correlationId)) {
      chain.doFilter(request, response);
    }
  }

  private static String sanitize(String candidate) {
    if (candidate != null && SAFE.matcher(candidate).matches()) {
      return candidate;
    }
    return UUID.randomUUID().toString();
  }
}
