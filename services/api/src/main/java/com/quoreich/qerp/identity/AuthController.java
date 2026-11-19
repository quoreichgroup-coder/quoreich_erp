package com.quoreich.qerp.identity;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Connexion sur site, au protocole du serveur d'identité de Supabase (sous-ensemble utilisé par supabase-js) : le
 * client du front, pointé sur l'API, gère session, renouvellement et déconnexion sans changement. Jetons d'accès
 * courts (ES256, mêmes revendications que Supabase : sub, role, aud, email, session_id), jetons de renouvellement à
 * usage unique stockés sous forme d'empreinte, verrouillage après échecs répétés, journal des connexions.
 */
@RestController
@RequestMapping
@ConditionalOnProperty(name = "qerp.identity.mode", havingValue = "local", matchIfMissing = true)
@Tag(name = "Identité", description = "Connexion, renouvellement, déconnexion, compte (protocole compatible supabase-js)")
public class AuthController {

  private static final SecureRandom RANDOM = new SecureRandom();
  /** Empreinte de comparaison pour une adresse inconnue : même durée de réponse qu'un mauvais mot de passe. */
  private static final String DUMMY_HASH = new BCryptPasswordEncoder(10).encode("qerp-adresse-inconnue");

  private final IdentityStore store;
  private final IdentitySettings settings;
  private final JwtEncoder encoder;
  private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(10);

  public AuthController(IdentityStore store, IdentitySettings settings, JwtEncoder encoder) {
    this.store = store;
    this.settings = settings;
    this.encoder = encoder;
  }

  private static ResponseEntity<Object> refus(HttpStatus status, String code, String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", status.value());
    body.put("error_code", code);
    body.put("msg", message);
    return ResponseEntity.status(status).body(body);
  }

