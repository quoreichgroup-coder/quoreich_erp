package com.quoreich.qerp.identity;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;

/**
 * Identité locale : clé de signature, émission et vérification des jetons. Un jeton n'est accepté que s'il est
 * signé par la clé de l'instance, émis par elle, destiné à « authenticated », non expiré, et si sa session est encore
 * ouverte (une déconnexion ou un changement de mot de passe prend effet immédiatement, pas à l'expiration).
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "qerp.identity.mode", havingValue = "local", matchIfMissing = true)
public class IdentityConfig {

  /** Routes publiques de connexion : on n'y lit aucun porteur (supabase-js y envoie sa clé publique, qui n'est pas un jeton). */
  static final List<String> PUBLIC_AUTH = List.of("/auth/v1/token", "/auth/v1/signup", "/auth/v1/recover", "/auth/v1/settings");

  @Bean
  ECKey qerpSigningKey(IdentitySettings settings) {
    return SigningKey.loadOrCreate(settings.keyFile());
  }

  @Bean
  JwtEncoder qerpJwtEncoder(ECKey qerpSigningKey) {
    return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(qerpSigningKey)));
  }

  @Bean
  JwtDecoder qerpJwtDecoder(ECKey qerpSigningKey, IdentitySettings settings, IdentityStore store) throws JOSEException {
    DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
    processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.ES256, new ImmutableJWKSet<>(new JWKSet(qerpSigningKey.toPublicJWK()))));
    NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
    OAuth2TokenValidator<Jwt> audience = jwt -> jwt.getAudience() != null && jwt.getAudience().contains("authenticated")
        ? OAuth2TokenValidatorResult.success()
        : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Destinataire du jeton invalide", null));
    OAuth2TokenValidator<Jwt> session = jwt -> {
      UUID sid = uuid(jwt.getClaimAsString("session_id"));
      UUID sub = uuid(jwt.getSubject());
      return sid != null && sub != null && store.sessionActive(sid, sub)
          ? OAuth2TokenValidatorResult.success()
          : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Session fermée", null));
    };
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(settings.issuer()), audience, session));
    return decoder;
  }

  @Bean
  BearerTokenResolver qerpBearerTokenResolver() {
    DefaultBearerTokenResolver standard = new DefaultBearerTokenResolver();
    return (HttpServletRequest request) -> {
      if (PUBLIC_AUTH.contains(request.getRequestURI())) return null;
      String token = standard.resolve(request);
      // Un porteur qui n'est pas un JWT (clé publique d'un client) vaut absence de jeton : la route décide.
      return token != null && token.chars().filter(c -> c == '.').count() == 2 ? token : null;
    };
  }

  static UUID uuid(String s) {
    try {
      return s == null ? null : UUID.fromString(s);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
