package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V148 — audit RH &amp; Paie : le salaire de base est payé au prorata des jours de présence de la période
 * (embauche, sortie, suspension, changement de salaire en cours de mois), selon la méthode de la société ;
 * un net négatif bloque le précontrôle ; une rubrique existante n'est jamais remplacée sans son identifiant.
 * Taux sociaux et impôt à 0 % : le brut est le net, seul le prorata est observé.
 */
@SpringBootTest
class PaieProrataPresenceIT {

  private static final String DATABASE = "qerp_it_paie_prorata";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String APPROVER = "aaaaaaaa-0000-0000-0000-000000000003";
  private static final String REFERENTIELS = "INSERT INTO hr_movement_references (tenant_id, kind, code, label) VALUES"
      + " ('" + A + "', 'contract_type', 'cdi', 'CDI'), ('" + A + "', 'department', 'finance', 'Finance'),"
      + " ('" + A + "', 'movement_type', 'departure', 'Départ'), ('" + A + "', 'movement_type', 'salary_change', 'Changement de salaire'),"
      + " ('" + A + "', 'reason_code', 'termination', 'Fin de contrat'), ('" + A + "', 'reason_code', 'promotion', 'Promotion')"
      + " ON CONFLICT (tenant_id, kind, code) DO NOTHING;";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    owner("INSERT INTO auth.users (id) VALUES ('" + APPROVER + "') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + APPROVER + "', '" + A + "', 'Approbateur paie') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, APPROVER, "hr_approver", A);
    owner(REFERENTIELS + "UPDATE employees SET status = 'inactive' WHERE tenant_id = '" + A + "';"
        + "DELETE FROM hr_payroll_settings WHERE tenant_id = '" + A + "';"
        + "INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct,"
        + " income_tax_bands, rules_effective_from, rules_reference) VALUES ('" + A + "', 'BF', 'XOF', 0, 0,"
        + " '[{\"up_to\":null,\"rate_pct\":0}]', '2030-01-01', 'Référence de test (taux nuls)')");
  }

  @Test
  @DisplayName("jours calendaires : embauche le 16, sortie le 11, augmentation le 16, embauche après la période ; net négatif bloquant")
  void prorataJoursCalendaires() throws SQLException {
    asUser("SELECT confirm_payroll_rules()::text");
    String embauche = salarie("2034-03-16", 310000);
    String futur = salarie("2034-04-02", 310000);
    String sortie = salarie("2030-01-01", 310000);
    String augmente = salarie("2030-01-01", 310000);
    String endette = salarie("2030-01-01", 100000);
    mouvement(sortie, "departure", "termination", "2034-03-11", "{\"status\":\"terminated\"}");
    mouvement(augmente, "salary_change", "promotion", "2034-03-16", "{\"base_salary\":620000}");
    String suffix = UUID.randomUUID().toString().substring(0, 6);
    owner("INSERT INTO hr_payroll_components (tenant_id, code, label, kind, calculation_method, amount, effective_from, prorated) VALUES"
        + " ('" + A + "', 'transp-" + suffix + "', 'Transport', 'earning', 'fixed', 31000, '2030-01-01', true),"
        + " ('" + A + "', 'prime-" + suffix + "', 'Prime', 'earning', 'fixed', 5000, '2030-01-01', false),"
        + " ('" + A + "', 'avance-" + suffix + "', 'Avance', 'deduction', 'fixed', 400000, '2030-01-01', false);"
        + affecter(embauche, "transp-" + suffix) + affecter(embauche, "prime-" + suffix) + affecter(endette, "avance-" + suffix));
    String run = cycle("2034-03");

    assertThat(asUser("SELECT generate_payroll_lines('" + run + "')::text")).isEqualTo("4");
    assertThat(texte("SELECT count(*) FROM payroll_lines WHERE run_id = '" + run + "' AND employee_id = '" + futur + "'"))
        .as("embauché après la période : aucune ligne").isEqualTo("0");
    assertThat(brut(run, embauche)).as("16/31 de 310 000 + transport 16/31 de 31 000 + prime fixe 5 000")
        .isEqualTo("181000.00");
    assertThat(brut(run, sortie)).as("présent du 1er au 10 : 10/31").isEqualTo("100000.00");
    assertThat(brut(run, augmente)).as("15/31 de 310 000 + 16/31 de 620 000").isEqualTo("470000.00");
    assertThat(texte("SELECT (definition_snapshot->'presence'->>'days_present') || '/' || (definition_snapshot->'presence'->>'days_total')"
        + " || '|' || (definition_snapshot->'presence'->>'method') FROM payroll_component_lines WHERE run_id = '" + run
        + "' AND employee_id = '" + embauche + "' AND code_snapshot = 'BASE_SALARY'"))
        .as("le détail de présence est photographié sur la ligne de salaire de base").isEqualTo("16/31|calendar_days");
    assertThat(texte("SELECT payroll_rules_snapshot->>'proration_method' FROM payroll_runs WHERE id = '" + run + "'"))
        .isEqualTo("calendar_days");

    assertThat(asUser(APPROVER, "SELECT (r->>'passed') || '|' || (r->'findings')::text FROM (SELECT precheck_payroll_run('" + run + "') r) x"))
        .as("un net négatif bloque l'approbation").startsWith("false|").contains("Net a payer negatif pour 1 salarie(s)");
    assertThatThrownBy(() -> asUser(APPROVER, "SELECT approve_payroll_run('" + run + "')"))
        .hasMessageContaining("sans anomalie est requis avant approbation");
  }

