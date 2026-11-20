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
 * V125 — devises sur les ventes : facture client en EUR (cours de référence) encaissée au cours de la banque avec
 * perte de change, facture en USD à lignes encaissée en deux fois avec gain, créance 411 soldée à sa valeur d'origine
 * (lettrage exact), cours figé à l'émission, refus d'un encaissement au-delà du restant dû en devise.
 */
@SpringBootTest
class DevisesVentesIT {

  private static final String DATABASE = "qerp_it_devises_ventes";
  private static final String T = "33333333-3333-3333-3333-333333333125";
  private static final String U = "cccccccc-0000-0000-0000-000000000125";

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

  private static final String C = "00000000-0000-0000-0000-0000000c0125";

  private static String ecriture(String paymentId) {
    return texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l"
        + " JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = (SELECT journal_entry_id FROM payments WHERE id = '" + paymentId + "')");
  }

  private static String encaisser(String invoice, String date, String fx, String rate) throws SQLException {
    return asUser("SELECT (record_settlement('ar', '" + C + "', '" + date + "', 'check', 'ENC', '[{\"invoice_id\":\"" + invoice + "\",\"fx_amount\":" + fx
        + "}]'::jsonb, NULL, " + rate + "))[1]::text");
  }

  @Test
  @DisplayName("factures clients et encaissements en devise, écarts de change, lettrage exact")
  void devisesSurVentes() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société export V125') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V125') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO customers (id, tenant_id, name) VALUES ('" + C + "', '" + T + "', 'Client export V125') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source) VALUES ('" + T + "', 'XOF', 'USD', '2031-05-01', 600, 'BCEAO')");

    // Facture EUR à une ligne, émise : 411 au cours de référence.
    owner("INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, invoice_date, due_date, currency, status, created_by)"
        + " VALUES ('" + T + "', 'VE-1', '" + C + "', '2031-05-02', '2031-06-01', 'EUR', 'draft', '" + U + "')");
    String ve = texte("SELECT id::text FROM ar_invoices WHERE invoice_number = 'VE-1'");
    owner("INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, fx_unit_price) VALUES ('" + T + "', '" + ve + "', 1, 'Lot export', 1, 0, 1000)");
    owner("UPDATE ar_invoices SET status = 'sent' WHERE id = '" + ve + "'");
    assertThat(texte("SELECT fx_total || ' ' || total || ' ' || exchange_rate::numeric(12,3) FROM ar_invoices WHERE id = '" + ve + "'")).isEqualTo("1000.00 655957.00 655.957");
    owner("UPDATE ar_invoices SET exchange_rate = 700 WHERE id = '" + ve + "'");
    assertThat(texte("SELECT exchange_rate::numeric(12,3)::text FROM ar_invoices WHERE id = '" + ve + "'")).as("cours figé à l'émission").isEqualTo("655.957");

    // Encaissé en totalité au cours de la banque (650) : on reçoit 650 000, la créance de 655 957 est soldée, perte 5 957.
    String r1 = encaisser(ve, "2031-05-20", "1000", "650");
    assertThat(ecriture(r1)).isEqualTo("411:0/655957 521:650000/0 676:5957/0");
    assertThat(texte("SELECT status || ' ' || amount_paid FROM ar_invoices WHERE id = '" + ve + "'")).isEqualTo("paid 655957.00");
    assertThat(texte("SELECT count(*)::text FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id AND g.code = '411'"
        + " WHERE l.entry_id IN ((SELECT journal_entry_id FROM ar_invoices WHERE id = '" + ve + "'), (SELECT journal_entry_id FROM payments WHERE id = '" + r1 + "'))"
        + " AND l.lettering_code IS NOT NULL")).as("créance et encaissement lettrés").isEqualTo("2");

    // Facture USD : 2 × 150 USD au cours du jour (600) = 180 000 XOF ; encaissée 100 USD à 610 puis 200 USD au cours du jour (600).
    owner("INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, invoice_date, due_date, currency, status, created_by)"
        + " VALUES ('" + T + "', 'VU-1', '" + C + "', '2031-05-02', '2031-06-01', 'USD', 'draft', '" + U + "')");
    String vu = texte("SELECT id::text FROM ar_invoices WHERE invoice_number = 'VU-1'");
    owner("INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, fx_unit_price) VALUES ('" + T + "', '" + vu + "', 1, 'Prestation', 2, 0, 150)");
    owner("UPDATE ar_invoices SET status = 'sent' WHERE id = '" + vu + "'");
    assertThat(texte("SELECT fx_total || ' ' || total FROM ar_invoices WHERE id = '" + vu + "'")).isEqualTo("300.00 180000.00");
    String r2 = encaisser(vu, "2031-05-25", "100", "610");
    assertThat(ecriture(r2)).isEqualTo("411:0/60000 521:61000/0 776:0/1000");
    assertThatThrownBy(() -> encaisser(vu, "2031-05-26", "200.01", "NULL")).hasMessageContaining("restant dû de 200.00 USD");
    String r3 = encaisser(vu, "2031-05-26", "200", "NULL");
    assertThat(ecriture(r3)).as("cours du jour = cours de la facture : pas d'écart").isEqualTo("411:0/120000 521:120000/0");
    assertThat(texte("SELECT status || ' ' || amount_paid FROM ar_invoices WHERE id = '" + vu + "'")).isEqualTo("paid 180000.00");
    assertThat(asUser("SELECT ar_invoice_fx_outstanding('" + vu + "')::text")).isEqualTo("0.00");
  }
}
