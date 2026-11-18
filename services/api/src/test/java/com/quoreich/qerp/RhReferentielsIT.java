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
 * V102 — fiche salarié : contrat, service et poste issus des référentiels de la société (code ou libellé
 * accepté, code enregistré, valeur inconnue refusée, sur la fiche comme dans un mouvement) ; statut borné aux
 * états du cycle de vie ; devise de la fiche = devise des règles de paie, refus explicite sans règles.
 */
@SpringBootTest
class RhReferentielsIT {

  private static final String DATABASE = "qerp_it_rh_referentiels";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  @Test
  @DisplayName("contrat, service et poste viennent des référentiels ; devise des règles de paie ; statut borné")
  void referentiels() throws SQLException {
    String fiche = "{\"first_name\":\"Awa\",\"last_name\":\"Traoré\",\"contract_type\":\"cdi\",\"department\":\"Comptabilité\"}";
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT save_hr_employee('" + fiche + "')::text"))
        .as("sans règles de paie, pas de devise implicite").hasMessageContaining("Devise de paie non configurée");
    owner("INSERT INTO hr_payroll_settings (tenant_id, currency_code, employer_contribution_pct) VALUES ('" + A + "', 'XOF', 0)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET currency_code = 'XOF'");

    assertThatThrownBy(() -> asUser(ADMIN, "SELECT save_hr_employee('" + fiche + "')::text"))
        .hasMessageContaining("Contrat « cdi » absent du référentiel");
    asUser(ADMIN, "SELECT save_hr_movement_reference('contract_type', 'cdi', 'Contrat à durée indéterminée', true, 1)::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT save_hr_employee('" + fiche + "')::text"))
        .hasMessageContaining("Service « Comptabilité » absent du référentiel");
    asUser(ADMIN, "SELECT save_hr_movement_reference('department', 'compta', 'Comptabilité', true, 1)::text");
    String id = asUser(ADMIN, "SELECT save_hr_employee('" + fiche + "')::text");
    assertThat(texte("SELECT contract_type || ' ' || department || ' ' || currency || ' ' || status FROM employees WHERE id = '" + id + "'"))
        .as("libellé accepté, code enregistré ; devise des règles de paie ; statut initial paramétré")
        .isEqualTo("cdi compta XOF active");

    assertThatThrownBy(() -> owner("UPDATE employees SET status = 'parti' WHERE id = '" + id + "'")).hasStackTraceContaining("employees_status_check");
    owner("INSERT INTO hr_movement_references (tenant_id, kind, code, label) VALUES ('" + A + "', 'movement_type', 'mutation', 'Mutation'),"
        + " ('" + A + "', 'reason_code', 'reorg', 'Réorganisation') ON CONFLICT (tenant_id, kind, code) DO NOTHING");
    assertThatThrownBy(() -> owner("INSERT INTO employee_movements (tenant_id, employee_id, movement_type, effective_date, reason_code, reason, after_values, created_by)"
        + " SELECT '" + A + "', '" + id + "', 'mutation', CURRENT_DATE, 'reorg', 'Réorganisation du service', '{\"department\":\"Logistique\"}', '" + ADMIN + "'"))
        .as("un mouvement ne peut pas proposer une valeur hors référentiel").hasStackTraceContaining("Service « Logistique » absent");
  }

  @Test
  @DisplayName("V103 : l'auteur du cycle est posé par la base, et il ne peut pas approuver sa propre paie")
  void separationDesFonctionsPaie() throws SQLException {
    String autre = PostgresFixture.BETA_USER;
    String run = asUser(ADMIN, "INSERT INTO payroll_runs (tenant_id, period, pay_date, status, created_by) VALUES ('" + A
        + "', '2061-01', '2061-01-31', 'draft', '" + autre + "') RETURNING id::text");
    assertThat(texte("SELECT created_by::text FROM payroll_runs WHERE id = '" + run + "'")).as("auteur non falsifiable").isEqualTo(ADMIN);
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT approve_payroll_run('" + run + "')::text")).hasMessageContaining("préparateur ne peut pas approuver");
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
