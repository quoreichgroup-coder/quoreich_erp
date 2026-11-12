package com.quoreich.qerp.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;

/**
 * Chaîne de sécurité de l'API.
 *
 * <h2>Réglage par défaut : tout est fermé</h2>
 * Seuls les points de santé sont ouverts. Tout le reste exige une
 * authentification, y compris les points Actuator de métriques : ils exposent la
 * topologie interne et le nom des dépendances, utiles à un attaquant et sans
 * intérêt pour un utilisateur.
 *
 * <h2>Absence de configuration Keycloak : le démarrage n'échoue pas</h2>
 * Le décodeur de jetons n'est déclaré que si {@code spring.security.oauth2.
 * resourceserver.jwt.*} est renseigné — c'est-à-dire dès qu'un émetteur Keycloak
 * est configuré. On le récupère donc par {@link ObjectProvider} plutôt que par
 * injection directe : sans lui, l'application démarre sur une chaîne qui refuse
 * tout, ce qui est le bon comportement pour un socle pas encore raccordé à
 * l'annuaire.
 */
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {

  @Bean
  SecurityFilterChain apiSecurityFilterChain(
      HttpSecurity http, ObjectProvider<JwtDecoder> jwtDecoders, Environment environment)
      throws Exception {

    // Le document OpenAPI et l'interface Swagger ne sont ouverts que sous le
    // profil `dev`. En production, ils resteraient une énumération complète de la
    // surface d'attaque, servie sans authentification.
    boolean posteDeDeveloppement = environment.matchesProfiles("dev");

    http
        // Aucun cookie d'authentification : le porteur est un en-tête Authorization
        // que le navigateur n'ajoute pas tout seul. Il n'y a donc pas de requête
        // forgée à travers le navigateur, et le jeton CSRF protégerait un vecteur
        // inexistant.
        // CORS avant l'authentification : une pré-requête OPTIONS ne porte pas de jeton.
        .cors(Customizer.withDefaults())
        .csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .httpBasic(AbstractHttpConfigurer::disable)
        .formLogin(AbstractHttpConfigurer::disable)
        .logout(AbstractHttpConfigurer::disable)
        .authorizeHttpRequests(
            auth -> {
              auth.requestMatchers(
                      "/health", "/actuator/health", "/actuator/health/**", "/actuator/info")
                  .permitAll();
              if (posteDeDeveloppement) {
                auth.requestMatchers("/v3/api-docs", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html")
                    .permitAll();
              }
              auth.anyRequest().authenticated();
            })
        // 401 et non 302 : un client d'API n'a pas de formulaire de connexion où
        // atterrir.
        .exceptionHandling(
            handling ->
                handling.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));

    JwtDecoder decoder = jwtDecoders.getIfAvailable();
    if (decoder != null) {
      http.oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
    }

    return http.build();
  }
}
