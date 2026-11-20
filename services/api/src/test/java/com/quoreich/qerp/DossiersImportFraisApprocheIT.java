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
 * V129 — dossier d'importation : numéro, types de frais créés au premier dossier, estimation des droits UEMOA (DD selon la
 * catégorie TEC, RS, PCS, PC, TVA import sur CAF + droits), répartition des frais à la valeur et à la quantité sur les
 * lignes reçues, part en stock au prorata du stock restant (coût moyen relevé, écriture 311 / 6031), part consommée en
 * charges, base au poids refusée sans poids, dossier figé après répartition puis clos.
 */
@SpringBootTest
class DossiersImportFraisApprocheIT {

  private static final String DATABASE = "qerp_it_dossiers_import";
  private static final String T = "33333333-3333-3333-3333-333333333129";
  private static final String U = "cccccccc-0000-0000-0000-000000000129";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0129";
  private static final String A = "00000000-0000-0000-0000-0000000a0129";
  private static final String B = "00000000-0000-0000-0000-0000000b0129";
  private static final String PO = "00000000-0000-0000-0000-00000000d129";
  private static final String GR = "00000000-0000-0000-0000-00000000e129";

  private static String type(String code) {
    return texte("SELECT id::text FROM landed_cost_types WHERE tenant_id = '" + T + "' AND code = '" + code + "'");
  }

  @Test
  @DisplayName("dossier d'import : droits estimés, frais répartis, coût moyen relevé, écriture 311 / 6031, dossier figé")
  void dossierImport() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Importateur V129') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur V129') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Fournisseur Chine V129') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + T + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true;"
        + "INSERT INTO items (id, tenant_id, code, name) VALUES ('" + A + "', '" + T + "', 'A-129', 'Pompe'), ('" + B + "', '" + T + "', 'B-129', 'Moteur');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + PO + "', '" + T + "', 'PO-129', '" + F + "', '2031-03-01', 'approved', '" + U + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + PO + "', '" + A + "', 'Pompe', 10, 1000), ('" + PO + "', '" + B + "', 'Moteur', 5, 2000);"
        + "INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by) VALUES ('" + GR + "', '" + T + "', 'GR-129', '" + PO + "', '2031-04-01', '" + U + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, item_id, quantity_received) SELECT '" + GR + "', id, item_id, quantity FROM po_lines WHERE po_id = '" + PO + "';"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + GR + "';"
        // 4 pompes déjà consommées avant l'arrivée des frais.
        + "INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date, status, reason, created_by) VALUES ('" + T + "', '" + A + "', 'adjustment', -4, 1000, '2031-04-10', 'posted', 'Consommation', '" + U + "')");
    assertThat(texte("SELECT quantity_on_hand::int || ' ' || average_cost::int FROM items WHERE id = '" + A + "'")).isEqualTo("6 1000");

    // Dossier : numéro et types de frais par défaut ; commande rattachée.
    String dossier = asUser("INSERT INTO import_files (tenant_id, supplier_id, incoterm, transport_mode, destination_country, tec_category)"
        + " VALUES ('" + T + "', '" + F + "', 'FOB', 'sea', 'BF', 10) RETURNING id::text");
    assertThat(texte("SELECT file_number LIKE 'IMP-%' FROM import_files WHERE id = '" + dossier + "'")).isEqualTo("t");
    assertThat(texte("SELECT count(*)::text FROM landed_cost_types WHERE tenant_id = '" + T + "'")).isEqualTo("8");
    asUser("INSERT INTO import_file_orders (import_file_id, po_id) VALUES ('" + dossier + "', '" + PO + "') RETURNING po_id::text");

    // Droits et taxes estimés sur une valeur CAF de 1 000 000 (catégorie TEC 10 %).
    assertThat(asUser("SELECT string_agg(code || ':' || amount::bigint, ' ' ORDER BY code) FROM customs_estimate('BF', 10, 1000000)"))
        .isEqualTo("DD:100000 PC:5000 PCS:8000 RS:10000 TVA:202140");

    // Base au poids sans poids sur les articles : refus explicite.
    String poids = asUser("INSERT INTO import_file_costs (import_file_id, cost_type_id, amount, allocation_basis) VALUES ('" + dossier + "', '" + type("FRET") + "', 500, 'weight') RETURNING id::text");
    assertThatThrownBy(() -> asUser("SELECT allocate_import_costs('" + dossier + "', '2031-04-15')::text")).hasMessageContaining("renseignez le poids");
    asUser("DELETE FROM import_file_costs WHERE id = '" + poids + "' RETURNING id::text");

    // Fret et droit à la valeur (10 000 / 10 000), manutention à la quantité (10 / 5).
    asUser("INSERT INTO import_file_costs (import_file_id, cost_type_id, amount) VALUES ('" + dossier + "', '" + type("FRET") + "', 20000),"
        + " ('" + dossier + "', '" + type("MANUT") + "', 3000), ('" + dossier + "', '" + type("DD") + "', 4000) RETURNING id::text");
    String r = asUser("SELECT allocate_import_costs('" + dossier + "', '2031-04-15')::text");
    assertThat(r).contains("\"to_stock\": 21400", "\"to_expense\": 5600");
    // Pompe : 14 000 répartis, 6 sur 10 encore en stock → 8 400 au stock, coût moyen (6 × 1 000 + 8 400) / 6 = 2 400.
    assertThat(texte("SELECT average_cost::int::text FROM items WHERE id = '" + A + "'")).isEqualTo("2400");
    assertThat(texte("SELECT average_cost::int::text FROM items WHERE id = '" + B + "'")).isEqualTo("4600");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE l.entry_id = (SELECT allocation_entry_id FROM import_files WHERE id = '" + dossier + "')")).isEqualTo("311:21400/0 6031:0/21400");

    // Dossier figé : ni frais ni modification ; la clôture reste possible.
    assertThatThrownBy(() -> asUser("INSERT INTO import_file_costs (import_file_id, cost_type_id, amount) VALUES ('" + dossier + "', '" + type("FRET") + "', 1) RETURNING id::text"))
        .hasMessageContaining("figés");
    assertThatThrownBy(() -> asUser("UPDATE import_files SET bill_of_lading = 'X' WHERE id = '" + dossier + "' RETURNING id::text")).hasMessageContaining("ne se modifie plus");
    assertThat(asUser("UPDATE import_files SET status = 'closed' WHERE id = '" + dossier + "' RETURNING status")).isEqualTo("closed");
  }
}
