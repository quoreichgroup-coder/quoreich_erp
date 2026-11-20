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
 * V127 — avance fournisseur versée (4091 / banque), en XOF et en devise, imputée sur une facture (401 / 4091), refus au-delà
 * du disponible ; V128 — réévaluation de clôture : gain latent sur créance (411 / 479), perte latente sur dette
 * (478 / 401), contre-passation à l'ouverture, provision 697 / 194, reprise 194 / 797 à la réévaluation suivante, refus
 * d'une seconde réévaluation à la même date.
 */
@SpringBootTest
class AvancesEtReevaluationDevisesIT {

  private static final String DATABASE = "qerp_it_avances_reevaluation";
  private static final String T = "33333333-3333-3333-3333-333333333127";
  private static final String U = "cccccccc-0000-0000-0000-000000000127";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0127";
  private static final String C = "00000000-0000-0000-0000-0000000c0127";

  private static String lignes(String entry) {
    return texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code, l.debit) FROM journal_lines l"
        + " JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = '" + entry + "'");
  }

  @Test
  @DisplayName("avance fournisseur versée et imputée ; réévaluation de clôture avec contre-passation et provision")
  void avancesEtReevaluation() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société avances V127') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V127') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Fournisseur V127') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO customers (id, tenant_id, name) VALUES ('" + C + "', '" + T + "', 'Client V127') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source) VALUES"
        + " ('" + T + "', 'XOF', 'USD', '2031-01-01', 600, 'BCEAO'), ('" + T + "', 'XOF', 'USD', '2031-12-31', 650, 'BCEAO'), ('" + T + "', 'XOF', 'USD', '2032-12-31', 640, 'BCEAO')");

    // ─── Avance fournisseur ───
    String adv = asUser("SELECT record_supplier_advance('" + F + "', '2031-02-01', 'check', 'CHQ-1', 500000)::text");
    assertThat(texte("SELECT advance_number LIKE 'ACF-2031-%' FROM ap_supplier_advances WHERE id = '" + adv + "'")).isEqualTo("t");
    assertThat(lignes(texte("SELECT journal_entry_id::text FROM ap_supplier_advances WHERE id = '" + adv + "'"))).isEqualTo("4091:500000/0 521:0/500000");
    String eur = asUser("SELECT record_supplier_advance('" + F + "', '2031-02-02', 'check', 'CHQ-2', NULL, NULL, NULL, 'EUR', 1000)::text");
    assertThat(texte("SELECT amount || ' ' || currency || ' ' || fx_amount FROM ap_supplier_advances WHERE id = '" + eur + "'")).isEqualTo("655957.00 EUR 1000.00");

    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FA-127', '" + F + "', '2031-02-05', '2031-03-05', 800000, 'draft', 'draft', '" + U + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = 'FA-127'");
    String fa = texte("SELECT id::text FROM ap_invoices WHERE invoice_number = 'FA-127'");
    String imp = asUser("SELECT apply_supplier_advance('" + fa + "', '" + adv + "', 300000, '2031-02-10')::text");
    assertThat(lignes(texte("SELECT journal_entry_id::text FROM payments WHERE id = '" + imp + "'"))).isEqualTo("401:300000/0 4091:0/300000");
    assertThat(texte("SELECT status || ' ' || amount_paid FROM ap_invoices WHERE id = '" + fa + "'")).isEqualTo("partially_paid 300000.00");
    assertThat(texte("SELECT amount_applied::text FROM ap_supplier_advances WHERE id = '" + adv + "'")).isEqualTo("300000.00");
    assertThatThrownBy(() -> asUser("SELECT apply_supplier_advance('" + fa + "', '" + adv + "', 200001, '2031-02-11')::text"))
        .hasMessageContaining("disponible de l'avance (200000.00)");
    assertThatThrownBy(() -> asUser("SELECT reverse_settlement('" + imp + "', 'erreur', '2031-02-12')::text")).hasMessageContaining("ne s'annule pas");

    // ─── Réévaluation de clôture ───
    owner("INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, invoice_date, due_date, currency, fx_subtotal, status, created_by)"
        + " VALUES ('" + T + "', 'VU-127', '" + C + "', '2031-06-01', '2031-07-01', 'USD', 1000, 'draft', '" + U + "');"
        + "UPDATE ar_invoices SET status = 'sent' WHERE invoice_number = 'VU-127';"
        + "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, currency, fx_subtotal, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FU-127', '" + F + "', '2031-06-01', '2031-07-01', 'USD', 500, 'draft', 'draft', '" + U + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = 'FU-127'");
    assertThat(asUser("SELECT string_agg(kind || ':' || invoice_number || ':' || fx_outstanding || ':' || book_value::bigint || '>' || closing_value::bigint || ':' || difference::bigint, ' ' ORDER BY kind)"
        + " FROM fx_revaluation_items('2031-12-31')")).isEqualTo("ap:FU-127:500.00:300000>325000:-25000 ar:INV-2031-0001:1000.00:600000>650000:50000");

    String run = asUser("SELECT post_fx_revaluation('2031-12-31', 'Clôture 2031')::text");
    assertThat(texte("SELECT gains::bigint || ' ' || losses::bigint || ' ' || provision_amount::bigint FROM fx_revaluation_runs WHERE id = '" + run + "'")).isEqualTo("50000 25000 25000");
    assertThat(lignes(texte("SELECT entry_id::text FROM fx_revaluation_runs WHERE id = '" + run + "'"))).isEqualTo("401:0/25000 411:50000/0 478:25000/0 479:0/50000");
    assertThat(texte("SELECT e.entry_date || ' ' || (SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = e.id)"
        + " FROM journal_entries e WHERE e.id = (SELECT reversal_entry_id FROM fx_revaluation_runs WHERE id = '" + run + "')"))
        .as("contre-passée le lendemain").isEqualTo("2032-01-01 401:25000/0 411:0/50000 478:0/25000 479:50000/0");
    assertThat(lignes(texte("SELECT provision_entry_id::text FROM fx_revaluation_runs WHERE id = '" + run + "'"))).isEqualTo("194:0/25000 697:25000/0");
    assertThatThrownBy(() -> asUser("SELECT post_fx_revaluation('2031-12-31', 'Encore')::text")).hasMessageContaining("existe déjà");

    // Exercice suivant : reprise de la provision précédente, nouvelle provision.
    String run2 = asUser("SELECT post_fx_revaluation('2032-12-31', 'Clôture 2032')::text");
    assertThat(lignes(texte("SELECT provision_reversal_entry_id::text FROM fx_revaluation_runs WHERE id = '" + run + "'"))).isEqualTo("194:25000/0 797:0/25000");
    assertThat(texte("SELECT gains::bigint || ' ' || losses::bigint FROM fx_revaluation_runs WHERE id = '" + run2 + "'")).isEqualTo("40000 20000");
  }
}
