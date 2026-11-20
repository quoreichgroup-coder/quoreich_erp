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
 * V124 — devises sur les achats : cours de référence BCEAO (EUR à parité fixe) et cours de la société, facture en
 * devise sans lignes et avec lignes (conversion ligne à ligne, reconversion au changement de cours d'un brouillon),
 * paiement partiel puis solde au cours du jour avec perte puis gain de change (676 / 776), trésorerie à la
 * contre-valeur décaissée, annulation, refus (dépassement du restant dû en devise, cours absent).
 */
@SpringBootTest
class DevisesAchatsIT {

  private static final String DATABASE = "qerp_it_devises_achats";
  private static final String T = "33333333-3333-3333-3333-333333333124";
  private static final String U = "cccccccc-0000-0000-0000-000000000124";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0124";

  private static String uuid(String sql) {
    return texte(sql);
  }

  @Test
  @DisplayName("factures et paiements en devise, écarts de change réalisés, annulation et refus")
  void devisesSurAchats() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société devises V124') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Trésorier V124') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Fournisseur étranger V124') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);

    // Cours : EUR par la référence BCEAO, USD saisi par la société (droit currency.rates).
    assertThat(asUser("SELECT exchange_rate_at('" + T + "', 'EUR', '2031-03-01')::text")).isEqualTo("655.95700000");
    asUser("INSERT INTO exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source) VALUES ('" + T + "', 'XOF', 'USD', '2031-03-01', 600, 'BCEAO'),"
        + " ('" + T + "', 'XOF', 'USD', '2031-04-15', 620, 'BCEAO') RETURNING id");
    assertThat(asUser("SELECT exchange_rate_at('" + T + "', 'USD', '2031-04-01')::int::text")).isEqualTo("600");
    assertThat(asUser("SELECT exchange_rate_at('" + T + "', 'XOF', '2031-04-01')::int::text")).isEqualTo("1");
    assertThat(asUser("UPDATE exchange_rates SET rate = 1 WHERE tenant_id IS NULL RETURNING id::text")).as("RLS : aucune ligne de référence touchée").isNull();
    assertThat(texte("SELECT rate::text FROM exchange_rates WHERE tenant_id IS NULL AND base_currency = 'XOF' AND currency = 'EUR'"))
        .as("le cours de référence ne se modifie pas par une société").isEqualTo("655.95700000");

    // Facture EUR sans lignes : montants saisis en devise, convertis au cours de référence.
    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, currency, fx_subtotal, fx_tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FE-1', '" + F + "', '2031-03-01', '2031-04-30', 'EUR', 1000, 0, 'draft', 'draft', '" + U + "')");
    assertThat(texte("SELECT currency || ' ' || exchange_rate::numeric(12,3) || ' ' || fx_total || ' ' || subtotal || ' ' || total FROM ap_invoices WHERE invoice_number = 'FE-1'"))
        .isEqualTo("EUR 655.957 1000.00 655957.00 655957.00");

    // Facture USD avec lignes, puis changement de cours du brouillon : les lignes sont reconverties.
    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, currency, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FU-1', '" + F + "', '2031-03-01', '2031-04-30', 'usd', 'draft', 'draft', '" + U + "')");
    String fu = uuid("SELECT id::text FROM ap_invoices WHERE invoice_number = 'FU-1'");
    owner("INSERT INTO ap_invoice_lines (invoice_id, line_no, description, quantity, unit_price, fx_unit_price) VALUES ('" + fu + "', 1, 'Pièces détachées', 2, 0, 250.25)");
    assertThat(texte("SELECT exchange_rate::int || ' ' || fx_total || ' ' || total FROM ap_invoices WHERE id = '" + fu + "'")).isEqualTo("600 500.50 300300.00");
    owner("UPDATE ap_invoices SET exchange_rate = 610 WHERE id = '" + fu + "'");
    assertThat(texte("SELECT fx_total || ' ' || total || ' ' || (SELECT unit_price FROM ap_invoice_lines WHERE invoice_id = '" + fu + "') FROM ap_invoices WHERE id = '" + fu + "'"))
        .isEqualTo("500.50 305305.00 152652.50");
    owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number IN ('FE-1', 'FU-1')");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE l.entry_id = (SELECT journal_entry_id FROM ap_invoices WHERE id = '" + fu + "')")).isEqualTo("401:0/305305 601:305305/0");
    owner("UPDATE ap_invoices SET exchange_rate = 1 WHERE id = '" + fu + "'");
    assertThat(texte("SELECT exchange_rate::int::text FROM ap_invoices WHERE id = '" + fu + "'")).as("cours figé après approbation").isEqualTo("610");

    // Paiement partiel de 200 USD au cours du jour (620) : 401 soldé à 610, perte de change 2 000.
    String p1 = asUser("SELECT (record_settlement('ap', '" + F + "', '2031-04-15', 'check', 'P1', '[{\"invoice_id\":\"" + fu + "\",\"fx_amount\":200}]'::jsonb))[1]::text");
    assertThat(texte("SELECT amount || ' ' || cash_amount || ' ' || exchange_rate::int || ' ' || currency FROM payments WHERE id = '" + p1 + "'")).isEqualTo("122000.00 124000.00 620 USD");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE l.entry_id = (SELECT journal_entry_id FROM payments WHERE id = '" + p1 + "')")).isEqualTo("401:122000/0 521:0/124000 676:2000/0");
    assertThat(asUser("SELECT ap_invoice_fx_outstanding('" + fu + "')::text")).isEqualTo("300.50");

    // Dépassement du restant dû en devise refusé.
    assertThatThrownBy(() -> asUser("SELECT (record_settlement('ap', '" + F + "', '2031-04-20', 'check', 'PX', '[{\"invoice_id\":\"" + fu + "\",\"fx_amount\":300.51}]'::jsonb))[1]::text"))
        .hasMessageContaining("restant dû de 300.50 USD");

    // Solde au cours de la banque (590) : la dette est soldée exactement, gain de change.
    String p2 = asUser("SELECT (record_settlement('ap', '" + F + "', '2031-04-20', 'check', 'P2', '[{\"invoice_id\":\"" + fu + "\",\"fx_amount\":300.50}]'::jsonb, NULL, 590))[1]::text");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE l.entry_id = (SELECT journal_entry_id FROM payments WHERE id = '" + p2 + "')")).isEqualTo("401:183305/0 521:0/177295 776:0/6010");
    assertThat(texte("SELECT status || ' ' || amount_paid FROM ap_invoices WHERE id = '" + fu + "'")).isEqualTo("paid 305305.00");

    // Annulation du premier paiement : contre-valeur et devise inversées, facture de nouveau ouverte.
    String r = asUser("SELECT reverse_settlement('" + p1 + "', 'Erreur de banque', '2031-04-25')::text");
    assertThat(texte("SELECT amount || ' ' || cash_amount || ' ' || fx_amount FROM payments WHERE id = '" + r + "'")).isEqualTo("-122000.00 -124000.00 -200.00");
    assertThat(texte("SELECT amount_paid || ' ' || (status <> 'paid') FROM ap_invoices WHERE id = '" + fu + "'")).isEqualTo("183305.00 true");

    // Devise sans aucun cours connu : la facture est refusée avec un message qui dit quoi faire.
    assertThatThrownBy(() -> owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, currency, fx_subtotal, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FG-1', '" + F + "', '2031-03-01', '2031-04-30', 'GBP', 10, 'draft', 'draft', '" + U + "')"))
        .hasMessageContaining("Aucun cours GBP / XOF");

    // Une facture dans la devise de la société garde son comportement : aucun champ de devise.
    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, currency, subtotal, status, approval_status, created_by)"
        + " VALUES ('" + T + "', 'FX-1', '" + F + "', '2031-03-01', '2031-04-30', 'XOF', 5000, 'draft', 'draft', '" + U + "')");
    assertThat(texte("SELECT COALESCE(currency, '-') || ' ' || COALESCE(exchange_rate::text, '-') || ' ' || total FROM ap_invoices WHERE invoice_number = 'FX-1'")).isEqualTo("- - 5000.00");
  }
}
