package com.quoreich.qerp.config;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * CORS : fermé par défaut.
 *
 * <p>{@code qerp.api.cors.allowed-origins} est vide tant qu'on ne l'a pas renseigné, et une liste
 * vide refuse toute origine tierce. Aucun joker : l'API porte des données comptables, et le jeton
 * voyage dans un en-tête {@code Authorization} (pas de cookie, donc pas de credentials CORS).
 */
@Configuration(proxyBeanMethods = false)
public class CorsConfig {

  @Bean
  CorsConfigurationSource corsConfigurationSource(
      @Value("${qerp.api.cors.allowed-origins:}") String allowedOrigins) {
    List<String> origins =
        Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(o -> !o.isEmpty()).toList();
    CorsConfiguration cors = new CorsConfiguration();
    cors.setAllowedOrigins(origins);
    cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
    cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Correlation-Id"));
    cors.setExposedHeaders(List.of("Content-Disposition", "X-Correlation-Id"));
    cors.setAllowCredentials(false);
    cors.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", cors);
    return source;
  }
}
