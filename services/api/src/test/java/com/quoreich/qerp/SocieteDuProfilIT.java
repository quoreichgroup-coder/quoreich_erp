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
 * Sécurité (V24) : un utilisateur ne peut pas changer lui-même la société de son profil, ce qui
 * lui aurait ouvert les données d'une autre société. L'onboarding légitime continue de marcher.
 * Joué sous le rôle applicatif avec les claims du porteur, comme une requête réelle.
 */
@SpringBootTest
class SocieteDuProfilIT {

  private static final String DATABASE = "qerp_it_profil";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String NOUVEAU = "aaaaaaaa-0000-0000-0000-0000000000f1";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
  }

  @Test
  @DisplayName("changer la société de son propre profil est refusé ; Beta reste invisible")
  void pasDeChangementDeSociete() throws Exception {
    String alpha = PostgresFixture.ALPHA_USER;
    assertThatThrownBy(() -> asUser(alpha, "UPDATE profiles SET tenant_id = '" + B + "' WHERE id = auth.uid()"))
        .isInstanceOfSatisfying(SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("42501"))
        .hasMessageContaining("La société d'un profil ne se modifie pas");
    assertThat(rows("SELECT tenant_id::text FROM profiles WHERE id = '" + alpha + "'")).containsExactly(A);
    assertThat(asUser(alpha, "SELECT count(*)::text FROM customers WHERE tenant_id = '" + B + "'")).isEqualTo("0");

    // Le reste du profil reste modifiable par l'utilisateur.
    asUser(alpha, "UPDATE profiles SET full_name = 'Utilisateur Alpha (renommé)' WHERE id = auth.uid()");
    assertThat(rows("SELECT full_name FROM profiles WHERE id = '" + alpha + "'")).containsExactly("Utilisateur Alpha (renommé)");
  }

  @Test
  @DisplayName("créer son profil déjà rattaché à une société est refusé ; sans société, accepté ; l'onboarding rattache")
  void creationEtOnboarding() throws Exception {
    owner("DELETE FROM profiles WHERE id = '" + NOUVEAU + "';"
        + "INSERT INTO auth.users (id) VALUES ('" + NOUVEAU + "') ON CONFLICT DO NOTHING");
    assertThatThrownBy(() -> asUser(NOUVEAU, "INSERT INTO profiles (id, tenant_id, full_name) VALUES (auth.uid(), '" + B + "', 'Intrus')"))
        .hasMessageContaining("Un profil ne peut pas être rattaché à une société par l'utilisateur lui-même");
    asUser(NOUVEAU, "INSERT INTO profiles (id, full_name) VALUES (auth.uid(), 'Nouvel utilisateur')");

    String tenant = asUser(NOUVEAU, "SELECT create_tenant_for_user('Société du nouvel utilisateur')::text");
    assertThat(rows("SELECT tenant_id::text FROM profiles WHERE id = '" + NOUVEAU + "'")).containsExactly(tenant);
    assertThat(asUser(NOUVEAU, "SELECT has_role(auth.uid(), 'admin')::text")).isEqualTo("true");
    assertThat(asUser(NOUVEAU, "SELECT count(*)::text FROM customers WHERE tenant_id IN ('" + A + "', '" + B + "')")).isEqualTo("0");
  }

  @Test
  @DisplayName("un administrateur ne lit pas les rôles des utilisateurs d'une autre société (V27, matrice depuis V32)")
  void rolesDesAutresSocietesInvisibles() throws Exception {
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "admin", A, PostgresFixture.BETA_USER, "admin", B);
    assertThat(asUser(PostgresFixture.ALPHA_USER, "SELECT count(*)::text FROM user_role_assignments WHERE tenant_id = '" + B + "'"))
        .isEqualTo("0");
    assertThat(asUser(PostgresFixture.ALPHA_USER, "SELECT count(*)::text FROM user_role_assignments WHERE tenant_id = '" + A + "'"))
        .isEqualTo("1");
    // Journaux de rôles : ni lecture du journal risques d'une autre société, ni écriture au nom d'une autre.
    owner("INSERT INTO risk_role_audit (tenant_id, actor_user_id, target_user_id, role, action) VALUES ('" + B + "', '"
        + PostgresFixture.BETA_USER + "', '" + PostgresFixture.BETA_USER + "', 'risk_admin', 'grant')");
    assertThat(asUser(PostgresFixture.ALPHA_USER, "SELECT count(*)::text FROM risk_role_audit")).isEqualTo("0");
    assertThatThrownBy(() -> asUser(PostgresFixture.ALPHA_USER, "INSERT INTO budget_role_audit (tenant_id, actor_user_id,"
            + " target_user_id, role, action) VALUES ('" + B + "', auth.uid(), auth.uid(), 'budget_admin', 'assign')"))
        .hasMessageContaining("row-level security");
  }

  // ─── Outils ───

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement()) {
        String result = null;
        if (st.execute(sql)) {
          try (ResultSet rs = st.getResultSet()) {
            if (rs.next()) result = rs.getString(1);
          }
        }
        c.commit();
        return result;
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
