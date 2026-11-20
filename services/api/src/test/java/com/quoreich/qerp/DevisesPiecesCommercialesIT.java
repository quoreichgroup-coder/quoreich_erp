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
 * V126 — devise du client reprise par le devis, transmise à la commande puis à la facture brouillon issue de la
 * livraison (prix en devise repris, contre-valeur au cours de chaque pièce) ; client sans devise = devise de la
 * société ; commande fournisseur en devise valorisée au coût converti, coût en devise proposé à la facture.
 */
@SpringBootTest
class DevisesPiecesCommercialesIT {

  private static final String DATABASE = "qerp_it_devises_pieces";
  private static final String T = "33333333-3333-3333-3333-333333333126";
  private static final String U = "cccccccc-0000-0000-0000-000000000126";

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

  private static final String C = "00000000-0000-0000-0000-0000000c0126";
  private static final String C2 = "00000000-0000-0000-0000-0000000c1126";
  private static final String F = "00000000-0000-0000-0000-0000000f0126";

  @Test
  @DisplayName("devis, commande, livraison et facture dans la devise du client ; commande fournisseur en devise")
  void devisesDesPieces() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société pièces V126') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Commercial V126') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO customers (id, tenant_id, name, currency, credit_limit) VALUES ('" + C + "', '" + T + "', 'Client USD V126', 'USD', 100000000),"
        + " ('" + C2 + "', '" + T + "', 'Client local V126', NULL, 100000000) ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name, currency) VALUES ('" + F + "', '" + T + "', 'Fournisseur EUR V126', 'EUR') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO exchange_rates (tenant_id, base_currency, currency, rate_date, rate, source) VALUES ('" + T + "', 'XOF', 'USD', '2020-01-01', 600, 'BCEAO')");

    // Devis : devise du client, prix en USD, ligne convertie.
    String devis = asUser("SELECT create_sales_quotation('" + C + "', CURRENT_DATE, CURRENT_DATE + 30,"
        + " '[{\"description\":\"Prestation\",\"quantity\":2,\"unit_price\":100}]'::jsonb)::text");
    assertThat(texte("SELECT currency || ' ' || exchange_rate::int || ' ' || fx_total || ' ' || total FROM quotations WHERE id = '" + devis + "'"))
        .isEqualTo("USD 600 200.00 120000.00");

    // Commande issue du devis : même devise, prix en devise repris.
    String commande = asUser("SELECT confirm_quote_to_so('" + devis + "')::text");
    assertThat(texte("SELECT currency || ' ' || fx_total || ' ' || total || ' ' || (SELECT fx_unit_price FROM so_lines WHERE so_id = '" + commande + "')"
        + " FROM sales_orders WHERE id = '" + commande + "'")).isEqualTo("USD 200.00 120000.00 100.0000");

    // Livraison : la facture brouillon arrive en USD avec le prix en devise.
    asUser("SELECT confirm_so('" + commande + "')::text");
    asUser("SELECT post_delivery('" + commande + "', (SELECT jsonb_agg(jsonb_build_object('so_line_id', id, 'quantity', quantity)) FROM so_lines WHERE so_id = '" + commande + "'))::text");
    assertThat(texte("SELECT status || ' ' || currency || ' ' || fx_total || ' ' || total FROM ar_invoices WHERE so_id = '" + commande + "'"))
        .isEqualTo("draft USD 200.00 120000.00");

    // Client sans devise : la pièce reste dans la devise de la société.
    String local = asUser("SELECT create_sales_quotation('" + C2 + "', CURRENT_DATE, CURRENT_DATE + 30,"
        + " '[{\"description\":\"Prestation\",\"quantity\":1,\"unit_price\":5000}]'::jsonb)::text");
    assertThat(texte("SELECT COALESCE(currency, '-') || ' ' || total FROM quotations WHERE id = '" + local + "'")).isEqualTo("- 5000.00");

    // Commande fournisseur en EUR : coût converti (réceptions), coût en devise proposé à la facture.
    owner("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by, currency) VALUES"
        + " ('00000000-0000-0000-0000-00000000a126', '" + T + "', 'PO-V126', '" + F + "', CURRENT_DATE, 'draft', '" + U + "', 'EUR');"
        + "INSERT INTO po_lines (po_id, description, quantity, unit_cost) VALUES ('00000000-0000-0000-0000-00000000a126', 'Pièces', 3, 10)");
    assertThat(texte("SELECT currency || ' ' || fx_total || ' ' || total || ' ' || (SELECT l.unit_cost FROM po_lines l WHERE l.po_id = purchase_orders.id) FROM purchase_orders"
        + " WHERE po_number = 'PO-V126'")).isEqualTo("EUR 30.00 19678.71 6559.5700");
    assertThat(asUser("SELECT currency || ' ' || fx_unit_cost FROM ap_po_lines_to_invoice('00000000-0000-0000-0000-00000000a126')")).isEqualTo("EUR 10.0000");
  }
}
