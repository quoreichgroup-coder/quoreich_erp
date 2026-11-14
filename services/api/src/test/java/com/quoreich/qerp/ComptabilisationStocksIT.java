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
 * V51 — comptabilisation des stocks par rôles (G-19) : en inventaire permanent, entrée = DR Stocks /
 * CR Variation des stocks, sortie = l'inverse, transfert = rien, et jamais le compte fournisseur ; rôle
 * manquant = refus QG001 ; inventaire intermittent = aucune écriture.
 */
@SpringBootTest
class ComptabilisationStocksIT {

  private static final String DATABASE = "qerp_it_stocks_gl";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
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
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  private static String article(String tenant, int stock, int cout) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost) VALUES ('" + id + "', '" + tenant
        + "', 'S-" + id.substring(0, 6) + "', 'Article stock', " + stock + ", " + cout + ");"
        + "INSERT INTO stock_valuation_layers (tenant_id, item_id, layer_date, qty_in, cost_in, qty_remaining) VALUES ('"
        + tenant + "', '" + id + "', CURRENT_DATE, " + stock + ", " + cout + ", " + stock + ")");
    return id;
  }

  private static String mouvement(String tenant, String user, String article, String type, int qte, int cout) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO stock_movements (id, tenant_id, item_id, movement_type, quantity, unit_cost, created_by) VALUES ('"
        + id + "', '" + tenant + "', '" + article + "', '" + type + "', " + qte + ", " + cout + ", '" + user + "')");
    return id;
  }

  /** « code débit/crédit » de chaque ligne de l'écriture du mouvement, ou null s'il n'y en a pas. */
  private static String ecriture(String mouvement) {
    return texte("SELECT string_agg(g.code || CASE WHEN l.debit > 0 THEN ' D ' || l.debit::text ELSE ' C ' || l.credit::text END,"
        + " ' | ' ORDER BY l.debit DESC) FROM stock_movements m JOIN journal_lines l ON l.entry_id = m.journal_entry_id"
        + " JOIN gl_accounts g ON g.id = l.account_id WHERE m.id = '" + mouvement + "'");
  }

  @Test
  @DisplayName("inventaire permanent : entrée 311/6031, sortie 6031/311, transfert sans écriture, jamais 401")
  void ecrituresParRoles() throws SQLException {
    String art = article(A, 10, 5000);

    String reception = mouvement(A, ADMIN, art, "receipt", 4, 3000);
    assertThat(ecriture(reception)).isEqualTo("311 D 12000.00 | 6031 C 12000.00");
    assertThat(texte("SELECT e.journal_code || ' ' || e.status FROM stock_movements m JOIN journal_entries e"
            + " ON e.id = m.journal_entry_id WHERE m.id = '" + reception + "'"))
        .isEqualTo("OD posted");

    String manquant = mouvement(A, ADMIN, art, "adjustment", -1, 5000);
    assertThat(ecriture(manquant)).isEqualTo("6031 D 5000.00 | 311 C 5000.00");

    assertThat(ecriture(mouvement(A, ADMIN, art, "transfer_out", -2, 5000))).as("transfert : même compte de stock").isNull();

    // Livraison client : sortie au coût moyen par post_delivery.
    String commande = UUID.randomUUID().toString(), ligne = UUID.randomUUID().toString();
    owner("INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total, status, created_by) VALUES ('" + commande
        + "', '" + A + "', 'SO-" + commande.substring(0, 6) + "', '" + CLIENT + "', 0, 'confirmed', '" + ADMIN + "');"
        + "INSERT INTO so_lines (id, so_id, item_id, description, quantity, unit_price) VALUES ('" + ligne + "', '"
        + commande + "', '" + art + "', 'Article stock', 3, 9000)");
    String dn = asUser("SELECT post_delivery('" + commande + "', jsonb_build_array(jsonb_build_object('so_line_id', '" + ligne
        + "', 'quantity', 3)))::text");
    String sortie = texte("SELECT id::text FROM stock_movements WHERE reference_type = 'delivery_note' AND reference_id = '" + dn + "'");
    assertThat(ecriture(sortie)).startsWith("6031 D ").contains("| 311 C ");

    assertThat(texte("SELECT count(*)::text FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id"
            + " JOIN gl_accounts g ON g.id = l.account_id WHERE e.tenant_id = '" + A + "' AND e.source = 'stock_movement'"
            + " AND g.code NOT IN ('311', '6031')"))
        .as("aucun mouvement de stock ne touche le compte fournisseur ni un autre compte")
        .isEqualTo("0");
  }

  @Test
  @DisplayName("rôle de stock manquant : refus QG001 ; inventaire intermittent : mouvement accepté, aucune écriture")
  void roleManquantEtIntermittent() {
    String art = article(B, 5, 1000);
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + B + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true");
    assertThatThrownBy(() -> mouvement(B, PostgresFixture.BETA_USER, art, "receipt", 2, 1000))
        .hasStackTraceContaining("Paramétrage comptable incomplet")
        .hasStackTraceContaining("Stocks de marchandises");

    owner("UPDATE inventory_settings SET auto_je_on_movement = false WHERE tenant_id = '" + B + "'");
    String m = mouvement(B, PostgresFixture.BETA_USER, art, "receipt", 2, 1000);
    assertThat(ecriture(m)).isNull();
    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + art + "'")).isEqualTo("7.00");
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
