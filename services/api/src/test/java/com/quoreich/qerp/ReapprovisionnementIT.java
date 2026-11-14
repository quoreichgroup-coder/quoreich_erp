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
 * V54 — réapprovisionnement : alerte au point de commande (et non au stock de sécurité), stock
 * prévisionnel (commandé, réservé), propositions arrondies au multiple du fournisseur préféré, sans
 * doublon, converties en demande d'achat ; droits et périmètre de la société.
 */
@SpringBootTest
class ReapprovisionnementIT {

  private static final String DATABASE = "qerp_it_reappro";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000005c4";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0541";
  private static final String CLIENT = "c0000003-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V54') ON CONFLICT (id) DO NOTHING;"
        + "DELETE FROM replenishment_proposals WHERE tenant_id = '" + A + "';"
        + "DELETE FROM item_replenishment_rules WHERE tenant_id = '" + A + "'");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, LECTEUR, "viewer", A);
  }

  private static String article(String tenant, int stock, int seuil, int securite) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost, reorder_level, safety_stock) VALUES ('" + id
        + "', '" + tenant + "', 'R-" + id.substring(0, 6) + "', 'Article V54', " + stock + ", 1000, " + seuil + ", " + securite + ")");
    return id;
  }

  @Test
  @DisplayName("alerte au point de commande : stock 8, seuil 10, sécurité 3 → alerté (avant V54 : seuil pris = 3, rien)")
  void alerteAuPointDeCommande() {
    String art = article(A, 8, 10, 3);
    assertThat(texte("SELECT threshold::text || ' ' || gap::text || ' ' || below_safety::text FROM low_stock_alerts_view WHERE item_id = '" + art + "'"))
        .isEqualTo("10.00 2.00 false");
  }

  @Test
  @DisplayName("min / max : prévisionnel = stock + commandé − réservé ; quantité au multiple du préféré ; pas de doublon ; conversion en demande")
  void propositionEtConversion() throws SQLException {
    String art = article(A, 8, 0, 0);
    String repos = article(A, 100, 0, 0);
    String po = UUID.randomUUID().toString(), so = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES ('" + po + "', '" + A
        + "', 'PO-" + po.substring(0, 6) + "', '" + FOURNISSEUR + "', 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + po + "', '" + art + "', 'x', 6, 900);"
        + "INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total, status, created_by) VALUES ('" + so + "', '" + A
        + "', 'SO-" + so.substring(0, 6) + "', '" + CLIENT + "', 0, 'confirmed', '" + ADMIN + "');"
        + "INSERT INTO so_lines (so_id, item_id, description, quantity, unit_price) VALUES ('" + so + "', '" + art + "', 'x', 4, 2000)");

    asUser(ADMIN, "INSERT INTO supplier_items (tenant_id, supplier_id, item_id, unit_price, lead_time_days, order_multiple, is_preferred)"
        + " VALUES ('" + A + "', '" + FOURNISSEUR + "', '" + art + "', 950, 7, 12, true) RETURNING id::text");
    asUser(ADMIN, "INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, max_qty) VALUES ('" + A + "', '"
        + art + "', 'min_max', 10, 50) RETURNING id::text");
    asUser(ADMIN, "INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, order_qty) VALUES ('" + A + "', '"
        + repos + "', 'reorder_point', 10, 25) RETURNING id::text");

    assertThat(texte("SELECT on_hand::text || ' ' || on_order::text || ' ' || reserved::text || ' ' || projected::text"
            + " FROM stock_projection_view WHERE item_id = '" + art + "'"))
        .isEqualTo("8.00 6 4 10.00");
    assertThat(asUser(ADMIN, "SELECT generate_replenishment_proposals()::text")).as("seul l'article sous son seuil").isEqualTo("1");
    assertThat(asUser(ADMIN, "SELECT generate_replenishment_proposals()::text")).isEqualTo("1");
    assertThat(texte("SELECT count(*)::text || ' ' || min(quantity)::text || ' ' || min(unit_price)::text || ' ' || (min(needed_by) = CURRENT_DATE + 7)::text"
            + " FROM replenishment_proposals WHERE tenant_id = '" + A + "' AND status = 'proposed'"))
        .as("50 − 10 = 40, arrondi au multiple de 12 ; recalcul sans doublon").isEqualTo("1 48 950.0000 true");

    String prop = texte("SELECT id::text FROM replenishment_proposals WHERE tenant_id = '" + A + "' AND status = 'proposed'");
    assertThat(asUser(ADMIN, "SELECT convert_replenishment_proposals(ARRAY['" + prop + "']::uuid[])::text")).isEqualTo("1");
    assertThat(texte("SELECT r.status || ' ' || l.quantity::text || ' ' || l.estimated_unit_cost::text || ' ' || (r.description LIKE '%Fournisseur V54%')::text"
            + " FROM replenishment_proposals p JOIN purchase_requisitions r ON r.id = p.requisition_id"
            + " JOIN requisition_lines l ON l.requisition_id = r.id WHERE p.id = '" + prop + "'"))
        .isEqualTo("draft 48 950.0000 true");
    assertThat(asUser(ADMIN, "SELECT generate_replenishment_proposals()::text"))
        .as("la demande ouverte compte dans le commandé : plus de besoin").isEqualTo("0");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT convert_replenishment_proposals(ARRAY['" + prop + "']::uuid[])::text"))
        .hasMessageContaining("déjà traitée");
  }

  @Test
  @DisplayName("droits : lecteur ni catalogue ni calcul ; article d'une autre société refusé ; écarter demande un motif")
  void droitsEtPerimetre() throws SQLException {
    String art = article(A, 1, 0, 0);
    String artB = article(B, 1, 0, 0);
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO supplier_items (tenant_id, supplier_id, item_id) VALUES ('" + A + "', '"
            + FOURNISSEUR + "', '" + art + "') RETURNING id::text"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT generate_replenishment_proposals()::text")).hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, order_qty)"
            + " VALUES ('" + A + "', '" + artB + "', 'reorder_point', 5, 10) RETURNING id::text"))
        .as("article d'une autre société : refusé par l'isolation des sociétés (V55)").hasMessageContaining("Isolation des sociétés");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, max_qty)"
            + " VALUES ('" + A + "', '" + art + "', 'min_max', 10, 5) RETURNING id::text"))
        .as("maximum sous le point de commande").hasMessageContaining("replenishment_rule_quantities");

    asUser(ADMIN, "INSERT INTO item_replenishment_rules (tenant_id, item_id, method, reorder_point, order_qty) VALUES ('" + A + "', '"
        + art + "', 'reorder_point', 5, 10) RETURNING id::text");
    asUser(ADMIN, "SELECT generate_replenishment_proposals()::text");
    String prop = texte("SELECT id::text FROM replenishment_proposals WHERE item_id = '" + art + "' AND status = 'proposed'");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT dismiss_replenishment_proposal('" + prop + "', ' ')::text")).hasMessageContaining("Motif");
    asUser(ADMIN, "SELECT dismiss_replenishment_proposal('" + prop + "', 'Article en fin de vie')::text");
    assertThat(texte("SELECT status || ' ' || dismiss_reason || ' ' || (supplier_id IS NULL)::text FROM replenishment_proposals WHERE id = '" + prop + "'"))
        .isEqualTo("dismissed Article en fin de vie true");
  }

  // ─── Outils ───

  private static String asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
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
