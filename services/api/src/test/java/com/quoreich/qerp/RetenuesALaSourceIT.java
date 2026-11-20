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
 * V136 — retenue à la source : catégorie reprise du fournisseur, montant figé à l'approbation, prélevée au prorata des
 * paiements (le dernier solde), écriture 401 / banque nette / 447x, annulation symétrique, état des retenues ; compte
 * absent du plan = refus explicite.
 */
@SpringBootTest
class RetenuesALaSourceIT {

  private static final String DATABASE = "qerp_it_retenues_source";
  private static final String T = "33333333-3333-3333-3333-333333333136";
  private static final String U = "cccccccc-0000-0000-0000-000000000136";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0136";
  private static final String R = "00000000-0000-0000-0000-0000000e0136";
  private static final String I = "00000000-0000-0000-0000-00000000f136";

  @Test
  @DisplayName("retenue reprise du fournisseur, prélevée au prorata, comptabilisée en 447x, annulée, déclarée")
  void retenue() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Client V136') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V136') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + T + "', '4471', 'État, retenues BIC', 'liability');"
        + "INSERT INTO ap_withholding_rates (id, tenant_id, category, rate_pct, gl_account) VALUES ('" + R + "', '" + T + "', 'Services (BIC)', 5, '4471');"
        + "INSERT INTO suppliers (id, tenant_id, name, tax_id, withholding_rate_id) VALUES ('" + F + "', '" + T + "', 'Cabinet Conseil', 'IFU-136', '" + R + "');"
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, total, status, approval_status, created_by)"
        + " VALUES ('" + I + "', '" + T + "', 'CC-136', '" + F + "', '2031-06-01', '2031-07-01', 100000, 18000, 118000, 'draft', 'draft', '" + U + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + I + "'");
    assertThat(texte("SELECT withholding_rate_pct::int || ' ' || withholding_amount::int FROM ap_invoices WHERE id = '" + I + "'")).isEqualTo("5 5000");

    // Premier paiement : moitié de la dette → moitié de la retenue ; banque créditée du net.
    String p1 = asUser("SELECT (record_settlement('ap', '" + F + "', '2031-06-10', 'check', 'CHQ-1', '[{\"invoice_id\": \"" + I + "\", \"amount\": 59000}]'::jsonb))::text");
    assertThat(texte("SELECT withholding_amount::int || ' ' || cash_amount::int FROM payments WHERE ap_invoice_id = '" + I + "' AND reference = 'CHQ-1'")).isEqualTo("2500 56500");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::int || ':' || l.credit::int, ' ' ORDER BY g.code) FROM payments p JOIN journal_lines l ON l.entry_id = p.journal_entry_id"
        + " JOIN gl_accounts g ON g.id = l.account_id WHERE p.reference = 'CHQ-1' AND p.tenant_id = '" + T + "'")).isEqualTo("401:59000:0 4471:0:2500 521:0:56500");

    // Solde : le reste de la retenue, quel que soit l'arrondi.
    asUser("SELECT (record_settlement('ap', '" + F + "', '2031-06-20', 'check', 'CHQ-2', '[{\"invoice_id\": \"" + I + "\", \"amount\": 59000}]'::jsonb))::text");
    assertThat(texte("SELECT sum(withholding_amount)::int || ' ' || sum(cash_amount)::int FROM payments WHERE ap_invoice_id = '" + I + "'")).isEqualTo("5000 113000");
    assertThat(texte("SELECT status FROM ap_invoices WHERE id = '" + I + "'")).isEqualTo("paid");

    // État des retenues de juin.
    assertThat(asUser("SELECT string_agg(supplier_tax_id || ':' || base_amount::int || ':' || withheld::int, ' ' ORDER BY payment_date) FROM withholding_statement('2031-06-01', '2031-06-30')"))
        .isEqualTo("IFU-136:50000:2500 IFU-136:50000:2500");

    // Annulation du second paiement : retenue rendue, la facture redevient ouverte.
    String pay2 = texte("SELECT id::text FROM payments WHERE reference = 'CHQ-2' AND tenant_id = '" + T + "'");
    asUser("SELECT reverse_settlement('" + pay2 + "', 'Erreur de chèque', '2031-06-21')::text");
    assertThat(texte("SELECT sum(withholding_amount)::int FROM payments WHERE ap_invoice_id = '" + I + "'")).isEqualTo("2500");

    // Compte de retenue absent du plan : paiement refusé, avec le nom du compte.
    owner("UPDATE ap_withholding_rates SET gl_account = '4479' WHERE id = '" + R + "'");
    assertThatThrownBy(() -> asUser("SELECT (record_settlement('ap', '" + F + "', '2031-06-25', 'check', 'CHQ-3', '[{\"invoice_id\": \"" + I + "\", \"amount\": 59000}]'::jsonb))::text"))
        .hasMessageContaining("4479");
  }
}
