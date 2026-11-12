package com.quoreich.qerp.analytics;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Paramétrage analytique (V19, V20).
 *
 * <p>Aucun filtre société : la RLS le porte, et un axe d'une autre société est simplement
 * introuvable (404), sans révéler qu'il existe. Les droits sont vérifiés avant d'écrire pour
 * renvoyer un 403 lisible ; les politiques RLS restent la barrière réelle. Pas de suppression
 * d'axe ni de section : on désactive, comme dans SAP ou Sage X3, pour ne pas casser l'historique
 * des imputations.
 */
@Repository
public class AnalyticsQuery {

  private final JdbcTemplate jdbc;

  public AnalyticsQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public AnalyticsSetupView setup() {
    Map<UUID, List<AnalyticValueView>> values = new LinkedHashMap<>();
    jdbc.query(
        "SELECT id, axis_id, code, name, parent_id, valid_from, valid_to, is_active"
            + " FROM analytic_values ORDER BY code",
        rs -> {
          values
              .computeIfAbsent(rs.getObject("axis_id", UUID.class), k -> new ArrayList<>())
              .add(
                  new AnalyticValueView(
                      rs.getObject("id", UUID.class),
                      rs.getString("code"),
                      rs.getString("name"),
                      rs.getObject("parent_id", UUID.class),
                      rs.getObject("valid_from", LocalDate.class),
                      rs.getObject("valid_to", LocalDate.class),
                      rs.getBoolean("is_active")));
        });
    Map<UUID, List<AnalyticRuleView>> rules = new LinkedHashMap<>();
    jdbc.query(
        "SELECT axis_id, account_prefix, requirement FROM analytic_rules ORDER BY account_prefix",
        rs -> {
          rules
              .computeIfAbsent(rs.getObject("axis_id", UUID.class), k -> new ArrayList<>())
              .add(new AnalyticRuleView(rs.getString("account_prefix"), rs.getString("requirement")));
        });
    List<AnalyticAxisView> axes =
        jdbc.query(
            "SELECT id, code, name, sort_order, is_active FROM analytic_axes ORDER BY sort_order, code",
            (rs, i) -> {
              UUID id = rs.getObject("id", UUID.class);
              return new AnalyticAxisView(
                  id,
                  rs.getString("code"),
                  rs.getString("name"),
                  rs.getInt("sort_order"),
                  rs.getBoolean("is_active"),
                  List.copyOf(values.getOrDefault(id, List.of())),
                  List.copyOf(rules.getOrDefault(id, List.of())));
            });
    return new AnalyticsSetupView(isAdmin(), canManageValues(), axes);
  }

