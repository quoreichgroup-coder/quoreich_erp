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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V121 — clôture d'exercice : aperçu (résultat, points bloquants), refus tant qu'une écriture est en brouillon, écriture
 * de détermination du résultat (comptes de gestion soldés sur 131), compte de résultat de l'exercice clos intact (les
 * calculs sur une période ignorent l'écriture de clôture), état des à-nouveaux de l'exercice suivant équilibré.
 */
@SpringBootTest
class ClotureExerciceIT {

  private static final String DATABASE = "qerp_it_cloture_exercice";
  private static final String T = "33333333-3333-3333-3333-333333333121";
  private static final String U = "cccccccc-0000-0000-0000-000000000121";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    return PostgresFixture.textAsAdmin(DATABASE, sql);
  }

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + U + "\",\"role\":\"authenticated\"}");
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

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + T + "' AND code = '" + code + "'");
  }

  private static String ecriture(String date, String debit, String credit, int montant, String statut) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + T
        + "', 'JE-V121-" + e.substring(0, 8) + "', '" + date + "', 'Pièce V121', 'manual', 'draft', '" + U + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('" + e
        + "', '" + compte(credit) + "', 0, " + montant + ")" + ("posted".equals(statut) ? ";UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'" : ""));
    return e;
  }

  @Test
  @DisplayName("aperçu, refus avec brouillon, détermination du résultat sur 131, compte de résultat intact, à-nouveaux équilibrés")
  void clotureAvecResultat() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société clôture V121') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V121') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);

    String fy = asUser("SELECT create_fiscal_year('2031-01-01')::text");
    String suivant = asUser("SELECT create_fiscal_year('2032-01-01')::text");
    asUser("SELECT open_fiscal_year('" + fy + "')::text");
    ecriture("2031-03-15", "411", "701", 1_000_000, "posted");
    ecriture("2031-06-20", "601", "521", 400_000, "posted");
    String brouillon = ecriture("2031-11-05", "601", "521", 1_000, "draft");

    String apercu = asUser("SELECT fiscal_year_close_preview('" + fy + "')::text");
    assertThat(apercu).contains("\"result\": 600000", "\"revenue\": 1000000", "\"expense\": 400000", "\"draft_entries\": 1", "\"missing_roles\": []");
    owner("DELETE FROM journal_lines WHERE entry_id = '" + brouillon + "'; DELETE FROM journal_entries WHERE id = '" + brouillon + "'");

    for (int m = 1; m <= 12; m++) {
      String p = String.format("2031-%02d", m);
      for (String mod : new String[] {"SALES", "PURCHASING", "INVENTORY", "AR", "AP", "TREASURY", "ASSETS", "PAYROLL"}) {
        asUser("SELECT set_period_status('" + p + "', '" + mod + "', 'closed')::text");
      }
      asUser("SELECT set_period_status('" + p + "', 'GL', 'closed')::text");
    }
    // Un brouillon apparu après la clôture des périodes (import, saisie directe) bloque encore la clôture de l'exercice.
    String tardif = ecriture("2031-12-20", "601", "521", 1_000, "draft");
    assertThatThrownBy(() -> asUser("SELECT close_fiscal_year('" + fy + "')::text")).hasMessageContaining("brouillon");
    owner("DELETE FROM journal_lines WHERE entry_id = '" + tardif + "'; DELETE FROM journal_entries WHERE id = '" + tardif + "'");

    asUser("SELECT close_fiscal_year('" + fy + "')::text");
    assertThat(texte("SELECT status || ' ' || result_amount::int FROM fiscal_years WHERE id = '" + fy + "'")).isEqualTo("closed 600000");
    String clo = texte("SELECT result_entry_id::text FROM fiscal_years WHERE id = '" + fy + "'");
    assertThat(texte("SELECT journal_code || ' ' || entry_date || ' ' || status FROM journal_entries WHERE id = '" + clo + "'")).isEqualTo("OD 2031-12-31 posted");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::int || '/' || l.credit::int, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + clo + "'"))
        .isEqualTo("131:0/600000 601:0/400000 701:1000000/0");

    // L'exercice clos garde son compte de résultat : les calculs sur une période ignorent l'écriture de clôture.
    assertThat(asUser("SELECT string_agg(account_code || ':' || balance::int, ' ' ORDER BY account_code) FROM fiscal_year_management_balances('" + fy + "')"))
        .isEqualTo("601:400000 701:-1000000");
    assertThat(asUser("SELECT COALESCE(sum(amount), 0)::int::text FROM report_compute('CR_SYSCOHADA', '" + T + "', '2031-01-01', '2031-12-31') WHERE line_code = 'XI'"))
        .as("résultat net du compte de résultat 2031").isEqualTo("600000");

    // État des à-nouveaux 2032 : comptes de bilan, résultat en 131, équilibré, sans résultat « non déterminé ».
    String an = asUser("SELECT string_agg(COALESCE(account_code, '—') || ':' || debit::int || '/' || credit::int, ' ' ORDER BY account_code) FROM fiscal_year_opening_balances('" + suivant + "')");
    assertThat(an).isEqualTo("131:0/600000 411:1000000/0 521:0/400000");
    assertThat(asUser("SELECT (sum(debit) = sum(credit))::text FROM fiscal_year_opening_balances('" + suivant + "')")).isEqualTo("true");

    // Les brouillons supprimés restent tracés (« Deleted ») et la chaîne d'audit reste intacte.
    assertThat(texte("SELECT count(*)::text FROM gl_audit_logs WHERE tenant_id = '" + T + "' AND action = 'Deleted'")).isEqualTo("2");
    assertThat(asUser("SELECT count(*)::text FROM gl_audit_chain_breaks()")).isEqualTo("0");
  }
}
