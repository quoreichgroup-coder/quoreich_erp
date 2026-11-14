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
 * V53 — stocks : un lecteur n'écrit ni mouvement, ni article, ni paramètre ; quantité et coût moyen
 * ne se saisissent pas ; ajustement motivé par fonction ; transfert limité à la société ;
 * inventaire valorisé au coût moyen avec un attendu recalculé.
 */
@SpringBootTest
class StocksSecurisationIT {

  private static final String DATABASE = "qerp_it_stocks_securite";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000005b3";
  private static final String MAGASINIER = "aaaaaaaa-0000-0000-0000-0000000005b4";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "'), ('" + MAGASINIER + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur'), ('"
        + MAGASINIER + "', '" + A + "', 'Magasinier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, LECTEUR, "viewer", A, MAGASINIER, "inventory_clerk", A);
  }

  private static String article(String tenant, int stock, int cout) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost) VALUES ('" + id + "', '" + tenant
        + "', 'K-" + id.substring(0, 6) + "', 'Article V53', " + stock + ", " + cout + ")");
    return id;
  }

  private static String depot(String tenant) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO warehouses (id, tenant_id, code, name) VALUES ('" + id + "', '" + tenant + "', 'D-" + id.substring(0, 5)
        + "', 'Dépôt V53')");
    return id;
  }

  @Test
  @DisplayName("lecteur : aucun mouvement, aucune couche, aucun article, aucun paramètre ; quantité et coût moyen non saisissables")
  void ecrituresDirectesFermees() throws SQLException {
    String art = article(A, 10, 1000);
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost,"
            + " created_by) VALUES ('" + A + "', '" + art + "', 'receipt', 5, 1000, '" + LECTEUR + "') RETURNING id::text"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(ADMIN, "DELETE FROM stock_movements WHERE tenant_id = '" + A + "' RETURNING id::text"))
        .as("même l'administrateur ne supprime pas un mouvement").hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE stock_valuation_layers SET cost_in = 1 RETURNING id::text"))
        .hasMessageContaining("permission denied");
    assertThat(asUser(LECTEUR, "WITH u AS (UPDATE items SET name = 'x' WHERE id = '" + art + "' RETURNING 1) SELECT count(*)::text FROM u"))
        .as("lecteur : modification filtrée par la politique").isEqualTo("0");
    assertThatThrownBy(() -> asUser(MAGASINIER, "UPDATE items SET quantity_on_hand = 999 WHERE id = '" + art + "' RETURNING id::text"))
        .hasMessageContaining("résultent des mouvements");
    assertThatThrownBy(() -> asUser(MAGASINIER, "INSERT INTO items (tenant_id, code, name, quantity_on_hand) VALUES ('" + A
            + "', 'K-NEUF', 'Neuf', 50) RETURNING id::text"))
        .hasMessageContaining("sans stock");
    assertThat(asUser(MAGASINIER, "UPDATE items SET name = 'Article renommé' WHERE id = '" + art + "' RETURNING name"))
        .isEqualTo("Article renommé");
    assertThat(asUser(MAGASINIER, "WITH u AS (UPDATE inventory_settings SET auto_je_on_movement = false WHERE tenant_id = '" + A
            + "' RETURNING 1) SELECT count(*)::text FROM u"))
        .as("paramètres de stock : administrateur seulement").isEqualTo("0");
  }

  @Test
  @DisplayName("ajustement motivé (droit inventory.adjust), sortie au coût moyen ; transfert limité aux dépôts de la société")
  void ajustementEtTransfert() throws SQLException {
    String art = article(A, 10, 1000);
    String wh = depot(A), wh2 = depot(A), autre = depot(B);
    assertThatThrownBy(() -> asUser(MAGASINIER, "SELECT create_stock_adjustment('" + art + "', '" + wh + "', -2, 0, CURRENT_DATE, 'Casse')::text"))
        .as("le magasinier n'ajuste pas").hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT create_stock_adjustment('" + art + "', '" + wh + "', -2, 0, CURRENT_DATE, ' ')::text"))
        .hasMessageContaining("Motif");
    String m = asUser(ADMIN, "SELECT create_stock_adjustment('" + art + "', '" + wh + "', -2, 5000, CURRENT_DATE, 'Casse en rayon')::text");
    assertThat(texte("SELECT quantity::text || ' ' || unit_cost::text || ' ' || reason FROM stock_movements WHERE id = '" + m + "'"))
        .as("sortie au coût moyen, pas au coût saisi").isEqualTo("-2.00 1000 Casse en rayon");
    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + art + "'")).isEqualTo("8.00");
    assertThat(texte("SELECT count(*)::text FROM journal_lines l JOIN stock_movements s ON s.journal_entry_id = l.entry_id WHERE s.id = '" + m + "'"))
        .isEqualTo("2");

    assertThatThrownBy(() -> asUser(MAGASINIER, "SELECT transfer_stock('" + art + "', '" + wh + "', '" + autre + "', 1, null)::text"))
        .as("dépôt d'une autre société").hasMessageContaining("Dépôt introuvable");
    String artB = article(B, 5, 100);
    assertThatThrownBy(() -> asUser(MAGASINIER, "SELECT transfer_stock('" + artB + "', '" + wh + "', '" + wh2 + "', 1, null)::text"))
        .as("article d'une autre société").hasMessageContaining("Article introuvable");
    asUser(MAGASINIER, "SELECT transfer_stock('" + art + "', '" + wh + "', '" + wh2 + "', 3, 'Réassort')::text");
    assertThat(texte("SELECT count(*)::text || ' ' || count(journal_entry_id)::text FROM stock_movements WHERE item_id = '" + art
            + "' AND movement_type LIKE 'transfer%'"))
        .as("deux mouvements, aucune écriture").isEqualTo("2 0");
    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + art + "'")).isEqualTo("8.00");
  }

  @Test
  @DisplayName("inventaire : attendu recalculé à la validation, coût moyen imposé, comptage validé figé")
  void inventaire() throws SQLException {
    String art = article(A, 10, 1000);
    String count = UUID.randomUUID().toString();
    asUser(MAGASINIER, "INSERT INTO inventory_counts (id, tenant_id, count_number, status, created_by) VALUES ('" + count + "', '"
        + A + "', 'INV-" + count.substring(0, 5) + "', 'draft', '" + MAGASINIER + "') RETURNING id::text");
    asUser(MAGASINIER, "INSERT INTO inventory_count_lines (count_id, item_id, expected_qty, counted_qty, unit_cost) VALUES ('"
        + count + "', '" + art + "', 100, 7, 99999) RETURNING id::text");
    assertThatThrownBy(() -> asUser(MAGASINIER, "SELECT post_inventory_count('" + count + "')::text"))
        .as("le magasinier compte, il ne valide pas").hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(MAGASINIER, "UPDATE inventory_counts SET status = 'posted' WHERE id = '" + count + "' RETURNING id::text"))
        .hasMessageContaining("Valider l'inventaire");
    asUser(ADMIN, "SELECT post_inventory_count('" + count + "')::text");
    assertThat(texte("SELECT quantity::text || ' ' || unit_cost::text FROM stock_movements WHERE reference_id = '" + count + "'"))
        .as("7 comptés − 10 en stock (et non 100 saisis), au coût moyen (et non 99 999)").isEqualTo("-3.00 1000");
    assertThat(texte("SELECT expected_qty::text || ' ' || variance_value::text FROM inventory_count_lines WHERE count_id = '" + count + "'"))
        .isEqualTo("10.00 -3000.00");
    assertThatThrownBy(() -> asUser(MAGASINIER, "UPDATE inventory_count_lines SET counted_qty = 1 WHERE count_id = '" + count + "' RETURNING id::text"))
        .hasMessageContaining("validé");
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
