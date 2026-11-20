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
 * V132 — procédure Sage 300 « commandes internationales » automatisée : réception en dépôt de consolidation (381),
 * numéro d'expédition ANNÉE-TRANSITAIRE-MODE-NNN à séquence continue, frais estimés par règles puis réels (seuls les
 * réels se répartissent), commande de transport créée depuis le dossier, transfert de transit en un clic (consolidation →
 * transit → dépôt, reclassement 381 → 311), transfert déclenché par l'événement réel « départ ».
 */
@SpringBootTest
class ProcessusImportSansExcelIT {

  private static final String DATABASE = "qerp_it_processus_import";
  private static final String T = "33333333-3333-3333-3333-333333333132";
  private static final String U = "cccccccc-0000-0000-0000-000000000132";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0132";
  private static final String FW = "00000000-0000-0000-0000-0000000f1132";
  private static final String A = "00000000-0000-0000-0000-0000000a0132";
  private static final String CONSO = "00000000-0000-0000-0000-0000000c0132";
  private static final String TRANSIT = "00000000-0000-0000-0000-0000000c1132";
  private static final String MAIN = "00000000-0000-0000-0000-0000000c2132";

  private static void commandeRecue(String po, String gr, int qty) {
    owner("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + po + "', '" + T + "', 'PO-" + po.substring(30)
        + "', '" + F + "', '2031-03-01', 'approved', '" + U + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + po + "', '" + A + "', 'Pompe', " + qty + ", 1000);"
        + "INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by, warehouse_id) VALUES ('" + gr + "', '" + T + "', 'GR-" + gr.substring(30)
        + "', '" + po + "', '2031-04-01', '" + U + "', '" + CONSO + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, item_id, quantity_received) SELECT '" + gr + "', id, item_id, quantity FROM po_lines WHERE po_id = '" + po + "';"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr + "'");
  }

  private static String stock(String wh) {
    return texte("SELECT COALESCE((SELECT quantity_on_hand::int::text FROM item_locations WHERE item_id = '" + A + "' AND warehouse_id = '" + wh + "'), '0')");
  }

