package com.quoreich.qerp.identity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Réglages de l'identité sur site (installation, pas société : ce sont des règles de sécurité de l'instance).
 * {@code QERP_IDENTITY_MODE=local} (défaut) : l'API émet et vérifie ses propres jetons ; {@code external} : jetons
 * d'un émetteur externe ({@code spring.security.oauth2.resourceserver.jwt.*}, par exemple Supabase en transition).
 */
@Component
public class IdentitySettings {

  private final String mode;
  private final String issuer;
  private final String keyFile;
  private final int accessTokenMinutes;
  private final int refreshTokenDays;
  private final int maxFailedAttempts;
  private final int lockMinutes;
  private final int passwordMinLength;
  private final boolean signupEnabled;
  private final int refreshReuseSeconds;

  public IdentitySettings(
      @Value("${qerp.identity.mode:local}") String mode,
      @Value("${qerp.identity.issuer:qerp}") String issuer,
      @Value("${qerp.identity.key-file:./data/identity/signing-key.json}") String keyFile,
      @Value("${qerp.identity.access-token-minutes:60}") int accessTokenMinutes,
      @Value("${qerp.identity.refresh-token-days:30}") int refreshTokenDays,
      @Value("${qerp.identity.max-failed-attempts:5}") int maxFailedAttempts,
      @Value("${qerp.identity.lock-minutes:15}") int lockMinutes,
      @Value("${qerp.identity.password-min-length:10}") int passwordMinLength,
      @Value("${qerp.identity.signup-enabled:true}") boolean signupEnabled,
      @Value("${qerp.identity.refresh-reuse-seconds:10}") int refreshReuseSeconds) {
    this.mode = mode;
    this.issuer = issuer;
    this.keyFile = keyFile;
    this.accessTokenMinutes = Math.max(1, accessTokenMinutes);
    this.refreshTokenDays = Math.max(1, refreshTokenDays);
    this.maxFailedAttempts = Math.max(1, maxFailedAttempts);
    this.lockMinutes = Math.max(1, lockMinutes);
    this.passwordMinLength = Math.max(8, passwordMinLength);
    this.signupEnabled = signupEnabled;
    this.refreshReuseSeconds = Math.max(0, refreshReuseSeconds);
  }

  public boolean local() {
    return !"external".equalsIgnoreCase(mode);
  }

  public String issuer() {
    return issuer;
  }

  public String keyFile() {
    return keyFile;
  }

  public int accessTokenMinutes() {
    return accessTokenMinutes;
  }

  public int refreshTokenDays() {
    return refreshTokenDays;
  }

  public int maxFailedAttempts() {
    return maxFailedAttempts;
  }

  public int lockMinutes() {
    return lockMinutes;
  }

  public int passwordMinLength() {
    return passwordMinLength;
  }

  public boolean signupEnabled() {
    return signupEnabled;
  }

  /** Délai pendant lequel un jeton de renouvellement déjà consommé reste accepté (onglets simultanés). */
  public int refreshReuseSeconds() {
    return refreshReuseSeconds;
  }
}
