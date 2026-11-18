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
 * V63 (PC-2) — états par rubriques : compte de résultat SYSCOHADA (marge, EBE, résultat), bilan
 * équilibré, exception d'affectation par société, SIG cohérent ; paie par rôles (taux patronal
 * paramétré, plus de comptes codés en dur).
 */
@SpringBootTest
class EtatsParRubriquesIT {

  private static final String DATABASE = "qerp_it_etats_rubriques";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  /** V102 : contrat et service viennent des référentiels RH de la société. */
  private static final String REFERENTIELS_RH = "INSERT INTO hr_movement_references (tenant_id, kind, code, label) VALUES ('" + PostgresFixture.ALPHA_TENANT
      + "', 'contract_type', 'cdi', 'CDI'), ('" + PostgresFixture.ALPHA_TENANT + "', 'department', 'finance', 'Finance') ON CONFLICT (tenant_id, kind, code) DO NOTHING;";
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String APPROVER = "aaaaaaaa-0000-0000-0000-000000000003";

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
    owner("DELETE FROM hr_payroll_settings WHERE tenant_id = '" + A + "'");
    owner(REFERENTIELS_RH);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static void ecriture(String date, String[][] lignes) {
    String e = UUID.randomUUID().toString();
    StringBuilder sql = new StringBuilder("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('"
        + e + "', '" + A + "', 'JE-V63-" + e.substring(0, 6) + "', '" + date + "', 'Essai V63', 'manual', 'draft', '" + ADMIN + "');");
    for (String[] l : lignes) {
      sql.append("INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('").append(e).append("', '").append(compte(l[0]))
          .append("', ").append(l[1]).append(", ").append(l[2]).append(");");
    }
    sql.append("UPDATE journal_entries SET status = 'posted' WHERE id = '").append(e).append("'");
    owner(sql.toString());
  }

  private static String rubriques(String layout, String codes) throws SQLException {
    return asUser("SELECT string_agg(line_code || '=' || amount, ' ' ORDER BY line_order) FROM financial_statement('" + layout
        + "', '2031-01-01', '2031-12-31') WHERE line_code IN (" + codes + ")");
  }

  @Test
  @DisplayName("compte de résultat et bilan SYSCOHADA : marge, EBE, résultat ; bilan équilibré ; exception d'affectation")
  void etats() throws SQLException {
    ecriture("2031-03-10", new String[][] {{"411", "118000", "0"}, {"701", "0", "100000"}, {"4431", "0", "18000"}});
    ecriture("2031-03-12", new String[][] {{"601", "60000", "0"}, {"401", "0", "60000"}});
    ecriture("2031-03-31", new String[][] {{"661", "20000", "0"}, {"422", "0", "20000"}});
    ecriture("2031-04-02", new String[][] {{"521", "50000", "0"}, {"411", "0", "50000"}});

    assertThat(rubriques("CR_SYSCOHADA", "'TA','RA','XA','XB','RK','XD','XI'"))
        .isEqualTo("TA=100000.00 RA=60000.00 XA=40000.00 XB=100000.00 RK=20000.00 XD=20000.00 XI=20000.00");
    assertThat(rubriques("BILAN_SYSCOHADA", "'BI','BS','BZ','CJ','DJ','DK','DZ'"))
        .as("actif = passif ; résultat en CJ")
        .isEqualTo("BI=68000.00 BS=50000.00 BZ=118000.00 CJ=20000.00 DJ=60000.00 DK=38000.00 DZ=118000.00");

    owner("INSERT INTO tenant_report_line_accounts (tenant_id, layout_code, account_id, line_code) VALUES ('" + A + "', 'CR_SYSCOHADA', '"
        + compte("661") + "', 'RJ') ON CONFLICT (tenant_id, layout_code, account_id) DO UPDATE SET line_code = 'RJ'");
    assertThat(rubriques("CR_SYSCOHADA", "'RJ','RK','XC','XD'"))
        .as("exception de la société : 661 affecté aux autres charges").isEqualTo("RJ=20000.00 XC=20000.00 RK=0.00 XD=20000.00");
    owner("DELETE FROM tenant_report_line_accounts WHERE tenant_id = '" + A + "'");

    assertThat(asUser("SELECT ventes || ' ' || achats_consommes || ' ' || charges_personnel || ' ' || resultat_net FROM gl_sig_view WHERE tenant_id = '" + A
        + "' AND period = '2031-03'"))
        .as("SIG : personnel en 66 (et non 64)").isEqualTo("100000.00 60000.00 20000.00 20000.00");
  }

