package com.quoreich.qerp.identity;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Accès au schéma qerp_identity, uniquement par ses fonctions (V114) ; chaque appel est sa propre transaction. */
@Component
@Transactional
public class IdentityStore {

  public record Login(UUID userId, String email, String passwordHash, boolean confirmed, boolean disabled, Instant lockedUntil) {}

  public record Refresh(String status, UUID userId, UUID sessionId, String email) {}

  private final JdbcTemplate jdbc;

  public IdentityStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Login lookup(String email) {
    List<Login> rows = jdbc.query("SELECT * FROM qerp_identity.login_lookup(?)", (rs, i) -> {
      Timestamp locked = rs.getTimestamp("locked_until");
      return new Login(rs.getObject("user_id", UUID.class), rs.getString("email"), rs.getString("password_hash"),
          rs.getTimestamp("email_confirmed_at") != null, rs.getBoolean("disabled"), locked == null ? null : locked.toInstant());
    }, email);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public void loginResult(String email, UUID userId, String outcome, int maxAttempts, int lockMinutes, String ip) {
    jdbc.queryForList("SELECT qerp_identity.login_result(?, ?, ?, ?, ?, ?)", email, userId, outcome, maxAttempts, lockMinutes, ip);
  }

  public UUID openSession(UUID userId, String tokenHash, Instant expiresAt) {
    return jdbc.queryForObject("SELECT qerp_identity.session_open(?, ?, ?)", UUID.class, userId, tokenHash, Timestamp.from(expiresAt));
  }

  public Refresh refresh(String oldHash, String newHash, Instant expiresAt, int reuseSeconds) {
    return jdbc.queryForObject("SELECT * FROM qerp_identity.session_refresh(?, ?, ?, ?)", (rs, i) -> new Refresh(rs.getString("status"),
        rs.getObject("user_id", UUID.class), rs.getObject("session_id", UUID.class), rs.getString("email")), oldHash, newHash, Timestamp.from(expiresAt), reuseSeconds);
  }

  public boolean sessionActive(UUID sessionId, UUID userId) {
    return Boolean.TRUE.equals(jdbc.queryForObject("SELECT qerp_identity.session_active(?, ?)", Boolean.class, sessionId, userId));
  }

  public void closeSession(UUID sessionId, UUID userId, String scope) {
    jdbc.queryForList("SELECT qerp_identity.session_close(?, ?, ?)", sessionId, userId, scope);
  }

  public void createAccount(UUID userId, String email, String hash, String fullName) {
    jdbc.queryForList("SELECT qerp_identity.account_create(?, ?, ?, ?)", userId, email, hash, fullName);
  }

  public Map<String, Object> account(UUID userId) {
    List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM qerp_identity.account_get(?)", userId);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public void setPassword(UUID userId, String hash, UUID keepSession) {
    jdbc.queryForList("SELECT qerp_identity.account_set_password(?, ?, ?)", userId, hash, keepSession);
  }

  public void adminReset(UUID actor, UUID target, String hash) {
    jdbc.queryForList("SELECT qerp_identity.account_admin_reset(?, ?, ?)", actor, target, hash);
  }
}
