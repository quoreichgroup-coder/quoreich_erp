package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V64 (PC-3) — référentiels versionnés et règles de qualité en données : une société au PCG est
 * contrôlée contre le PCG (et non SYSCOHADA), le plan opérationnel porte référentiel et version, une
 * règle se désactive ou change de gravité par société, le format des codes est une règle désactivable.
 */
@SpringBootTest
class ReferentielsEtReglesQualiteIT {

  private static final String DATABASE = "qerp_it_referentiels_qualite";
  private static final String T = "33333333-6464-4444-8888-000000000064";
  private static final String ADMIN = "aaaaaaaa-6464-0000-0000-000000000064";
  private static final String LECTEUR = "aaaaaaaa-6464-0000-0000-000000000065";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société PCG V64') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + ADMIN + "'), ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + ADMIN + "', '" + T + "', 'Admin PCG'), ('" + LECTEUR + "', '" + T
        + "', 'Lecteur PCG') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", T, LECTEUR, "viewer", T);
    owner("SELECT public.apply_accounting_framework_to('" + T + "', 'PCG_FR', NULL)");
  }

  @Test
  @DisplayName("société au PCG : plan et rôles PCG, version portée par le plan, contrôle contre le PCG")
  void referentielPcg() throws SQLException {
    assertThat(texte("SELECT framework_code || ' ' || framework_version FROM charts WHERE tenant_id = '" + T + "' AND kind = 'operational'"))
        .isEqualTo("PCG_FR 2025");
    assertThat(texte("SELECT string_agg(t.role_code || ':' || g.code, ' ' ORDER BY t.role_code) FROM tenant_posting_accounts t JOIN gl_accounts g ON g.id = t.gl_account_id"
        + " WHERE t.tenant_id = '" + T + "' AND t.role_code IN ('AR_RECEIVABLE', 'BANK', 'SALES_REVENUE', 'VAT_OUTPUT')"))
        .isEqualTo("AR_RECEIVABLE:411 BANK:512 SALES_REVENUE:707 VAT_OUTPUT:44571");
    assertThat(asUser(ADMIN, "SELECT count(*)::text FROM chart_of_accounts_issues() WHERE code NOT IN ('706', '4112', 'C001')")).as("plan PCG livré sans anomalie").isEqualTo("0");

    asUser(ADMIN, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + T + "', '706', 'Ventes de marchandises export', 'revenue') RETURNING id::text");
    assertThat(asUser(ADMIN, "SELECT string_agg(severity || '|' || issue || '|' || COALESCE(suggested_code, '-'), ' ; ') FROM chart_of_accounts_issues() WHERE code = '706'"))
        .as("706 = prestations de services au PCG : intitulé contrôlé contre le PCG, suggestion 707")
        .isEqualTo("warning|Intitulé différent du compte PCG|707");
  }

  @Test
  @DisplayName("règles par société : désactivation, gravité, format des codes désactivable ; lecteur refusé")
  void reglesParSociete() throws SQLException {
    asUser(ADMIN, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + T + "', '4112', 'Clients', 'asset') RETURNING id::text");
    assertThat(asUser(ADMIN, "SELECT string_agg(severity || '|' || issue, ' ; ' ORDER BY issue) FROM chart_of_accounts_issues() WHERE code = '4112'"))
        .isEqualTo("warning|Doublon d'intitulé ; info|Sous-compte non rattaché");

    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO tenant_quality_rules (tenant_id, rule_code, enabled) VALUES ('" + T
        + "', 'DUPLICATE_LABEL', false) RETURNING rule_code"))
        .hasMessageContaining("row-level security");
    asUser(ADMIN, "INSERT INTO tenant_quality_rules (tenant_id, rule_code, enabled) VALUES ('" + T + "', 'DUPLICATE_LABEL', false) RETURNING rule_code");
    asUser(ADMIN, "INSERT INTO tenant_quality_rules (tenant_id, rule_code, enabled, severity) VALUES ('" + T + "', 'UNLINKED_SUBACCOUNT', true, 'error') RETURNING rule_code");
    assertThat(asUser(ADMIN, "SELECT string_agg(severity || '|' || issue, ' ; ') FROM chart_of_accounts_issues() WHERE code = '4112'"))
        .as("doublon désactivé, sous-compte relevé en erreur").isEqualTo("error|Sous-compte non rattaché");

    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + T + "', 'C001', 'Client Awa', 'asset') RETURNING id::text"))
        .hasMessageContaining("format du référentiel");
    asUser(ADMIN, "INSERT INTO tenant_quality_rules (tenant_id, rule_code, enabled) VALUES ('" + T + "', 'CODE_FORMAT', false) RETURNING rule_code");
    asUser(ADMIN, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + T + "', 'C001', 'Client Awa', 'asset') RETURNING id::text");
    assertThat(asUser(ADMIN, "SELECT string_agg(issue, ' ; ') FROM chart_of_accounts_issues() WHERE code = 'C001'"))
        .as("format désactivé : le code n'est plus refusé mais reste hors plan").isEqualTo("Code hors plan PCG");
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
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        String r = rs.next() ? rs.getString(1) : null;
        c.commit();
        return r;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        var rs = st.executeQuery(sql)) {
      return rs.next() ? rs.getString(1) : null;
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }
}
