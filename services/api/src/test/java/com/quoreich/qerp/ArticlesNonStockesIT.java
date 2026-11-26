package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V140 — articles non stockés et services : réception partielle d'un service (avancement) sans mouvement de stock, à côté
 * d'un article stocké ; seuils et réapprovisionnement refusés, ajustement refusé, type figé tant qu'il y a du stock ;
 * « service fait » attesté par une autre personne que l'auteur de la commande quand la société l'exige.
 */
@SpringBootTest
class ArticlesNonStockesIT {

  private static final String DATABASE = "qerp_it_articles_non_stockes";
  private static final String T = "33333333-3333-3333-3333-333333333140";
  private static final String U = "cccccccc-0000-0000-0000-000000000140";

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

  /** Membre au nom duquel agit asUser (administrateur par défaut). */
  private static String who = U;
  private static final String U2 = "22222222-2222-2222-2222-222222222140";

  private static String asUser(String sql) throws SQLException {
    return asUser(who, sql);
  }

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
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


  private static final String F = "00000000-0000-0000-0000-0000000f0140";
  private static final String SVC = "00000000-0000-0000-0000-0000000a1140";
  private static final String STK = "00000000-0000-0000-0000-0000000a2140";
  private static final String NS = "00000000-0000-0000-0000-0000000a3140";
  private static final String WH = "00000000-0000-0000-0000-0000000c0140";
  private static final String PO = "00000000-0000-0000-0000-00000000d140";