  @Test
  @DisplayName("paie par pays : calcul progressif, photographie du barème, écritures par rôles ; rôle manquant = QG001")
  void paieParRoles() throws SQLException {
    owner("INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference)"
        + " VALUES ('" + A + "', 'BF', 'XOF', 5, 10, '[{\"up_to\":null,\"rate_pct\":10}]', '2032-01-01', 'Référence officielle de test')");
    asUser("SELECT confirm_payroll_rules()::text");
    // La fixture contient des salariés réels de démonstration; ce scénario isole
    // volontairement un seul salarié pour vérifier les montants et l'écriture.
    owner("UPDATE employees SET status = 'inactive' WHERE tenant_id = '" + A + "'");
    String emp = UUID.randomUUID().toString(), run = UUID.randomUUID().toString(), run2 = UUID.randomUUID().toString();
    owner(REFERENTIELS_RH + "INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, department) VALUES ('" + emp + "', '" + A + "', 'M-" + emp.substring(0, 5)
        + "', 'Awa', 'Ouédraogo', 'CDI', 'Finance');"
        + "UPDATE employees SET base_salary = 200000 WHERE id = '" + emp + "';"
        + "INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2032-05', '2032-05-31', 'draft', '" + ADMIN + "'),"
        + "('" + run2 + "', '" + A + "', '2032-06', '2032-06-30', 'draft', '" + ADMIN + "')");
    assertThat(asUser("SELECT generate_payroll_lines('" + run + "')::text")).isEqualTo("1");
    assertThat(texte("SELECT gross || '|' || deductions || '|' || taxes || '|' || net || '|' || employer_charges FROM payroll_lines WHERE run_id = '" + run + "'"))
        .as("calcul par taux du pays : salarié 5 %, impôt 10 % après cotisation, employeur 10 %")
        .isEqualTo("200000.00|10000.00|19000.00|171000.00|20000.00");
    assertThat(texte("SELECT department_snapshot FROM payroll_lines WHERE run_id = '" + run + "'"))
        .as("le rapport historique conserve le département au calcul")
        .isEqualTo("Finance");
    assertThat(texte("SELECT array_to_string(reloptions, ',') FROM pg_class WHERE oid = 'public.payroll_register_view'::regclass"))
        .as("la vue de registre applique les droits des tables sous-jacentes à l'appelant")
        .isEqualTo("security_invoker=true");
    assertThat(asUser("SELECT department FROM payroll_register_view WHERE tenant_id = '" + A + "' AND period = '2032-05' AND matricule = 'M-" + emp.substring(0, 5) + "'"))
        .as("le rapport de paie restitue l'affectation figée et reste lisible sous RLS")
        .isEqualTo("Finance");
    asUser(APPROVER, "SELECT precheck_payroll_run('" + run + "')::text");
    asUser(APPROVER, "SELECT approve_payroll_run('" + run + "')");
    String je = asUser("SELECT post_payroll_run('" + run + "')::text");
    assertThat(asUser("SELECT string_agg(event_type, ',' ORDER BY event_type) FROM payroll_run_audit WHERE tenant_id = '" + A + "' AND run_id = '" + run + "'"))
        .as("création, génération, approbation et comptabilisation sont historisées sur le cycle")
        .isEqualTo("approved,created,lines_generated,posted,prechecked");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + je + "'"))
        .isEqualTo("422:0.00/171000.00 431:0.00/30000.00 447:0.00/19000.00 661:200000.00/0.00 664:20000.00/0.00");
    assertThat(texte("SELECT payroll_country_code || '|' || payroll_currency_code || '|' || (payroll_rules_snapshot->>'employee_contribution_pct') FROM payroll_runs WHERE id = '" + run + "'"))
        .isEqualTo("BF|XOF|5.000");

    assertThat(asUser("SELECT generate_payroll_lines('" + run2 + "')::text")).isEqualTo("1");
    asUser(APPROVER, "SELECT precheck_payroll_run('" + run2 + "')::text");
    asUser(APPROVER, "SELECT approve_payroll_run('" + run2 + "')");
    owner("DELETE FROM tenant_posting_accounts WHERE tenant_id = '" + A + "' AND role_code = 'PAYROLL_TAX'");
    assertThatThrownBy(() -> asUser("SELECT post_payroll_run('" + run2 + "')::text")).hasMessageContaining("Paramétrage comptable incomplet");
    assertThatThrownBy(() -> owner("DELETE FROM payroll_runs WHERE id = '" + run2 + "'"))
        .as("prechecked payroll runs retain their immutable audit history")
        .hasMessageContaining("payroll_run_prechecks_run_id_fkey");
    assertThat(texte("SELECT count(*) FROM payroll_run_prechecks WHERE tenant_id = '" + A + "' AND run_id = '" + run2 + "'"))
        .as("the immutable precheck remains linked to the payroll run")
        .isEqualTo("1");
  }

  @Test
  @DisplayName("calcul de paie refusé tant que le barème pays n'est pas configuré et confirmé")
  void paieSansBaremeConfirme() throws SQLException {
    String emp = UUID.randomUUID().toString(), run = UUID.randomUUID().toString();
    owner(REFERENTIELS_RH + "INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, base_salary) VALUES ('" + emp + "', '" + A + "', 'M-" + emp.substring(0, 5)
        + "', 'Awa', 'Ouédraogo', 'CDI', 200000);"
        + "INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2032-07', '2032-07-31', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> asUser("SELECT generate_payroll_lines('" + run + "')::text"))
        .hasMessageContaining("baremes de paie doivent etre configures et confirmes");
  }

  @Test
  @DisplayName("les barèmes doivent être applicables au mois travaillé, même si la paie est versée plus tard")
  void paieRefuseBaremePasEncoreEffectif() throws SQLException {
    owner("INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference)"
        + " VALUES ('" + A + "', 'BF', 'XOF', 5, 10, '[{\"up_to\":null,\"rate_pct\":10}]', '2032-09-01', 'Référence officielle de test')");
    asUser("SELECT confirm_payroll_rules()::text");
    String run = UUID.randomUUID().toString();
    owner("INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2032-08', '2032-09-05', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> asUser("SELECT generate_payroll_lines('" + run + "')::text"))
        .hasMessageContaining("baremes du pays ne sont pas applicables a la periode de paie");
  }

  @Test
  @DisplayName("une période de paie doit être au format AAAA-MM avec un mois réel")
  void paieRefusePeriodeInvalide() throws SQLException {
    owner("INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference)"
        + " VALUES ('" + A + "', 'BF', 'XOF', 5, 10, '[{\"up_to\":null,\"rate_pct\":10}]', '2032-01-01', 'Référence officielle de test')");
    asUser("SELECT confirm_payroll_rules()::text");
    String run = UUID.randomUUID().toString();
    owner("INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2032-13', '2032-12-31', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> asUser("SELECT generate_payroll_lines('" + run + "')::text"))
        .hasMessageContaining("format attendu AAAA-MM");
  }

  @Test
  @DisplayName("un barème progressif doit déclarer explicitement la dernière tranche sans plafond")
  void paieRefuseTrancheSansLimiteExplicite() throws SQLException {
    owner("INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference)"
        + " VALUES ('" + A + "', 'BF', 'XOF', 5, 10, '[{\"rate_pct\":10}]', '2032-01-01', 'Référence officielle de test')");
    assertThatThrownBy(() -> asUser("SELECT confirm_payroll_rules()::text"))
        .hasMessageContaining("Barèmes incomplets ou invalides");
  }

  @Test
  @DisplayName("le calcul unitaire d'un salaire est refusé sans droit de consultation ou de création de paie")
  void paieRefuseCalculParUtilisateurSansDroit() throws SQLException {
    String lecteur = UUID.randomUUID().toString(), emp = UUID.randomUUID().toString();
    owner("INSERT INTO auth.users (id) VALUES ('" + lecteur + "');"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + lecteur + "', '" + A + "', 'Lecteur sans paie');"
        + "INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, base_salary) VALUES ('" + emp + "', '" + A + "', 'M-" + emp.substring(0, 5)
        + "', 'Awa', 'Ouédraogo', 'CDI', 200000)");
    PostgresFixture.grantRoles(DATABASE, lecteur, "viewer", A);
    assertThatThrownBy(() -> asUser(lecteur, "SELECT gross FROM public.compute_payroll_line('" + emp + "')"))
        .hasMessageContaining("Permission refusée : consultation ou création de paie requise");
  }

  @Test
  @DisplayName("les comptes photographiés des rubriques déterminent les lignes du journal")
  void paiePosteParCompteDeRubrique() throws SQLException {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    String employee = UUID.randomUUID().toString();
    String run = UUID.randomUUID().toString();
    String secondRun = UUID.randomUUID().toString();
    owner("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + A + "', '6621', 'Primes et indemnités', 'expense'), ('"
        + A + "', '6622', 'Charges patronales diverses', 'expense'), ('" + A + "', '4251', 'Retenues diverses dues', 'liability') ON CONFLICT (tenant_id, code) DO NOTHING;"
        + "UPDATE employees SET status = 'inactive' WHERE tenant_id = '" + A + "';"
        + "INSERT INTO hr_payroll_settings (tenant_id, country_code, currency_code, employee_contribution_pct, employer_contribution_pct, income_tax_bands, rules_effective_from, rules_reference)"
        + " VALUES ('" + A + "', 'BF', 'XOF', 5, 10, '[{\"up_to\":null,\"rate_pct\":10}]', '2032-01-01', 'Référence de test')"
        + " ON CONFLICT (tenant_id) DO UPDATE SET employee_contribution_pct = EXCLUDED.employee_contribution_pct, employer_contribution_pct = EXCLUDED.employer_contribution_pct, income_tax_bands = EXCLUDED.income_tax_bands, rules_effective_from = EXCLUDED.rules_effective_from, rules_reference = EXCLUDED.rules_reference, rules_validated_at = NULL, rules_validated_by = NULL;"
        + "INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, base_salary, currency, status) VALUES ('" + employee + "', '" + A + "', 'M-" + suffix + "', 'Awa', 'Ouédraogo', 'CDI', 200000, 'XOF', 'active');"
        + "INSERT INTO hr_payroll_components (tenant_id, code, label, kind, calculation_method, amount, effective_from, gl_account_code) VALUES"
        + " ('" + A + "', 'bonus-" + suffix + "', 'Prime', 'earning', 'fixed', 10000, '2032-01-01', '6621'),"
        + " ('" + A + "', 'charge-" + suffix + "', 'Avantage patronal', 'employer_charge', 'fixed', 5000, '2032-01-01', '6622'),"
        + " ('" + A + "', 'advance-" + suffix + "', 'Retenue avance', 'deduction', 'fixed', 5000, '2032-01-01', '4251');"
        + "INSERT INTO hr_employee_payroll_components (tenant_id, employee_id, component_id, effective_from)"
        + " SELECT '" + A + "', '" + employee + "', id, '2032-01-01' FROM hr_payroll_components WHERE tenant_id = '" + A + "' AND code IN ('bonus-" + suffix + "', 'charge-" + suffix + "', 'advance-" + suffix + "');"
        + "INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2033-05', '2033-05-31', 'draft', '" + ADMIN + "'),"
        + " ('" + secondRun + "', '" + A + "', '2033-06', '2033-06-30', 'draft', '" + ADMIN + "')");
    asUser("SELECT confirm_payroll_rules()::text");
    assertThat(asUser("SELECT generate_payroll_lines('" + run + "')::text")).isEqualTo("1");
    asUser(APPROVER, "SELECT precheck_payroll_run('" + run + "')::text");
    asUser(APPROVER, "SELECT approve_payroll_run('" + run + "')");
    String entry = asUser("SELECT post_payroll_run('" + run + "')::text");

    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + entry + "'"))
        .isEqualTo("422:0.00/176000.00 4251:0.00/5000.00 431:0.00/35000.00 447:0.00/19000.00 661:200000.00/0.00 6621:10000.00/0.00 6622:5000.00/0.00 664:20000.00/0.00");

    assertThat(asUser("SELECT generate_payroll_lines('" + secondRun + "')::text")).isEqualTo("1");
    owner("UPDATE gl_accounts SET is_active = false WHERE tenant_id = '" + A + "' AND code = '6621'");
    assertThat(asUser(APPROVER, "SELECT (result->>'passed') || '|' || ((result->'findings') @> '[\"Un compte configure sur une rubrique est absent, inactif ou non imputable.\"]'::jsonb)::text FROM (SELECT precheck_payroll_run('" + secondRun + "') AS result) checked"))
        .isEqualTo("false|true");
    assertThatThrownBy(() -> asUser(APPROVER, "SELECT approve_payroll_run('" + secondRun + "')"))
        .hasMessageContaining("sans anomalie est requis avant approbation");
    assertThat(texte("SELECT status || '|' || (SELECT count(*) FROM journal_entries WHERE entry_number = 'JE-PAY-2033-06-" + secondRun.substring(0, 8) + "') FROM payroll_runs WHERE id = '" + secondRun + "'"))
        .isEqualTo("draft|0");
  }

  // ─── Outils ───

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