  static String sha256(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String randomToken() {
    byte[] b = new byte[32];
    RANDOM.nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  private static String str(Map<String, Object> b, String k) {
    Object v = b == null ? null : b.get(k);
    return v == null ? null : String.valueOf(v);
  }

  private Map<String, Object> user(UUID userId) {
    Map<String, Object> a = store.account(userId);
    if (a == null) return null;
    Map<String, Object> u = new LinkedHashMap<>();
    u.put("id", userId.toString());
    u.put("aud", "authenticated");
    u.put("role", "authenticated");
    u.put("email", a.get("email"));
    u.put("email_confirmed_at", a.get("email_confirmed_at"));
    u.put("confirmed_at", a.get("email_confirmed_at"));
    u.put("last_sign_in_at", a.get("last_sign_in_at"));
    u.put("app_metadata", Map.of("provider", "email", "providers", List.of("email")));
    Map<String, Object> meta = new LinkedHashMap<>();
    if (a.get("full_name") != null) meta.put("full_name", a.get("full_name"));
    u.put("user_metadata", meta);
    u.put("identities", List.of());
    u.put("created_at", a.get("created_at"));
    u.put("updated_at", a.get("created_at"));
    return u;
  }

  private Map<String, Object> session(UUID userId, String email, UUID sessionId, String refreshToken) {
    Instant now = Instant.now();
    Instant exp = now.plus(settings.accessTokenMinutes(), ChronoUnit.MINUTES);
    JwtClaimsSet claims = JwtClaimsSet.builder().issuer(settings.issuer()).subject(userId.toString()).audience(List.of("authenticated"))
        .issuedAt(now).expiresAt(exp).claim("role", "authenticated").claim("email", email).claim("session_id", sessionId.toString())
        .claim("aal", "aal1").claim("amr", List.of(Map.of("method", "password", "timestamp", now.getEpochSecond()))).build();
    String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.ES256).type("JWT").build(), claims)).getTokenValue();
    Map<String, Object> s = new LinkedHashMap<>();
    s.put("access_token", token);
    s.put("token_type", "bearer");
    s.put("expires_in", settings.accessTokenMinutes() * 60);
    s.put("expires_at", exp.getEpochSecond());
    s.put("refresh_token", refreshToken);
    s.put("user", user(userId));
    return s;
  }

  private Map<String, Object> newSession(UUID userId, String email) {
    String refresh = randomToken();
    UUID sid = store.openSession(userId, sha256(refresh), Instant.now().plus(settings.refreshTokenDays(), ChronoUnit.DAYS));
    return session(userId, email, sid, refresh);
  }

  @PostMapping("/auth/v1/token")
  @Operation(operationId = "authToken", summary = "Connexion (grant_type=password) ou renouvellement (grant_type=refresh_token)")
  public ResponseEntity<Object> token(@RequestParam("grant_type") String grantType, @RequestBody(required = false) Map<String, Object> b,
      HttpServletRequest request) {
    if ("refresh_token".equals(grantType)) {
      String rt = str(b, "refresh_token");
      if (rt == null || rt.isBlank()) return refus(HttpStatus.BAD_REQUEST, "refresh_token_not_found", "Session expirée : reconnectez-vous");
      String next = randomToken();
      IdentityStore.Refresh r = store.refresh(sha256(rt), sha256(next), Instant.now().plus(settings.refreshTokenDays(), ChronoUnit.DAYS),
          settings.refreshReuseSeconds());
      if ("reused".equals(r.status())) return refus(HttpStatus.BAD_REQUEST, "refresh_token_already_used", "Session fermée par sécurité : reconnectez-vous");
      if (!"ok".equals(r.status())) return refus(HttpStatus.BAD_REQUEST, "refresh_token_not_found", "Session expirée : reconnectez-vous");
      return ResponseEntity.ok(session(r.userId(), r.email(), r.sessionId(), next));
    }
    if (!"password".equals(grantType)) return refus(HttpStatus.BAD_REQUEST, "unsupported_grant_type", "Type de connexion non pris en charge");
    String email = str(b, "email");
    String password = str(b, "password");
    if (email == null || password == null || email.isBlank() || password.isEmpty()) {
      return refus(HttpStatus.BAD_REQUEST, "validation_failed", "Adresse et mot de passe requis");
    }
    email = email.trim().toLowerCase();
    String ip = request.getRemoteAddr();
    IdentityStore.Login l = store.lookup(email);
    if (l == null) {
      bcrypt.matches(password, DUMMY_HASH);
      store.loginResult(email, null, "login_unknown", settings.maxFailedAttempts(), settings.lockMinutes(), ip);
      return refus(HttpStatus.BAD_REQUEST, "invalid_credentials", "Adresse ou mot de passe incorrect");
    }
    if (l.lockedUntil() != null && l.lockedUntil().isAfter(Instant.now())) {
      store.loginResult(email, l.userId(), "login_locked", settings.maxFailedAttempts(), settings.lockMinutes(), ip);
      return refus(HttpStatus.BAD_REQUEST, "user_locked", "Compte verrouillé après plusieurs échecs : réessayez dans quelques minutes");
    }
    if (!bcrypt.matches(password, l.passwordHash())) {
      store.loginResult(email, l.userId(), "login_failed", settings.maxFailedAttempts(), settings.lockMinutes(), ip);
      return refus(HttpStatus.BAD_REQUEST, "invalid_credentials", "Adresse ou mot de passe incorrect");
    }
    if (l.disabled()) {
      store.loginResult(email, l.userId(), "login_disabled", settings.maxFailedAttempts(), settings.lockMinutes(), ip);
      return refus(HttpStatus.BAD_REQUEST, "user_banned", "Compte désactivé : contactez l'administrateur");
    }
    if (!l.confirmed()) return refus(HttpStatus.BAD_REQUEST, "email_not_confirmed", "Adresse non confirmée");
    store.loginResult(email, l.userId(), "login", settings.maxFailedAttempts(), settings.lockMinutes(), ip);
    return ResponseEntity.ok(newSession(l.userId(), l.email()));
  }

  @PostMapping("/auth/v1/signup")
  @Operation(operationId = "authSignup", summary = "Créer un compte (sans société ; rattachement par création ou invitation)")
  public ResponseEntity<Object> signup(@RequestBody Map<String, Object> b) {
    if (!settings.signupEnabled()) return refus(HttpStatus.FORBIDDEN, "signup_disabled", "Inscription fermée : demandez une invitation à l'administrateur");
    String email = str(b, "email");
    String password = str(b, "password");
    if (email == null || !email.trim().matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")) return refus(HttpStatus.BAD_REQUEST, "validation_failed", "Adresse e-mail invalide");
    if (password == null || password.length() < settings.passwordMinLength()) {
      return refus(HttpStatus.UNPROCESSABLE_ENTITY, "weak_password", "Mot de passe trop court : au moins " + settings.passwordMinLength() + " caractères");
    }
    String fullName = b.get("data") instanceof Map<?, ?> d && d.get("full_name") != null ? String.valueOf(d.get("full_name")) : null;
    UUID id = UUID.randomUUID();
    try {
      store.createAccount(id, email.trim().toLowerCase(), bcrypt.encode(password), fullName);
    } catch (DuplicateKeyException e) {
      return refus(HttpStatus.UNPROCESSABLE_ENTITY, "user_already_exists", "Un compte existe déjà pour cette adresse");
    }
    return ResponseEntity.ok(newSession(id, email.trim().toLowerCase()));
  }

  @PostMapping("/auth/v1/recover")
  @Operation(operationId = "authRecover", summary = "Réinitialisation par e-mail (pas encore disponible sur site)")
  public ResponseEntity<Object> recover() {
    return refus(HttpStatus.BAD_REQUEST, "email_provider_disabled",
        "La réinitialisation par e-mail n'est pas encore disponible sur site : demandez un mot de passe provisoire à un administrateur de votre société");
  }

  @GetMapping("/auth/v1/user")
  @Operation(operationId = "authUser", summary = "Compte connecté")
  public ResponseEntity<Object> me(@AuthenticationPrincipal Jwt jwt) {
    Map<String, Object> u = user(UUID.fromString(jwt.getSubject()));
    return u == null ? refus(HttpStatus.UNAUTHORIZED, "user_not_found", "Compte introuvable") : ResponseEntity.ok(u);
  }

  @PutMapping("/auth/v1/user")
  @Operation(operationId = "authUpdateUser", summary = "Changer son mot de passe (les autres sessions sont fermées)")
  public ResponseEntity<Object> update(@AuthenticationPrincipal Jwt jwt, @RequestBody Map<String, Object> b) {
    UUID userId = UUID.fromString(jwt.getSubject());
    String password = str(b, "password");
    if (password != null) {
      if (password.length() < settings.passwordMinLength()) {
        return refus(HttpStatus.UNPROCESSABLE_ENTITY, "weak_password", "Mot de passe trop court : au moins " + settings.passwordMinLength() + " caractères");
      }
      store.setPassword(userId, bcrypt.encode(password), IdentityConfig.uuid(jwt.getClaimAsString("session_id")));
    }
    return ResponseEntity.ok(user(userId));
  }

  @PostMapping("/auth/v1/logout")
  @Operation(operationId = "authLogout", summary = "Déconnexion (scope local, global ou others)")
  public ResponseEntity<Void> logout(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "global") String scope) {
    String s = switch (scope) {
      case "local", "others" -> scope;
      default -> "global";
    };
    store.closeSession(IdentityConfig.uuid(jwt.getClaimAsString("session_id")), UUID.fromString(jwt.getSubject()), s);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/v1/identity/members/{userId}/temporary-password")
  @Operation(operationId = "setTemporaryPassword", summary = "Mot de passe provisoire d'un membre de la société (administrateur) ; affiché une seule fois")
  public ResponseEntity<Object> temporaryPassword(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID userId) {
    String password = randomToken().substring(0, 16);
    store.adminReset(UUID.fromString(jwt.getSubject()), userId, bcrypt.encode(password));
    return ResponseEntity.ok(Map.of("password", password));
  }
}
