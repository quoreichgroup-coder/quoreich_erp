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
 * V50 — retour client sur livraison : stock ré-entré au coût de la sortie, avoir lié sur la facture
 * de la livraison, livré non retourné seul refacturable ; un brouillon issu de livraison se supprime
 * et libère la livraison.
 */
@SpringBootTest
class RetoursClientsIT {

  private static final String DATABASE = "qerp_it_retours";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String CLIENT = "c0000003-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO sales_settings (tenant_id, auto_invoice_on_delivery) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_invoice_on_delivery = true");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  /** Commande confirmée de 8 articles à 12 000, livrée à 6 ; renvoie l'id de la livraison. */
  private static String livraison() throws SQLException {
    String article = UUID.randomUUID().toString(), commande = UUID.randomUUID().toString(), ligne = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost) VALUES ('" + article + "', '" + A
        + "', 'R-" + article.substring(0, 6) + "', 'Article retour', 10, 5000);"
        + "INSERT INTO stock_valuation_layers (tenant_id, item_id, layer_date, qty_in, cost_in, qty_remaining) VALUES ('"
        + A + "', '" + article + "', CURRENT_DATE, 10, 5000, 10);"
        + "INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total, status, created_by) VALUES ('" + commande
        + "', '" + A + "', 'SO-" + commande.substring(0, 6) + "', '" + CLIENT + "', 0, 'confirmed', '" + ADMIN + "');"
        + "INSERT INTO so_lines (id, so_id, item_id, description, quantity, unit_price) VALUES ('" + ligne + "', '"
        + commande + "', '" + article + "', 'Article retour', 8, 12000)");
    return asUser("SELECT post_delivery('" + commande + "', jsonb_build_array(jsonb_build_object('so_line_id', '" + ligne
        + "', 'quantity', 6)))::text");
  }

  private static String lignes(String dn, int qte) {
    return "(SELECT jsonb_agg(jsonb_build_object('dn_line_id', id, 'quantity', " + qte + ")) FROM dn_lines WHERE dn_id = '" + dn + "')";
  }

  @Test
  @DisplayName("livraison facturée : retour partiel → stock ré-entré au coût de sortie, avoir lié imputé sur la facture")
  void retourAvecAvoir() throws SQLException {
    String dn = livraison();
    String article = texte("SELECT item_id::text FROM dn_lines WHERE dn_id = '" + dn + "'");
    asUser("UPDATE ar_invoices SET status = 'sent' WHERE dn_id = '" + dn + "' RETURNING id::text");

    String ret = asUser("SELECT create_customer_return('" + dn + "', 'Casse au transport', CURRENT_DATE, " + lignes(dn, 2) + ", true)::text");
    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + article + "'")).as("10 − 6 + 2").isEqualTo("6.00");
    assertThat(texte("SELECT quantity::text || ' ' || unit_cost::text FROM stock_movements WHERE reference_type = 'customer_return'"
            + " AND reference_id = '" + ret + "'"))
        .isEqualTo("2.00 5000");
    assertThat(texte("SELECT c.total::text || ' ' || c.amount_allocated::text FROM customer_returns r JOIN ar_credit_notes c"
            + " ON c.id = r.credit_note_id WHERE r.id = '" + ret + "'"))
        .as("2 × 12 000, imputé sur la facture")
        .isEqualTo("24000.00 24000.00");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ar_invoices WHERE dn_id = '" + dn + "'"))
        .isEqualTo("partially_paid 24000.00");

    assertThatThrownBy(() -> asUser("SELECT create_customer_return('" + dn + "', 'Trop', CURRENT_DATE, " + lignes(dn, 5) + ", false)::text"))
        .hasMessageContaining("reste 4");
    assertThatThrownBy(() -> asUser("SELECT create_customer_return('" + dn + "', ' ', CURRENT_DATE, " + lignes(dn, 1) + ", false)::text"))
        .hasMessageContaining("Motif");
  }

  @Test
  @DisplayName("brouillon issu de livraison : retour refusé tant qu'il existe ; supprimé, la livraison se refacture sans le retourné")
  void retourAvantFacturation() throws SQLException {
    String dn = livraison();
    assertThatThrownBy(() -> asUser("SELECT create_customer_return('" + dn + "', 'Casse', CURRENT_DATE, " + lignes(dn, 1) + ", false)::text"))
        .hasMessageContaining("encore en brouillon");

    asUser("DELETE FROM ar_invoices WHERE dn_id = '" + dn + "' AND status = 'draft' RETURNING id::text");
    assertThat(texte("SELECT (ar_invoice_id IS NULL)::text FROM delivery_notes WHERE id = '" + dn + "'"))
        .as("le brouillon supprimé libère la livraison")
        .isEqualTo("true");

    String ret = asUser("SELECT create_customer_return('" + dn + "', 'Refusé à la livraison', CURRENT_DATE, " + lignes(dn, 1) + ", true)::text");
    assertThat(texte("SELECT (credit_note_id IS NULL)::text FROM customer_returns WHERE id = '" + ret + "'"))
        .as("pas de facture émise : pas d'avoir")
        .isEqualTo("true");
    asUser("SELECT invoice_from_delivery('" + dn + "')::text");
    assertThat(texte("SELECT l.quantity::text || ' ' || i.subtotal::text FROM ar_invoices i JOIN ar_invoice_lines l ON l.invoice_id = i.id"
            + " WHERE i.dn_id = '" + dn + "'"))
        .as("refacturé : 6 livrés − 1 retourné")
        .isEqualTo("5.0000 60000.00");
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
