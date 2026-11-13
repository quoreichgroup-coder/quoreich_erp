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
 * Paramétrage comptable (V18) : référentiel, rôles comptables, comptes par société.
 *
 * <p>Les opérations sont jouées sous le rôle applicatif avec les claims du porteur, donc sous la
 * RLS réelle ; les constats sont faits en propriétaire.
 */
@SpringBootTest
class ParametrageComptableIT {

  private static final String DATABASE = "qerp_it_parametrage";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ALPHA_ADMIN = PostgresFixture.ALPHA_USER;
  private static final String ALPHA_COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";
  /** Profil dans Alpha, mais administrateur de Beta. */
  private static final String ALPHA_ADMIN_AILLEURS = "aaaaaaaa-0000-0000-0000-000000000004";
  private static final String BETA_ADMIN = PostgresFixture.BETA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('" + ALPHA_COMPTABLE + "'), ('" + ALPHA_ADMIN_AILLEURS
            + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + ALPHA_COMPTABLE + "', '"
            + A + "', 'Comptable Alpha'), ('" + ALPHA_ADMIN_AILLEURS + "', '" + A
            + "', 'Admin ailleurs') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ALPHA_ADMIN, "admin", A, ALPHA_COMPTABLE, "accountant", A,
        ALPHA_ADMIN_AILLEURS, "admin", B, BETA_ADMIN, "admin", B);
  }

  @Test
  @DisplayName("l'administrateur applique SYSCOHADA : comptes et rôles créés ; rejouer ne change rien")
  void appliquerLeReferentielEstIdempotent() throws Exception {
    assertThat(asUser(BETA_ADMIN, "SELECT apply_accounting_framework('SYSCOHADA_REVISE')::text"))
        .contains("\"comptes_crees\": 8")
        .contains("\"roles_parametres\": 7");

    assertThat(rows("SELECT p.role_code || ' ' || g.code FROM tenant_posting_accounts p JOIN"
                + " gl_accounts g ON g.id = p.gl_account_id WHERE p.tenant_id = ?::uuid ORDER BY 1", B))
        .containsExactly(
            "AP_PAYABLE 401", "AR_RECEIVABLE 411", "BANK 521", "PURCHASES 601",
            "SALES_REVENUE 701", "VAT_INPUT 4452", "VAT_OUTPUT 4431");
    assertThat(rows("SELECT framework_code FROM tenant_accounting_settings WHERE tenant_id = ?::uuid", B))
        .containsExactly("SYSCOHADA_REVISE");

    assertThat(asUser(BETA_ADMIN, "SELECT apply_accounting_framework('SYSCOHADA_REVISE')::text"))
        .contains("\"comptes_crees\": 0")
        .contains("\"roles_parametres\": 0");
  }

  @Test
  @DisplayName("ni un comptable, ni un administrateur d'une autre société ne paramètrent")
  void seulLAdministrateurDeLaSocieteParametre() throws Exception {
    PostgresFixture.applySyscohada(DATABASE, A);

    for (String user : new String[] {ALPHA_COMPTABLE, ALPHA_ADMIN_AILLEURS}) {
      assertThatThrownBy(
              () -> asUser(user, "SELECT apply_accounting_framework('SYSCOHADA_REVISE')::text"))
          .isInstanceOf(SQLException.class)
          .hasMessageContaining("Rôle administrateur requis");
      // La RLS filtre la ligne : la modification ne touche rien, sans erreur.
      assertThat(
              update(user, "UPDATE tenant_posting_accounts SET gl_account_id = gl_account_id"
                  + " WHERE role_code = 'BANK'"))
          .isZero();
      // La lecture reste permise dans la société.
      assertThat(asUser(user, "SELECT count(*)::text FROM tenant_posting_accounts")).isEqualTo("7");
    }
    assertThat(update(ALPHA_ADMIN, "UPDATE tenant_posting_accounts SET updated_at = now()"
            + " WHERE role_code = 'BANK'"))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("une société ne peut désigner que ses propres comptes et ne voit pas ceux des autres")
  void isolationDuParametrage() throws Exception {
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B
            + "', '999', 'Compte Beta', 'asset') ON CONFLICT (tenant_id, code) DO NOTHING");

    // Même en propriétaire, la clé composite refuse un compte d'une autre société.
    assertThatThrownBy(
            () ->
                PostgresFixture.execute(
                    PostgresFixture.urlOf(DATABASE),
                    "UPDATE tenant_posting_accounts SET gl_account_id = (SELECT id FROM gl_accounts"
                        + " WHERE tenant_id = '" + B + "' AND code = '999') WHERE tenant_id = '" + A
                        + "' AND role_code = 'BANK'"))
        .hasMessageContaining("tenant_posting_accounts_gl_account_id_tenant_id_fkey");

    assertThat(asUser(BETA_ADMIN, "SELECT count(*)::text FROM tenant_posting_accounts"
            + " WHERE tenant_id = '" + A + "'"))
        .isEqualTo("0");
  }

  @Test
  @DisplayName("un compte désactivé vaut un compte absent : la facture est refusée (QG001)")
  void compteDesactiveBloqueLaComptabilisation() throws Exception {
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "UPDATE gl_accounts SET is_active = false WHERE tenant_id = '" + A + "' AND code = '701'");
    try {
      assertThatThrownBy(
              () ->
                  asUser(
                      ALPHA_ADMIN,
                      "INSERT INTO ar_invoices (invoice_number, customer_id, invoice_date, due_date,"
                          + " subtotal, tax_amount, total, tenant_id, created_by, status, amount_paid)"
                          + " VALUES ('PARAM-INACTIF', 'c0000001-0000-0000-0000-000000000000',"
                          + " '2030-02-01', '2030-03-01', 100, 0, 100, get_user_tenant_id(auth.uid()),"
                          + " auth.uid(), 'sent', 0)"))
          .isInstanceOfSatisfying(
              SQLException.class, e -> assertThat(e.getSQLState()).isEqualTo("QG001"))
          .hasMessageContaining("Ventes (SALES_REVENUE)");
      assertThat(rows("SELECT count(*) FROM ar_invoices WHERE invoice_number = 'PARAM-INACTIF'"))
          .containsExactly("0");
    } finally {
      PostgresFixture.execute(
          PostgresFixture.urlOf(DATABASE),
          "UPDATE gl_accounts SET is_active = true WHERE tenant_id = '" + A + "' AND code = '701'");
    }
  }

  @Test
  @DisplayName("un référentiel inconnu est refusé ; les référentiels sont en lecture seule")
  void referentielInconnuEtLectureSeule() throws Exception {
    assertThatThrownBy(() -> asUser(ALPHA_ADMIN, "SELECT apply_accounting_framework('PCG_FR')::text"))
        .hasMessageContaining("Référentiel comptable inconnu");
    assertThat(asUser(ALPHA_ADMIN, "SELECT count(*)::text FROM posting_roles")).isEqualTo("7");
    assertThatThrownBy(
            () -> asUser(ALPHA_ADMIN, "DELETE FROM accounting_frameworks RETURNING code"))
        .hasMessageContaining("permission denied");
  }

  // ─── Outils ───

  private static Connection apiConnection(String user) throws SQLException {
    Connection c =
        DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD);
    c.setAutoCommit(false);
    try (PreparedStatement claims =
        c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
      claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
      claims.execute();
    }
    return c;
  }

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = apiConnection(user);
        Statement st = c.createStatement()) {
      try {
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

  private static int update(String user, String sql) throws SQLException {
    try (Connection c = apiConnection(user);
        Statement st = c.createStatement()) {
      int n = st.executeUpdate(sql);
      c.rollback();
      return n;
    }
  }

  private static List<String> rows(String sql, Object... params) {
    List<String> out = new ArrayList<>();
    try (Connection c =
            DriverManager.getConnection(
                PostgresFixture.urlOf(DATABASE),
                PostgresFixture.ADMIN_USER,
                PostgresFixture.ADMIN_PASSWORD);
        PreparedStatement st = c.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) st.setObject(i + 1, params[i]);
      try (ResultSet rs = st.executeQuery()) {
        while (rs.next()) out.add(rs.getString(1));
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }
}
