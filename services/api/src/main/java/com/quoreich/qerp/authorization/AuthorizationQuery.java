package com.quoreich.qerp.authorization;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Matrice des autorisations (V23, V25). Aucun filtre société : la RLS le porte. Les règles
 * métier sont contrôlées ici pour des messages précis ; les gardes de la base (rôles système
 * intouchables, écriture réservée à l'administrateur) restent la barrière réelle. Le journal est
 * écrit par la base elle-même.
 */
@Repository
public class AuthorizationQuery {

  private final JdbcTemplate jdbc;

  public AuthorizationQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public AuthorizationsView view() {
    List<PermissionView> catalog =
        jdbc.query(
            "SELECT code, module, action, label FROM erp_permission_catalog ORDER BY module, code",
            (rs, i) -> new PermissionView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)));
    Map<UUID, List<String>> perms = new HashMap<>();
    jdbc.query(
        "SELECT role_id, permission_code FROM erp_role_permissions ORDER BY permission_code",
        rs -> {
          perms.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getString(2));
        });
    Map<UUID, List<UUID>> userRoles = new HashMap<>();
    jdbc.query(
        "SELECT user_id, role_id FROM user_role_assignments",
        rs -> {
          userRoles.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class));
        });
    List<RoleView> roles =
        jdbc.query(
            "SELECT r.id, r.name, r.description, r.code, r.is_system, r.needs_review,"
                + " (SELECT count(*) FROM user_role_assignments a WHERE a.role_id = r.id)"
                + " FROM erp_roles r LEFT JOIN erp_system_roles s ON s.code = r.code"
                + " ORDER BY r.is_system, s.module NULLS FIRST, r.name",
            (rs, i) -> {
              UUID id = rs.getObject(1, UUID.class);
              return new RoleView(id, rs.getString(2), rs.getString(3), rs.getString(4), rs.getBoolean(5),
                  rs.getBoolean(6), List.copyOf(perms.getOrDefault(id, List.of())), rs.getInt(7));
            });
    List<UserView> users =
        jdbc.query(
            "SELECT id, COALESCE(NULLIF(btrim(full_name), ''), 'Sans nom') FROM profiles ORDER BY 2",
            (rs, i) -> {
              UUID id = rs.getObject(1, UUID.class);
              return new UserView(id, rs.getString(2), List.copyOf(userRoles.getOrDefault(id, List.of())));
            });
    return new AuthorizationsView(isAdmin(), catalog, roles, users);
  }

  @Transactional(readOnly = true)
  public MyAccessView me() {
    return jdbc.queryForObject(
        "SELECT ARRAY(SELECT jsonb_array_elements_text(a->'roles')), ARRAY(SELECT jsonb_array_elements_text(a->'permissions'))"
            + " FROM (SELECT my_access() AS a) x",
        (rs, i) -> new MyAccessView(
            List.of((String[]) rs.getArray(1).getArray()), List.of((String[]) rs.getArray(2).getArray())));
  }

  @Transactional(readOnly = true)
  public List<AuthorizationAuditView> audit(int limit) {
    requireAdmin();
    return jdbc.query(
        "SELECT a.created_at, pa.full_name, a.action, a.role_name, pt.full_name, a.permission_code"
            + " FROM erp_authorization_audit a"
            + " LEFT JOIN profiles pa ON pa.id = a.actor_id LEFT JOIN profiles pt ON pt.id = a.target_user_id"
            // seq (V28) : created_at est l'heure de la transaction, commune à tous ses événements.
            + " ORDER BY a.seq DESC LIMIT ?",
        (rs, i) -> new AuthorizationAuditView(rs.getObject(1, OffsetDateTime.class), rs.getString(2), rs.getString(3),
            rs.getString(4), rs.getString(5), rs.getString(6)),
        Math.max(1, Math.min(limit, 500)));
  }

  @Transactional
  public AuthorizationsView createRole(CreateRole in) {
    requireAdmin();
    String name = in.name().strip();
    if (exists("SELECT EXISTS (SELECT 1 FROM erp_roles WHERE name = ?)", name)) {
      throw new AuthorizationRefusal(409, "Un rôle porte déjà le nom « " + name + " »");
    }
    if (in.copyFromRoleId() != null && !exists("SELECT EXISTS (SELECT 1 FROM erp_roles WHERE id = ?)", in.copyFromRoleId())) {
      throw new AuthorizationRefusal(404, "Rôle à copier introuvable");
    }
    UUID id = jdbc.queryForObject(
        "INSERT INTO erp_roles (tenant_id, name, description) VALUES (get_user_tenant_id(auth.uid()), ?, ?) RETURNING id",
        UUID.class, name, blankToNull(in.description()));
    if (in.copyFromRoleId() != null) {
      // Dériver un rôle sur mesure d'un rôle existant, comme on copie un rôle standard SAP.
      jdbc.update(
          "INSERT INTO erp_role_permissions (role_id, permission_code)"
              + " SELECT ?, permission_code FROM erp_role_permissions WHERE role_id = ?",
          id, in.copyFromRoleId());
    }
    return view();
  }

  @Transactional
  public AuthorizationsView updateRole(UUID role, UpdateRole in) {
    requireAdmin();
    requireCustom(role);
    String name = in.name().strip();
    if (exists("SELECT EXISTS (SELECT 1 FROM erp_roles WHERE name = ? AND id <> ?)", name, role)) {
      throw new AuthorizationRefusal(409, "Un rôle porte déjà le nom « " + name + " »");
    }
    jdbc.update(
        "UPDATE erp_roles SET name = ?, description = ?, needs_review = CASE WHEN ? THEN false ELSE needs_review END"
            + " WHERE id = ?",
        name, blankToNull(in.description()), in.active(), role);
    return view();
  }

  @Transactional
  public AuthorizationsView setPermissions(UUID role, SetRolePermissions in) {
    requireAdmin();
    requireCustom(role);
    Set<String> wanted = new LinkedHashSet<>(in.permissions());
    List<String> unknown = new ArrayList<>();
    for (String code : wanted) {
      if (!exists("SELECT EXISTS (SELECT 1 FROM erp_permission_catalog WHERE code = ?)", code)) unknown.add(code);
    }
    if (!unknown.isEmpty()) {
      throw new AuthorizationRefusal(422, "Droits inconnus du catalogue : " + String.join(", ", unknown));
    }
    String[] codes = wanted.toArray(String[]::new);
    jdbc.update(
        "DELETE FROM erp_role_permissions WHERE role_id = ? AND NOT (permission_code = ANY (?::text[]))",
        role, codes);
    jdbc.update(
        "INSERT INTO erp_role_permissions (role_id, permission_code) SELECT ?, unnest(?::text[]) ON CONFLICT DO NOTHING",
        role, codes);
    return view();
  }

  @Transactional
  public AuthorizationsView deleteRole(UUID role) {
    requireAdmin();
    requireCustom(role);
    int members = jdbc.queryForObject("SELECT count(*) FROM user_role_assignments WHERE role_id = ?", Integer.class, role);
    if (members > 0) {
      throw new AuthorizationRefusal(409, "Retirez d'abord ce rôle à ses " + members + " utilisateur(s)");
    }
    jdbc.update("DELETE FROM erp_roles WHERE id = ?", role);
    return view();
  }

  @Transactional
  public AuthorizationsView assign(AssignRole in) {
    requireAdmin();
    if (!exists("SELECT EXISTS (SELECT 1 FROM profiles WHERE id = ? AND tenant_id = get_user_tenant_id(auth.uid()))", in.userId())) {
      throw new AuthorizationRefusal(404, "Utilisateur introuvable dans la société");
    }
    List<Boolean> review = jdbc.query("SELECT needs_review FROM erp_roles WHERE id = ?", (rs, i) -> rs.getBoolean(1), in.roleId());
    if (review.isEmpty()) throw new AuthorizationRefusal(404, "Rôle introuvable");
    if (review.getFirst()) {
      throw new AuthorizationRefusal(409, "Rôle à revoir : vérifiez ses droits et activez-le avant de l'affecter");
    }
    jdbc.update(
        "INSERT INTO user_role_assignments (user_id, role_id, tenant_id, assigned_by)"
            + " VALUES (?, ?, get_user_tenant_id(auth.uid()), auth.uid()) ON CONFLICT (user_id, role_id) DO NOTHING",
        in.userId(), in.roleId());
    return view();
  }

  @Transactional
  public AuthorizationsView revoke(UUID user, UUID role) {
    requireAdmin();
    // Ne jamais laisser une société sans administrateur : plus personne ne pourrait la paramétrer.
    if (exists("SELECT EXISTS (SELECT 1 FROM erp_roles WHERE id = ? AND code = 'admin')", role)
        && jdbc.queryForObject(
                "SELECT count(*) FROM user_role_assignments a JOIN erp_roles r ON r.id = a.role_id"
                    + " WHERE r.code = 'admin' AND a.user_id <> ?",
                Integer.class, user) == 0) {
      throw new AuthorizationRefusal(409, "Impossible de retirer le dernier administrateur de la société");
    }
    int n = jdbc.update("DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?", user, role);
    if (n == 0) throw new AuthorizationRefusal(404, "Affectation introuvable");
    return view();
  }

  // ─── Contrôles ───

  private boolean exists(String sql, Object... args) {
    return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, args));
  }

  private boolean isAdmin() {
    return Boolean.TRUE.equals(jdbc.queryForObject("SELECT is_tenant_admin()", Boolean.class));
  }

  private void requireAdmin() {
    if (!isAdmin()) throw new AuthorizationRefusal(403, "Rôle administrateur requis dans la société courante");
  }

  private void requireCustom(UUID role) {
    List<Boolean> system = jdbc.query("SELECT is_system FROM erp_roles WHERE id = ?", (rs, i) -> rs.getBoolean(1), role);
    if (system.isEmpty()) throw new AuthorizationRefusal(404, "Rôle introuvable");
    if (system.getFirst()) {
      throw new AuthorizationRefusal(409, "Un rôle système ne se modifie pas : créez un rôle sur mesure en le copiant");
    }
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }
}