  @Test
  @DisplayName("consolidation en 381, numéro d'expédition, frais estimés / réels, commande de transport, transit en un clic")
  void processusImport() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Importateur V132') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur V132') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Usine Ningbo'), ('" + FW + "', '" + T + "', 'Bolloré Logistics') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + T + "', true) ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true;"
        + "INSERT INTO items (id, tenant_id, code, name) VALUES ('" + A + "', '" + T + "', 'A-132', 'Pompe');"
        + "INSERT INTO warehouses (id, tenant_id, code, name, kind, country) VALUES ('" + CONSO + "', '" + T + "', 'CONSO-CN', 'Consolidation Ningbo', 'consolidation', 'CN'),"
        + " ('" + TRANSIT + "', '" + T + "', 'TRANSIT', 'En mer', 'transit', NULL), ('" + MAIN + "', '" + T + "', 'OUAGA', 'Dépôt Ouagadougou', 'standard', 'BF');"
        + "INSERT INTO import_settings (tenant_id, number_format, last_sequence, default_transit_warehouse_id, default_destination_warehouse_id)"
        + " VALUES ('" + T + "', '{YYYY}-{FWD}-{MODE}-{SEQ3}', 11, '" + TRANSIT + "', '" + MAIN + "')");

    // Réception au dépôt de consolidation : stock en 381, pas en 311.
    commandeRecue("00000000-0000-0000-0000-00000000d132", "00000000-0000-0000-0000-00000000e132", 10);
    assertThat(stock(CONSO)).isEqualTo("10");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM stock_movements m"
        + " JOIN journal_lines l ON l.entry_id = m.journal_entry_id JOIN gl_accounts g ON g.id = l.account_id WHERE m.reference_id = '00000000-0000-0000-0000-00000000e132'"))
        .isEqualTo("381:10000/0 6031:0/10000");

    // Numéro d'expédition au format de la société, séquence continue ; dépôts par défaut repris.
    String file = asUser("INSERT INTO import_files (tenant_id, supplier_id, forwarder_id, transport_mode) VALUES ('" + T + "', '" + F + "', '" + FW + "', 'sea') RETURNING id::text");
    String annee = texte("SELECT to_char(CURRENT_DATE, 'YYYY')");
    assertThat(texte("SELECT file_number || ' ' || (transit_warehouse_id = '" + TRANSIT + "') FROM import_files WHERE id = '" + file + "'")).isEqualTo(annee + "-BOL-MER-012 true");
    asUser("INSERT INTO import_file_orders (import_file_id, po_id) VALUES ('" + file + "', '00000000-0000-0000-0000-00000000d132') RETURNING po_id::text");

    // Frais estimés par règle (5 % de la valeur), refus de répartir des estimations, frais réel, comparaison.
    String fret = texte("SELECT id::text FROM landed_cost_types WHERE tenant_id = '" + T + "' AND code = 'FRET'");
    asUser("INSERT INTO landed_cost_rules (tenant_id, cost_type_id, transport_mode, method, value) VALUES ('" + T + "', '" + fret + "', 'sea', 'percent', 5) RETURNING id::text");
    assertThat(asUser("SELECT apply_landed_cost_rules('" + file + "')::text")).isEqualTo("1");
    assertThat(texte("SELECT amount::int::text FROM import_file_costs WHERE import_file_id = '" + file + "' AND is_estimate")).isEqualTo("500");
    assertThatThrownBy(() -> asUser("SELECT allocate_import_costs('" + file + "', '2031-04-15')::text")).hasMessageContaining("aucun frais réel");
    asUser("INSERT INTO import_file_costs (import_file_id, cost_type_id, amount, description) VALUES ('" + file + "', '" + fret + "', 600, 'Facture Bolloré') RETURNING id::text");
    assertThat(asUser("SELECT estimated::int || '/' || actual::int || '/' || variance::int FROM import_file_cost_comparison WHERE import_file_id = '" + file + "'")).isEqualTo("500/600/100");

    // Commande de transport au transitaire, depuis le dossier, au montant réel.
    String tpo = asUser("SELECT create_transport_po('" + file + "')::text");
    assertThat(texte("SELECT ((SELECT supplier_id FROM purchase_orders WHERE id = '" + tpo + "') = '" + FW + "'::uuid)::text || ' ' || string_agg(description || ' ' || unit_cost::int, ' ; ')"
        + " FROM po_lines WHERE po_id = '" + tpo + "'")).isEqualTo("true Fret international — Shipment : " + annee + "-BOL-MER-012 600");
    assertThatThrownBy(() -> asUser("SELECT create_transport_po('" + file + "')::text")).hasMessageContaining("existe déjà");

    // Transit en un clic : consolidation → transit (381 → 381, sans écriture), puis transit → dépôt (381 → 311).
    assertThat(asUser("SELECT import_file_transit_transfer('" + file + "', 'ship', '2031-05-10')::text")).contains("\"lines\": 1");
    assertThat(stock(CONSO) + " " + stock(TRANSIT)).isEqualTo("0 10");
    assertThatThrownBy(() -> asUser("SELECT import_file_transit_transfer('" + file + "', 'ship', '2031-05-11')::text")).hasMessageContaining("rien à expédier");
    asUser("SELECT import_file_transit_transfer('" + file + "', 'deliver', '2031-07-04')::text");
    assertThat(stock(TRANSIT) + " " + stock(MAIN)).isEqualTo("0 10");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::bigint || '/' || l.credit::bigint, ' ' ORDER BY g.code) FROM import_file_transfers t"
        + " JOIN journal_lines l ON l.entry_id = t.journal_entry_id JOIN gl_accounts g ON g.id = l.account_id WHERE t.import_file_id = '" + file + "' AND t.stage = 'deliver'"))
        .isEqualTo("311:10000/0 381:0/10000");

    // Transfert déclenché par l'événement réel « départ » (paramètre de la société).
    owner("UPDATE import_settings SET auto_transit_transfers = true WHERE tenant_id = '" + T + "'");
    commandeRecue("00000000-0000-0000-0000-00000000d232", "00000000-0000-0000-0000-00000000e232", 4);
    String file2 = asUser("INSERT INTO import_files (tenant_id, supplier_id, forwarder_id, transport_mode) VALUES ('" + T + "', '" + F + "', '" + FW + "', 'air') RETURNING id::text");
    assertThat(texte("SELECT file_number FROM import_files WHERE id = '" + file2 + "'")).isEqualTo(annee + "-BOL-AIR-013");
    asUser("INSERT INTO import_file_orders (import_file_id, po_id) VALUES ('" + file2 + "', '00000000-0000-0000-0000-00000000d232') RETURNING po_id::text");
    asUser("INSERT INTO shipment_events (tenant_id, import_file_id, event_code, event_class, event_at) VALUES ('" + T + "', '" + file2 + "', 'DEPARTED', 'actual', '2031-05-12') RETURNING id::text");
    assertThat(stock(CONSO) + " " + stock(TRANSIT)).as("expédié automatiquement au départ").isEqualTo("0 4");
  }
}