  @Test
  @DisplayName("mois de 30 jours : la méthode est un paramètre de la société et sa modification retire la confirmation")
  void prorataMoisDeTrenteJours() throws SQLException {
    owner("UPDATE hr_payroll_settings SET proration_method = 'thirty_days' WHERE tenant_id = '" + A + "'");
    asUser("SELECT confirm_payroll_rules()::text");
    String fevrier = salarie("2034-02-16", 300000);
    String run = cycle("2034-02");
    assertThat(asUser("SELECT generate_payroll_lines('" + run + "')::text")).isEqualTo("1");
    assertThat(brut(run, fevrier)).as("février sur 30 jours : du 16 au 30 = 15/30").isEqualTo("150000.00");

    owner("UPDATE hr_payroll_settings SET proration_method = 'calendar_days' WHERE tenant_id = '" + A + "'");
    assertThat(texte("SELECT rules_validated_at IS NULL FROM hr_payroll_settings WHERE tenant_id = '" + A + "'"))
        .as("changer la méthode retire la confirmation des barèmes").isEqualTo("t");
    assertThatThrownBy(() -> owner("UPDATE hr_payroll_settings SET proration_method = 'working_days' WHERE tenant_id = '" + A + "'"))
        .hasMessageContaining("hr_payroll_settings_proration_method_check");
  }

  @Test
  @DisplayName("une rubrique existante n'est remplacée que par son identifiant")
  void rubriqueNonEcrasee() throws SQLException {
    String code = "rub-" + UUID.randomUUID().toString().substring(0, 6);
    String json = "{\"code\":\"" + code + "\",\"label\":\"Prime\",\"kind\":\"earning\",\"calculation_method\":\"fixed\",\"amount\":1000,\"effective_from\":\"2030-01-01\"}";
    String id = asUser("SELECT save_hr_payroll_component('" + json + "'::jsonb)::text");
    assertThatThrownBy(() -> asUser("SELECT save_hr_payroll_component('" + json.replace("1000", "9999") + "'::jsonb)::text"))
        .hasMessageContaining("existe deja");
    asUser("SELECT save_hr_payroll_component('" + json.replace("{\"code\"", "{\"id\":\"" + id + "\",\"prorated\":true,\"code\"")
        .replace("1000", "2000") + "'::jsonb)::text");
    assertThat(texte("SELECT amount::int || '|' || prorated FROM hr_payroll_components WHERE id = '" + id + "'")).isEqualTo("2000|true");
  }

  // ─── Outils ───

  private static String salarie(String embauche, int salaire) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, department, hire_date, base_salary, currency, status)"
        + " VALUES ('" + id + "', '" + A + "', 'P-" + id.substring(0, 8) + "', 'Awa', 'Prorata', 'CDI', 'Finance', '" + embauche + "', "
        + salaire + ", 'XOF', 'active')");
    return id;
  }

  private static void mouvement(String salarie, String type, String motif, String date, String apres) {
    owner("INSERT INTO employee_movements (tenant_id, employee_id, movement_type, effective_date, reason_code, reason, before_values,"
        + " after_values, status, created_by, decided_by, decided_at) VALUES ('" + A + "', '" + salarie + "', '" + type + "', '" + date
        + "', '" + motif + "', 'Mouvement de recette', '{}', '" + apres + "', 'approved', '" + ADMIN + "', '" + APPROVER + "', now())");
  }

  private static String affecter(String salarie, String code) {
    return "INSERT INTO hr_employee_payroll_components (tenant_id, employee_id, component_id, effective_from)"
        + " SELECT '" + A + "', '" + salarie + "', id, '2030-01-01' FROM hr_payroll_components WHERE tenant_id = '" + A + "' AND code = '" + code + "';";
  }

  private static String cycle(String periode) {
    String run = UUID.randomUUID().toString();
    owner("INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '"
        + periode + "', '" + periode + "-28', 'draft', '" + ADMIN + "')");
    return run;
  }

  private static String brut(String run, String salarie) {
    return texte("SELECT gross::text FROM payroll_lines WHERE run_id = '" + run + "' AND employee_id = '" + salarie + "'");
  }

  private static String asUser(String sql) throws SQLException {
    return asUser(ADMIN, sql);
  }

  private static String asUser(String userId, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + userId + "\",\"role\":\"authenticated\"}");
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
