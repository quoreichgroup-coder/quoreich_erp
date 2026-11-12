package com.quoreich.qerp.accounting;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Paramétrage comptable de la société (V18).
 *
 * <p>Aucun filtre société ici : la RLS le porte. Les droits d'écriture sont vérifiés
 * explicitement par {@code is_tenant_admin()} avant d'écrire, pour renvoyer un 403 lisible ; la
 * politique RLS « Administrateur de la société » reste la barrière réelle.
 */
@Repository
public class AccountingSetupQuery {

  private static final RowMapper<AccountingFrameworkView> FRAMEWORK =
      (rs, i) ->
          new AccountingFrameworkView(
              rs.getString("code"),
              rs.getString("name"),
              rs.getString("scope"),
              rs.getString("version"),
              rs.getBoolean("is_validated"));

  private static final RowMapper<PostingAccountView> ROLE =
      (rs, i) -> {
        UUID account = rs.getObject("gl_account_id", UUID.class);
        return new PostingAccountView(
            rs.getString("code"),
            rs.getString("label"),
            rs.getString("module"),
            rs.getString("description"),
            account,
            rs.getString("account_code"),
            rs.getString("account_name"),
            account != null && rs.getBoolean("is_active"),
            rs.getString("suggested"));
      };

  private final JdbcTemplate jdbc;

  public AccountingSetupQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public List<AccountingFrameworkView> frameworks() {
    return jdbc.query(
        "SELECT code, name, scope, version, is_validated FROM accounting_frameworks ORDER BY code",
        FRAMEWORK);
  }

  @Transactional(readOnly = true)
  public AccountingSetupView setup() {
    AccountingFrameworkView framework =
        jdbc
            .query(
                "SELECT f.code, f.name, f.scope, f.version, f.is_validated"
                    + " FROM tenant_accounting_settings s"
                    + " JOIN accounting_frameworks f ON f.code = s.framework_code",
                FRAMEWORK)
            .stream()
            .findFirst()
            .orElse(null);
    // tenant_posting_accounts et tenant_accounting_settings ne rendent que la société du porteur
    // (RLS) : les jointures externes n'ont donc pas besoin de filtre société.
    List<PostingAccountView> roles =
        jdbc.query(
            "SELECT r.code, r.label, r.module, r.description, p.gl_account_id,"
                + " g.code AS account_code, g.name AS account_name, g.is_active,"
                + " d.account_code AS suggested"
                + " FROM posting_roles r"
                + " LEFT JOIN tenant_posting_accounts p ON p.role_code = r.code"
                + " LEFT JOIN gl_accounts g ON g.id = p.gl_account_id"
                + " LEFT JOIN tenant_accounting_settings s ON true"
                + " LEFT JOIN accounting_framework_role_defaults d"
                + "   ON d.role_code = r.code AND d.framework_code = s.framework_code"
                + " ORDER BY r.module, r.code",
            ROLE);
    return AccountingSetupView.of(framework, isAdmin(), roles);
  }

  @Transactional(readOnly = true)
  public List<GlAccountOption> accounts() {
    return jdbc.query(
        "SELECT id, code, name, account_type, is_active FROM gl_accounts ORDER BY code",
        (rs, i) ->
            new GlAccountOption(
                rs.getObject("id", UUID.class),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("account_type"),
                rs.getBoolean("is_active")));
  }

  @Transactional
  public ApplyFrameworkResult apply(String framework) {
    requireAdmin();
    return jdbc.queryForObject(
        "SELECT r->>'referentiel' AS f, (r->>'comptes_crees')::int AS a,"
            + " (r->>'roles_parametres')::int AS n"
            + " FROM (SELECT public.apply_accounting_framework(?) AS r) x",
        (rs, i) -> new ApplyFrameworkResult(rs.getString("f"), rs.getInt("a"), rs.getInt("n")),
        framework);
  }

  /**
   * Associe un compte à un rôle. Ordre des contrôles : rôle connu (404), droit (403), compte du
   * plan de la société et actif (422) — un compte d'une autre société est invisible sous la RLS,
   * donc « inconnu », sans révéler qu'il existe.
   */
  @Transactional
  public AccountingSetupView assign(String role, UUID glAccountId) {
    if (!Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM posting_roles WHERE code = ?)", Boolean.class, role))) {
      throw new AccountingRefusal(HttpStatus.NOT_FOUND, "Rôle comptable inconnu : " + role);
    }
    requireAdmin();
    List<Boolean> active =
        jdbc.query(
            "SELECT is_active FROM gl_accounts WHERE id = ?", (rs, i) -> rs.getBoolean(1), glAccountId);
    if (active.isEmpty()) {
      throw new AccountingRefusal(
          HttpStatus.valueOf(422), "Compte inconnu dans le plan de la société");
    }
    if (!active.getFirst()) {
      throw new AccountingRefusal(
          HttpStatus.valueOf(422),
          "Compte inactif : il ne peut pas porter de comptabilisation");
    }
    jdbc.update(
        "INSERT INTO tenant_posting_accounts (tenant_id, role_code, gl_account_id, updated_by,"
            + " updated_at) VALUES (get_user_tenant_id(auth.uid()), ?, ?, auth.uid(), now())"
            + " ON CONFLICT (tenant_id, role_code) DO UPDATE SET gl_account_id ="
            + " EXCLUDED.gl_account_id, updated_by = EXCLUDED.updated_by, updated_at = now()",
        role,
        glAccountId);
    return setup();
  }

  private boolean isAdmin() {
    return Boolean.TRUE.equals(jdbc.queryForObject("SELECT is_tenant_admin()", Boolean.class));
  }

  private void requireAdmin() {
    if (!isAdmin()) {
      throw new AccountingRefusal(
          HttpStatus.FORBIDDEN, "Rôle administrateur requis dans la société courante");
    }
  }
}
