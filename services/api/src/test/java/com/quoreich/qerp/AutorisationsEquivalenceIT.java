package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Rôles centralisés (V23) : aucun utilisateur ne gagne ni ne perd de droit.
 *
 * <p>Un utilisateur par rôle de l'enum (50), affecté par l'ancien chemin d'écriture (user_roles,
 * recopié par trg_mirror_user_roles). Pour chaque rôle et chaque action du catalogue, l'ancienne
 * fonction (témoin legacy_*, recopie automatique de V8) et la nouvelle doivent répondre pareil.
 * Les deux seuls écarts admis sont nommés et vérifiés : un rôle ne vaut que dans sa société, et
 * une action inconnue du catalogue est refusée même à admin.
 */
@SpringBootTest
class AutorisationsEquivalenceIT {

  private static final String DATABASE = "qerp_it_autorisations";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  /** Un utilisateur par valeur de l'enum : uuid dérivé du nom du rôle, profil et rôle dans Alpha. */
  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("CREATE TEMP TABLE IF NOT EXISTS _x (x int);"
        + "INSERT INTO auth.users (id) SELECT md5('role:' || e::text)::uuid FROM unnest(enum_range(NULL::app_role)) e"
        + " ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) SELECT md5('role:' || e::text)::uuid, '" + A + "', 'Rôle ' || e::text"
        + " FROM unnest(enum_range(NULL::app_role)) e ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT md5('role:' || e::text)::uuid, e, '" + A + "'"
        + " FROM unnest(enum_range(NULL::app_role)) e ON CONFLICT DO NOTHING");
  }

  /** Écarts entre ancienne et nouvelle réponse, pour chaque rôle × action (catalogue + une action inconnue). */
  private static final String ECARTS =
      "WITH u AS (SELECT e::text AS role, md5('role:' || e::text)::uuid AS id FROM unnest(enum_range(NULL::app_role)) e),"
          + " a AS (SELECT module, action FROM erp_permission_catalog"
          + "       UNION ALL SELECT m, 'action_inexistante' FROM unnest(ARRAY['crm','hr','inventory','procurement','sales','treasury']) m),"
          + " r AS (SELECT u.role, a.module || '.' || a.action AS droit,"
          + "   CASE a.module WHEN 'crm' THEN legacy_has_crm_perm(u.id, a.action) WHEN 'hr' THEN legacy_has_hr_perm(u.id, a.action)"
          + "     WHEN 'inventory' THEN legacy_has_inventory_perm(u.id, a.action) WHEN 'procurement' THEN legacy_has_procurement_perm(u.id, a.action, NULL)"
          + "     WHEN 'sales' THEN legacy_has_sales_perm(u.id, a.action) ELSE legacy_has_treasury_perm(u.id, a.action) END AS avant,"
          + "   CASE a.module WHEN 'crm' THEN has_crm_perm(u.id, a.action) WHEN 'hr' THEN has_hr_perm(u.id, a.action)"
          + "     WHEN 'inventory' THEN has_inventory_perm(u.id, a.action) WHEN 'procurement' THEN has_procurement_perm(u.id, a.action, NULL)"
          + "     WHEN 'sales' THEN has_sales_perm(u.id, a.action) ELSE has_treasury_perm(u.id, a.action) END AS apres"
          + "   FROM u CROSS JOIN a)"
          + " SELECT role || ' ' || droit || ' ' || avant || '→' || apres FROM r WHERE avant IS DISTINCT FROM apres ORDER BY 1";

  @Test
  @DisplayName("50 rôles × toutes les actions : mêmes réponses, sauf l'action inconnue désormais refusée aux administrateurs")
  void memesDroits() {
    long combinaisons = PostgresFixture.countAsAdmin(DATABASE,
        "SELECT (SELECT count(*) FROM unnest(enum_range(NULL::app_role))) * ((SELECT count(*) FROM erp_permission_catalog) + 6)");
    assertThat(combinaisons).isEqualTo(50 * (43 + 6));

    // Seul écart : une action absente du catalogue, que l'ancien code accordait à admin (et aux
    // administrateurs de module) sans la connaître. Toutes les actions réellement appelées par
    // les politiques et les fonctions sont au catalogue.
    assertThat(rows(ECARTS)).containsExactlyInAnyOrder(
        "admin crm.action_inexistante true→false",
        "admin hr.action_inexistante true→false",
        "admin inventory.action_inexistante true→false",
        "admin procurement.action_inexistante true→false",
        "admin sales.action_inexistante true→false",
        "admin treasury.action_inexistante true→false",
        "cash_admin treasury.action_inexistante true→false",
        "crm_admin crm.action_inexistante true→false",
        "hr_admin hr.action_inexistante true→false");
  }

  @Test
  @DisplayName("has_role : chaque rôle reconnu exactement comme avant, pour chacun des 50 × 50 couples")
  void memesRoles() {
    assertThat(rows(
            "WITH u AS (SELECT e AS role, md5('role:' || e::text)::uuid AS id FROM unnest(enum_range(NULL::app_role)) e)"
                + " SELECT u.role || ' ' || q FROM u CROSS JOIN unnest(enum_range(NULL::app_role)) q"
                + " WHERE legacy_has_role(u.id, q) IS DISTINCT FROM has_role(u.id, q)"))
        .isEmpty();
    assertThat(PostgresFixture.countAsAdmin(DATABASE,
            "SELECT count(*) FROM unnest(enum_range(NULL::app_role)) e WHERE has_role(md5('role:' || e::text)::uuid, e)"))
        .isEqualTo(50);
  }

  @Test
  @DisplayName("resserrement voulu : un rôle détenu dans une autre société ne donne rien dans la sienne")
  void roleLimiteASaSociete() {
    String u = "aaaaaaaa-0000-0000-0000-0000000000e1";
    owner("INSERT INTO auth.users (id) VALUES ('" + u + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + u + "', '" + A + "', 'Admin ailleurs') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO user_roles (user_id, role, tenant_id) VALUES ('" + u + "', 'admin', '" + B + "') ON CONFLICT DO NOTHING");
    assertThat(rows("SELECT legacy_has_role('" + u + "', 'admin') || ' ' || has_role('" + u + "', 'admin')"
            + " || ' ' || has_treasury_perm('" + u + "', 'close_period')"))
        .containsExactly("true false false");
  }

  @Test
  @DisplayName("transition : retirer ou rendre un rôle par user_roles est aussitôt reflété")
  void recopieDesEcrituresHistoriques() {
    String u = "md5('role:treasury_manager')::uuid";
    owner("DELETE FROM user_roles WHERE user_id = " + u + " AND role = 'treasury_manager'");
    assertThat(rows("SELECT has_role(" + u + ", 'treasury_manager') || ' ' || has_treasury_perm(" + u + ", 'close_period')"))
        .containsExactly("false false");
    owner("INSERT INTO user_roles (user_id, role, tenant_id) VALUES (" + u + ", 'treasury_manager', '" + A + "')");
    assertThat(rows("SELECT has_role(" + u + ", 'treasury_manager') || ' ' || has_treasury_perm(" + u + ", 'close_period')"))
        .containsExactly("true true");
  }

  @Test
  @DisplayName("rôle sur mesure : sans effet tant qu'il est « à revoir », effectif ensuite")
  void roleSurMesure() {
    String u = "aaaaaaaa-0000-0000-0000-0000000000e2";
    String role = "f0000000-0000-0000-0000-0000000000e2";
    owner("INSERT INTO auth.users (id) VALUES ('" + u + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + u + "', '" + A + "', 'Caissier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO erp_roles (id, tenant_id, name, is_system, needs_review) VALUES ('" + role + "', '" + A
        + "', 'Caissier sur mesure', false, false) ON CONFLICT DO NOTHING;"
        + "INSERT INTO erp_role_permissions (role_id, permission_code) VALUES ('" + role + "', 'treasury.match') ON CONFLICT DO NOTHING;"
        + "INSERT INTO user_role_assignments (user_id, role_id, tenant_id) VALUES ('" + u + "', '" + role + "', '" + A
        + "') ON CONFLICT DO NOTHING;"
        // Cas réel : un rôle de l'ancienne matrice, déjà affecté, repris « à revoir » par V23.
        + "UPDATE erp_roles SET needs_review = true WHERE id = '" + role + "'");
    assertThat(rows("SELECT has_treasury_perm('" + u + "', 'match')::text")).containsExactly("false");
    owner("UPDATE erp_roles SET needs_review = false WHERE id = '" + role + "'");
    assertThat(rows("SELECT has_treasury_perm('" + u + "', 'match') || ' ' || has_treasury_perm('" + u + "', 'close_period')"))
        .containsExactly("true false");
  }

  @Test
  @DisplayName("gardes : rôles système intouchables, rôles modifiables par le seul administrateur, société seedée à la création")
  void gardes() throws Exception {
    String admin = "md5('role:admin')";
    String comptable = "md5('role:accountant')";
    assertThatThrownBy(() -> asUser(admin, "UPDATE erp_roles SET code = 'viewer' WHERE code = 'admin'"))
        .hasMessageContaining("Un rôle système ne se modifie pas");
    assertThatThrownBy(() -> asUser(admin, "INSERT INTO erp_role_permissions (role_id, permission_code)"
            + " SELECT id, 'hr.view_payroll' FROM erp_roles WHERE code = 'viewer'"))
        .hasMessageContaining("Les droits d'un rôle système ne se modifient pas");
    assertThatThrownBy(() -> asUser(comptable, "INSERT INTO erp_roles (tenant_id, name) VALUES"
            + " (get_user_tenant_id(auth.uid()), 'Rôle pirate')"))
        .hasMessageContaining("row-level security");
    asUser(admin, "INSERT INTO erp_roles (tenant_id, name) VALUES (get_user_tenant_id(auth.uid()), 'Rôle de l''admin')");

    owner("INSERT INTO tenants (id, name, currency, fiscal_year_start, status) VALUES"
        + " ('33333333-3333-3333-3333-333333333333', 'Société Gamma', 'XOF', 1, 'active') ON CONFLICT DO NOTHING");
    assertThat(rows("SELECT count(*) || ' ' || count(*) FILTER (WHERE code = 'admin') FROM erp_roles"
            + " WHERE tenant_id = '33333333-3333-3333-3333-333333333333'"))
        .containsExactly("50 1");
  }

  @Test
  @DisplayName("règles de la base (V26), quel que soit le chemin : dernier admin, rôle à revoir, rôle affecté")
  void reglesDeLaMatrice() {
    String role = "f0000000-0000-0000-0000-0000000000e3";
    owner("INSERT INTO erp_roles (id, tenant_id, name, needs_review) VALUES ('" + role + "', '" + A
        + "', 'Rôle repris', true) ON CONFLICT DO NOTHING");
    assertThatThrownBy(() -> owner("INSERT INTO user_role_assignments (user_id, role_id, tenant_id)"
            + " VALUES (md5('role:viewer')::uuid, '" + role + "', '" + A + "')"))
        .hasMessageContaining("Rôle à revoir");

    // md5('role:admin') est le seul administrateur d'Alpha : ni par la matrice, ni par user_roles.
    assertThatThrownBy(() -> owner("DELETE FROM user_role_assignments a USING erp_roles r WHERE r.id = a.role_id"
            + " AND r.code = 'admin' AND a.user_id = md5('role:admin')::uuid"))
        .hasMessageContaining("Impossible de retirer le dernier administrateur");
    assertThatThrownBy(() -> owner("DELETE FROM user_roles WHERE user_id = md5('role:admin')::uuid AND role = 'admin'"))
        .hasMessageContaining("Impossible de retirer le dernier administrateur");

    owner("UPDATE erp_roles SET needs_review = false WHERE id = '" + role + "';"
        + "INSERT INTO user_role_assignments (user_id, role_id, tenant_id) VALUES (md5('role:viewer')::uuid, '" + role + "', '" + A + "')");
    assertThatThrownBy(() -> owner("DELETE FROM erp_roles WHERE id = '" + role + "'"))
        .hasMessageContaining("Retirez d'abord ce rôle à ses 1 utilisateur(s)");
  }

  // ─── Outils ───

  /** userExpr : expression SQL donnant l'uuid (ex. md5('role:admin')). */
  private static void asUser(String userExpr, String sql) throws SQLException {
    String user = rows("SELECT (" + userExpr + ")::uuid::text").getFirst();
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement()) {
        st.execute(sql);
        c.commit();
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static List<String> rows(String sql) {
    List<String> out = new ArrayList<>();
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      while (rs.next()) out.add(rs.getString(1));
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }
}