  private String recevoir(String gr, String qsvc, String qstk) throws SQLException {
    asUser("INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by, warehouse_id, status) VALUES ('" + gr + "', '" + T + "', 'GR-" + gr.substring(30)
        + "', '" + PO + "', CURRENT_DATE, auth.uid(), '" + WH + "', 'pending') RETURNING id::text");
    asUser("INSERT INTO gr_lines (gr_id, po_line_id, item_id, quantity_received) SELECT '" + gr + "', id, item_id, CASE WHEN item_id = '" + SVC + "' THEN " + qsvc + " ELSE " + qstk + " END"
        + " FROM po_lines WHERE po_id = '" + PO + "' RETURNING gr_id::text");
    return asUser("UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr + "' RETURNING status");
  }

  @Test
  @DisplayName("service reçu par avancement sans stock, gestes de stock refusés, service fait par un tiers")
  void servicesEtNonStockes() throws Exception {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société V140') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "'), ('" + U2 + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur'), ('" + U2 + "', '" + T + "', 'Demandeur') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Prestataire V140');"
        + "INSERT INTO warehouses (id, tenant_id, code, name) VALUES ('" + WH + "', '" + T + "', 'DEP', 'Dépôt');"
        + "INSERT INTO items (id, tenant_id, code, name, item_type) VALUES ('" + SVC + "', '" + T + "', 'MAINT', 'Maintenance annuelle', 'service'), ('" + STK + "', '" + T + "', 'CART', 'Cartouche', 'stock'), ('" + NS + "', '" + T + "', 'NS', 'Consommable en charge', 'non_stock');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + PO + "', '" + T + "', 'PO-140', '" + F + "', CURRENT_DATE, 'approved', '" + U + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + PO + "', '" + SVC + "', 'Maintenance annuelle', 1, 1200000), ('" + PO + "', '" + STK + "', 'Cartouche', 10, 15000), ('" + PO + "', '" + NS + "', 'Consommable en charge', 10, 1000)");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    PostgresFixture.grantRoles(DATABASE, U2, "procurement_controller", T);
    owner("INSERT INTO procurement_settings (tenant_id, grni_on_receipt) VALUES ('" + T + "', true) ON CONFLICT (tenant_id) DO UPDATE SET grni_on_receipt = true");

    assertThat(texte("SELECT count(*) FROM inventory_campaign_open_items('" + T + "', '" + WH + "', 'all_active') WHERE item_id = '" + SVC + "'"))
        .as("un service ne se compte pas en inventaire").isEqualTo("0");
    assertThat(texte("SELECT count(*) FROM stock_projection_view WHERE item_id = '" + SVC + "'"))
        .as("un service ne se réapprovisionne pas").isEqualTo("0");
    assertThat(texte("SELECT out_of_stock_items FROM inventory_kpis_view WHERE tenant_id = '" + T + "'"))
        .as("seule la cartouche est en rupture").isEqualTo("1");
    assertThat(texte("SELECT sum(items_count) FROM inventory_valuation_by_category_view WHERE tenant_id = '" + T + "'"))
        .as("seule la cartouche appartient a la valorisation du stock").isEqualTo("1");

    // Une règle existante ne doit pas subsister après le passage au type non stocké.
    owner("INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, order_qty) VALUES ('" + T + "', '" + STK + "', 'reorder_point', 1, 1)");
    assertThatThrownBy(() -> asUser("UPDATE items SET item_type = 'non_stock' WHERE id = '" + STK + "' RETURNING id::text"))
        .hasMessageContaining("réapprovisionnement");
    owner("DELETE FROM item_replenishment_rules WHERE item_id = '" + STK + "'");
    owner("INSERT INTO warehouses (id, tenant_id, code, name) VALUES ('00000000-0000-0000-0000-0000000c1140', '" + T + "', 'DEP2', 'Depot 2');"
        + "INSERT INTO item_locations (tenant_id, item_id, warehouse_id, quantity_on_hand) VALUES ('" + T + "', '" + STK + "', '" + WH + "', 5),"
        + " ('" + T + "', '" + STK + "', '00000000-0000-0000-0000-0000000c1140', -5)");
    assertThatThrownBy(() -> asUser("UPDATE items SET item_type = 'service' WHERE id = '" + STK + "' RETURNING id::text"))
        .as("stock global nul mais quantites restantes dans les depots").hasMessageContaining("soldé");
    owner("DELETE FROM item_locations WHERE item_id = '" + STK + "'");
    assertThatThrownBy(() -> asUser("INSERT INTO item_locations (tenant_id, item_id, warehouse_id, quantity_on_hand) VALUES ('" + T + "', '" + SVC + "', '" + WH + "', 1) RETURNING item_id::text"))
        .as("pas de stock de service par ecriture directe en depot").hasMessageContaining("non stocké");

    // Service à 30 % et 4 cartouches : un seul mouvement de stock, celui de l'article stocké.
    recevoir("00000000-0000-0000-0000-0000000e1140", "0.3", "4");
    assertThat(texte("SELECT string_agg(i.code || ':' || m.quantity::int, ' ') FROM stock_movements m JOIN items i ON i.id = m.item_id WHERE m.tenant_id = '" + T + "'"))
        .isEqualTo("CART:4");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + PO + "'")).isEqualTo("partially_received");
    assertThat(texte("SELECT quantity_on_hand::int FROM items WHERE id = '" + SVC + "'")).isEqualTo("0");
    assertThat(texte("SELECT quantity_on_hand::int FROM items WHERE id = '" + NS + "'")).isEqualTo("0");
    assertThat(texte("SELECT sum(g.amount)::numeric(18,2)::text FROM grni_ledger g JOIN po_lines p ON p.id = g.po_line_id WHERE p.item_id = '" + SVC + "'"))
        .as("le service fait reste valorisé en facture non parvenue").isEqualTo("360000.00");

    // Gestes de stock et seuils refusés sur un service ; type figé tant qu'il y a du stock.
    assertThatThrownBy(() -> asUser("UPDATE items SET reorder_level = 5 WHERE id = '" + SVC + "' RETURNING id::text")).hasMessageContaining("non stocké");
    assertThatThrownBy(() -> asUser("SELECT create_stock_adjustment('" + SVC + "', '" + WH + "', 2, 1000, CURRENT_DATE, 'Essai')::text")).hasMessageContaining("pas de mouvement de stock");
    assertThatThrownBy(() -> asUser("INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, order_qty) VALUES ('" + T + "', '" + SVC + "', 'reorder_point', 1, 1) RETURNING id::text"))
        .hasMessageContaining("non stocké");
    assertThatThrownBy(() -> asUser("UPDATE items SET item_type = 'service' WHERE id = '" + STK + "' RETURNING id::text")).hasMessageContaining("soldé");

    // « Service fait » par une autre personne que l'acheteur, quand la société l'exige.
    owner("INSERT INTO procurement_settings (tenant_id, service_acceptance_second_person) VALUES ('" + T + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET service_acceptance_second_person = true");
    assertThatThrownBy(() -> recevoir("00000000-0000-0000-0000-0000000e2140", "0.7", "0")).hasMessageContaining("autre personne");
    owner("INSERT INTO inventory_campaigns (tenant_id, warehouse_id, opened_by) VALUES ('" + T + "', '" + WH + "', '" + U + "')");
    who = U2;
    assertThat(recevoir("00000000-0000-0000-0000-0000000e3140", "0.7", "0"))
        .as("un depot gele pour inventaire ne bloque pas un service sans effet de stock").isEqualTo("completed");
    assertThat(texte("SELECT sum(quantity_received)::text FROM gr_lines gl JOIN goods_receipts g ON g.id = gl.gr_id WHERE g.status = 'completed' AND gl.item_id = '" + SVC + "'"))
        .as("service reçu à 100 %").isEqualTo("1.0");
    typeChangeDuringAcceptance();
  }

  private void typeChangeDuringAcceptance() throws Exception {
    String item = "00000000-0000-0000-0000-0000000a4140";
    String po = "00000000-0000-0000-0000-00000000d240";
    String gr = "00000000-0000-0000-0000-0000000e4140";
    owner("INSERT INTO items (id, tenant_id, code, name) VALUES ('" + item + "', '" + T + "', 'RACE', 'Service a classifier');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + po + "', '" + T + "', 'PO-RACE', '" + F + "', CURRENT_DATE, 'approved', '" + U + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + po + "', '" + item + "', 'Prestation', 1, 1000);"
        + "INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by, status) VALUES ('" + gr + "', '" + T + "', 'GR-RACE', '" + po + "', CURRENT_DATE, '" + U + "', 'pending');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, item_id, quantity_received) SELECT '" + gr + "', id, item_id, 1 FROM po_lines WHERE po_id = '" + po + "'");
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD)) {
      c.setAutoCommit(false);
      c.createStatement().executeUpdate("UPDATE items SET item_type = 'service' WHERE id = '" + item + "'");
      CompletableFuture<String> result = CompletableFuture.supplyAsync(() -> {
        try {
          return asUser(U, "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr + "' RETURNING status");
        } catch (SQLException e) {
          return e.getSQLState();
        }
      });
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      boolean waiting;
      do {
        waiting = "1".equals(texte("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%" + gr + "%'"));
        if (!waiting) Thread.sleep(25);
      } while (!waiting && System.nanoTime() < deadline);
      c.commit();
      assertThat(waiting).as("validation bloquee pendant le changement de type concurrent").isTrue();
      assertThat(result.get(10, TimeUnit.SECONDS)).as("la nouvelle nature service exige le second intervenant").isEqualTo("QG037");
      assertThat(texte("SELECT status FROM goods_receipts WHERE id = '" + gr + "'")).isEqualTo("pending");
    }
  }
}
