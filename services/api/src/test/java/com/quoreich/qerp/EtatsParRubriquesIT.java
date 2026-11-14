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
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
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
  @DisplayName("paie : comptes par rôles (661 / 664 / 422 / 431 / 447), taux patronal paramétré ; rôle manquant = QG001")
  void paieParRoles() throws SQLException {
    owner("INSERT INTO hr_payroll_settings (tenant_id, employer_contribution_pct) VALUES ('" + A + "', 10)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET employer_contribution_pct = 10");
    String emp = UUID.randomUUID().toString(), run = UUID.randomUUID().toString();
    owner("INSERT INTO employees (id, tenant_id, matricule, first_name, last_name) VALUES ('" + emp + "', '" + A + "', 'M-" + emp.substring(0, 5)
        + "', 'Awa', 'Ouédraogo');"
        + "INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run + "', '" + A + "', '2032-05', '2032-05-31', 'approved', '" + ADMIN + "');"
        + "INSERT INTO payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net) VALUES ('" + A + "', '" + run + "', '" + emp + "', 200000, 10000, 15000, 175000)");
    String je = asUser("SELECT post_payroll_run('" + run + "')::text");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + je + "'"))
        .isEqualTo("422:0.00/175000.00 431:0.00/30000.00 447:0.00/15000.00 661:200000.00/0.00 664:20000.00/0.00");

    owner("DELETE FROM tenant_posting_accounts WHERE tenant_id = '" + A + "' AND role_code = 'PAYROLL_TAX'");
    String run2 = UUID.randomUUID().toString();
    owner("INSERT INTO payroll_runs (id, tenant_id, period, pay_date, status, created_by) VALUES ('" + run2 + "', '" + A + "', '2032-06', '2032-06-30', 'approved', '" + ADMIN + "');"
        + "INSERT INTO payroll_lines (tenant_id, run_id, employee_id, gross, deductions, taxes, net) VALUES ('" + A + "', '" + run2 + "', '" + emp + "', 100000, 0, 5000, 95000)");
    assertThatThrownBy(() -> asUser("SELECT post_payroll_run('" + run2 + "')::text")).hasMessageContaining("Paramétrage comptable incomplet");
  }

  // ─── Outils ───

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + ADMIN + "\",\"role\":\"authenticated\"}");
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