  @Transactional
  public AnalyticsSetupView createAxis(CreateAnalyticAxis in) {
    requireAdmin();
    if (exists("SELECT EXISTS (SELECT 1 FROM analytic_axes WHERE code = ?)", in.code())) {
      throw new AnalyticsRefusal(409, "Un axe porte déjà le code " + in.code());
    }
    jdbc.update(
        "INSERT INTO analytic_axes (tenant_id, code, name, sort_order)"
            + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, ?)",
        in.code(),
        in.name().strip(),
        in.sortOrder() == null ? 0 : in.sortOrder());
    return setup();
  }

  @Transactional
  public AnalyticsSetupView updateAxis(UUID axis, UpdateAnalyticAxis in) {
    requireAdmin();
    int n =
        jdbc.update(
            "UPDATE analytic_axes SET name = ?, sort_order = COALESCE(?, sort_order), is_active = ?"
                + " WHERE id = ?",
            in.name().strip(),
            in.sortOrder(),
            in.active(),
            axis);
    if (n == 0) throw new AnalyticsRefusal(404, "Axe analytique introuvable");
    return setup();
  }

  @Transactional
  public AnalyticsSetupView createValue(UUID axis, CreateAnalyticValue in) {
    requireValueManager();
    requireAxis(axis);
    if (exists("SELECT EXISTS (SELECT 1 FROM analytic_values WHERE axis_id = ? AND code = ?)", axis, in.code().strip())) {
      throw new AnalyticsRefusal(409, "Une section de cet axe porte déjà le code " + in.code().strip());
    }
    requireParentOnAxis(in.parentId(), axis);
    jdbc.update(
        "INSERT INTO analytic_values (tenant_id, axis_id, code, name, parent_id, valid_from, valid_to)"
            + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, ?, ?, ?, ?)",
        axis,
        in.code().strip(),
        in.name().strip(),
        in.parentId(),
        in.validFrom(),
        in.validTo());
    return setup();
  }

  @Transactional
  public AnalyticsSetupView updateValue(UUID value, UpdateAnalyticValue in) {
    requireValueManager();
    List<UUID> axis =
        jdbc.query("SELECT axis_id FROM analytic_values WHERE id = ?", (rs, i) -> rs.getObject(1, UUID.class), value);
    if (axis.isEmpty()) throw new AnalyticsRefusal(404, "Section analytique introuvable");
    requireParentOnAxis(in.parentId(), axis.getFirst());
    if (in.parentId() != null
        && exists(
            "WITH RECURSIVE ascendants(id) AS (SELECT ?::uuid UNION ALL"
                + " SELECT v.parent_id FROM analytic_values v JOIN ascendants a ON v.id = a.id"
                + " WHERE v.parent_id IS NOT NULL)"
                + " SELECT EXISTS (SELECT 1 FROM ascendants WHERE id = ?)",
            in.parentId(),
            value)) {
      throw new AnalyticsRefusal(422, "Hiérarchie circulaire : une section ne peut pas descendre d'elle-même");
    }
    jdbc.update(
        "UPDATE analytic_values SET name = ?, parent_id = ?, valid_from = ?, valid_to = ?, is_active = ?"
            + " WHERE id = ?",
        in.name().strip(),
        in.parentId(),
        in.validFrom(),
        in.validTo(),
        in.active(),
        value);
    return setup();
  }

  @Transactional
  public AnalyticsSetupView setRule(UUID axis, String prefix, SetAnalyticRule in) {
    requireAdmin();
    requireAxis(axis);
    if (!AnalyticsViews.PREFIX.matcher(prefix).matches()) {
      throw new AnalyticsRefusal(400, "Le préfixe de compte ne contient que des chiffres (ex. 6, 70, 701)");
    }
    jdbc.update(
        "INSERT INTO analytic_rules (tenant_id, axis_id, account_prefix, requirement)"
            + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, ?)"
            + " ON CONFLICT (axis_id, account_prefix) DO UPDATE SET requirement = EXCLUDED.requirement",
        axis,
        prefix,
        in.requirement());
    return setup();
  }

  @Transactional
  public AnalyticsSetupView deleteRule(UUID axis, String prefix) {
    requireAdmin();
    int n = jdbc.update("DELETE FROM analytic_rules WHERE axis_id = ? AND account_prefix = ?", axis, prefix);
    if (n == 0) throw new AnalyticsRefusal(404, "Règle introuvable");
    return setup();
  }

  // ─── Contrôles ───

  private boolean exists(String sql, Object... args) {
    return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, args));
  }

  private boolean isAdmin() {
    return Boolean.TRUE.equals(jdbc.queryForObject("SELECT is_tenant_admin()", Boolean.class));
  }

  private boolean canManageValues() {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT tenant_has_any_role(ARRAY['admin', 'accountant'])", Boolean.class));
  }

  private void requireAdmin() {
    if (!isAdmin()) {
      throw new AnalyticsRefusal(403, "Rôle administrateur requis dans la société courante");
    }
  }

  private void requireValueManager() {
    if (!canManageValues()) {
      throw new AnalyticsRefusal(403, "Rôle administrateur ou comptable requis dans la société courante");
    }
  }

  private void requireAxis(UUID axis) {
    if (!exists("SELECT EXISTS (SELECT 1 FROM analytic_axes WHERE id = ?)", axis)) {
      throw new AnalyticsRefusal(404, "Axe analytique introuvable");
    }
  }

  private void requireParentOnAxis(UUID parent, UUID axis) {
    if (parent != null
        && !exists("SELECT EXISTS (SELECT 1 FROM analytic_values WHERE id = ? AND axis_id = ?)", parent, axis)) {
      throw new AnalyticsRefusal(422, "La section parente doit appartenir au même axe");
    }
  }
}
