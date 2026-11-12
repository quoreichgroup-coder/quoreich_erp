package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Scripts de correction des doublons hérités ({@code scripts/data/doublons-declencheurs/}).
 *
 * <p>Ce sont ces fichiers-là, tels qu'ils seront exécutés en production, qui sont testés — pas une
 * copie. Le défaut est recréé dans une base jetable en rebranchant les deux déclencheurs que V16 a
 * retirés, le temps d'un paiement : on obtient trois écritures identiques, comme dans le dump.
 */
@SpringBootTest
class CorrectionDoublonsIT {

  private static final String DATABASE = "qerp_it_correction";
  private static final Path SCRIPTS = Path.of("../../scripts/data/doublons-declencheurs");
  private static final String RECU = "AR Receipt: DOUBLON-1";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Test
  @DisplayName("période close → refus sans effet ; sinon contre-passation exacte ; rejouable sans effet")
  void contrepasseLesDoublonsUneSeuleFois() throws Exception {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    String a = PostgresFixture.ALPHA_TENANT;
    admin(
        "INSERT INTO gl_accounts (tenant_id, code, name, account_type) SELECT '"
            + a
            + "', v.code, v.name, v.t FROM (VALUES ('4110','Clients','asset'),"
            + " ('4000','Ventes','revenue'), ('4310','TVA collectée','liability'),"
            + " ('5210','Banque','asset')) AS v(code, name, t)");
    recreerLeDefautPourUnPaiement();

    assertThat(rows("SELECT count(*) FROM journal_entries WHERE description = ?", RECU))
        .as("le défaut recréé produit trois écritures")
        .containsExactly("3");

    // 1. Doublon dans une période close : refus global, rien ne bouge.
    String periode = rows("SELECT to_char(CURRENT_DATE, 'YYYY-MM')").getFirst();
    admin(
        "INSERT INTO period_locks (tenant_id, period, module, status) VALUES ('"
            + a
            + "', '"
            + periode
            + "', 'GL', 'closed')");
    List<String> avant = etat();
    assertThatThrownBy(this::executerScripts)
        .isInstanceOf(SQLException.class)
        .hasMessageContaining("période GL close");
    assertThat(etat()).isEqualTo(avant);
    admin("DELETE FROM period_locks WHERE tenant_id = '" + a + "' AND period = '" + periode + "'");

    // 2. Correction : une écriture reste, les deux autres sont contre-passées.
    executerScripts();
    assertThat(rows("SELECT status, count(*) FROM journal_entries WHERE description = ?"
                + " GROUP BY status ORDER BY status", RECU))
        .containsExactly("posted | 1", "reversed | 2");
    assertThat(soldeBanque()).as("solde net Banque = un seul encaissement").isEqualTo("100.00");
    assertThat(rows("SELECT count(*), min(status) FROM journal_entries WHERE source = 'reversal'"))
        .containsExactly("2 | posted");

    // 3. Rejouable : aucune nouvelle contre-passation.
    List<String> apres = etat();
    executerScripts();
    assertThat(etat()).isEqualTo(apres);
  }

  /** Rebranche les déclencheurs retirés par V16, le temps d'un paiement, puis les retire. */
  private static void recreerLeDefautPourUnPaiement() throws SQLException {
    admin(
        "CREATE TRIGGER trg_payment_gl AFTER INSERT ON public.payments FOR EACH ROW"
            + " EXECUTE FUNCTION public.on_ap_payment_recorded();"
            + "CREATE TRIGGER trg_payment_gl_posting AFTER INSERT ON public.payments FOR EACH ROW"
            + " EXECUTE FUNCTION public.on_ap_payment_recorded()");
    try {
      String facture =
          asUser(
              "INSERT INTO ar_invoices (invoice_number, customer_id, invoice_date, due_date,"
                  + " subtotal, tax_amount, total, tenant_id, created_by, status, amount_paid)"
                  + " VALUES ('DOUBLON-F1', 'c0000001-0000-0000-0000-000000000000', CURRENT_DATE,"
                  + " CURRENT_DATE + 30, 1000.00, 180.00, 1180.00, get_user_tenant_id(auth.uid()),"
                  + " auth.uid(), 'sent', 0) RETURNING id");
      asUser(
          "INSERT INTO payments (ar_invoice_id, amount, reference, tenant_id, payment_type,"
              + " created_by) VALUES ('"
              + facture
              + "', 100.00, 'DOUBLON-1', get_user_tenant_id(auth.uid()), 'ar_receipt', auth.uid())");
    } finally {
      admin(
          "DROP TRIGGER trg_payment_gl ON public.payments;"
              + "DROP TRIGGER trg_payment_gl_posting ON public.payments");
    }
  }

  /** Exécute 01 puis 02 dans une même session, comme {@code corriger.psql}. */
  private void executerScripts() throws SQLException, IOException {
    try (Connection c = adminConnection();
        Statement st = c.createStatement()) {
      st.execute(Files.readString(SCRIPTS.resolve("01-constat.sql")));
      st.execute(Files.readString(SCRIPTS.resolve("02-contrepassation.sql")));
    }
  }

  private static List<String> etat() {
    List<String> e = new ArrayList<>();
    e.addAll(rows("SELECT id || ' ' || status FROM journal_entries ORDER BY id"));
    e.addAll(rows("SELECT count(*) FROM journal_lines"));
    e.addAll(rows("SELECT count(*) FROM gl_audit_logs"));
    return e;
  }

  private static String soldeBanque() {
    return rows(
            "SELECT sum(l.debit - l.credit) FROM journal_lines l"
                + " JOIN gl_accounts g ON g.id = l.account_id AND g.code = '5210'"
                + " JOIN journal_entries je ON je.id = l.entry_id"
                + " WHERE g.tenant_id = '"
                + PostgresFixture.ALPHA_TENANT
                + "'")
        .getFirst();
  }

  private static Connection adminConnection() throws SQLException {
    return DriverManager.getConnection(
        PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
  }

  private static void admin(String sql) throws SQLException {
    try (Connection c = adminConnection();
        Statement st = c.createStatement()) {
      st.execute(sql);
    }
  }

  /** Comme PostgREST : rôle applicatif, claims du porteur, une transaction. */
  private static String asUser(String sql) throws SQLException {
    try (Connection c =
        DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims =
          c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(
            1, "{\"sub\":\"" + PostgresFixture.ALPHA_USER + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      String result = null;
      try (Statement st = c.createStatement()) {
        if (st.execute(sql)) {
          try (ResultSet rs = st.getResultSet()) {
            if (rs.next()) result = rs.getString(1);
          }
        }
      }
      c.commit();
      return result;
    }
  }

  private static List<String> rows(String sql, Object... params) {
    List<String> out = new ArrayList<>();
    try (Connection c = adminConnection();
        PreparedStatement st = c.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) st.setObject(i + 1, params[i]);
      try (ResultSet rs = st.executeQuery()) {
        int n = rs.getMetaData().getColumnCount();
        while (rs.next()) {
          StringBuilder row = new StringBuilder();
          for (int i = 1; i <= n; i++) row.append(i > 1 ? " | " : "").append(rs.getString(i));
          out.add(row.toString());
        }
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }
}
