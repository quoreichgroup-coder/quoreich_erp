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
 * V135 — réception de tout le dossier en une action (une réception par commande, reste à recevoir, dépôt de
 * consolidation), frais réels créés sans saisie à l'approbation de la facture du transitaire qui cite la commande de
 * transport, coût de revient unitaire par article après répartition.
 */
@SpringBootTest
class ReceptionDossierCoutRevientIT {

  private static final String DATABASE = "qerp_it_reception_dossier";
  private static final String T = "33333333-3333-3333-3333-333333333135";
  private static final String U = "cccccccc-0000-0000-0000-000000000135";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0135";
  private static final String FW = "00000000-0000-0000-0000-0000000f1135";
  private static final String A = "00000000-0000-0000-0000-0000000a0135";
  private static final String B = "00000000-0000-0000-0000-0000000b0135";
  private static final String CONSO = "00000000-0000-0000-0000-0000000c0135";
  private static final String PO1 = "00000000-0000-0000-0000-00000000d135";
  private static final String PO2 = "00000000-0000-0000-0000-00000000d235";

  @Test
  @DisplayName("réception du dossier en une action, frais réels depuis la facture du transitaire, coût de revient")
  void receptionEtCoutDeRevient() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Importateur V135') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur V135') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Usine V135'), ('" + FW + "', '" + T + "', 'Bolloré Logistics') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + T + "', true) ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true;"
        + "INSERT INTO items (id, tenant_id, code, name) VALUES ('" + A + "', '" + T + "', 'A-135', 'Pompe'), ('" + B + "', '" + T + "', 'B-135', 'Moteur');"
        + "INSERT INTO warehouses (id, tenant_id, code, name, kind) VALUES ('" + CONSO + "', '" + T + "', 'CONSO', 'Consolidation', 'consolidation');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES"
        + " ('" + PO1 + "', '" + T + "', 'PO-135-1', '" + F + "', '2031-03-01', 'approved', '" + U + "'), ('" + PO2 + "', '" + T + "', 'PO-135-2', '" + F + "', '2031-03-02', 'approved', '" + U + "');"
        + "INSERT INTO po_lines (po_id, item_id, description, quantity, unit_cost) VALUES ('" + PO1 + "', '" + A + "', 'Pompe', 10, 1000), ('" + PO2 + "', '" + B + "', 'Moteur', 5, 2000)");

    String file = asUser("INSERT INTO import_files (tenant_id, supplier_id, forwarder_id, transport_mode, consolidation_warehouse_id) VALUES ('" + T + "', '" + F + "', '" + FW + "', 'sea', '" + CONSO + "') RETURNING id::text");
    asUser("INSERT INTO import_file_orders (import_file_id, po_id) VALUES ('" + file + "', '" + PO1 + "'), ('" + file + "', '" + PO2 + "') RETURNING po_id::text");

    // Tout le dossier reçu en une action, au magasin de consolidation.
    assertThat(asUser("SELECT receive_import_file('" + file + "', NULL, '2031-04-01')::text")).contains("\"receipts\": 2");
    assertThat(texte("SELECT string_agg(i.code || ':' || il.quantity_on_hand::int, ' ' ORDER BY i.code) FROM item_locations il JOIN items i ON i.id = il.item_id WHERE il.warehouse_id = '" + CONSO + "'"))
        .isEqualTo("A-135:10 B-135:5");
    assertThat(texte("SELECT string_agg(status, ' ') FROM purchase_orders WHERE id IN ('" + PO1 + "', '" + PO2 + "')")).isEqualTo("received received");
    assertThatThrownBy(() -> asUser("SELECT receive_import_file('" + file + "', NULL, '2031-04-02')::text")).hasMessageContaining("rien à réceptionner");

    // Commande de transport (frais estimé), facture du transitaire approuvée : frais réel créé sans saisie.
    String fret = texte("SELECT id::text FROM landed_cost_types WHERE tenant_id = '" + T + "' AND code = 'FRET'");
    asUser("INSERT INTO import_file_costs (import_file_id, cost_type_id, amount, is_estimate) VALUES ('" + file + "', '" + fret + "', 500, true) RETURNING id::text");
    String tpo = asUser("SELECT create_transport_po('" + file + "')::text");
    String ligne = texte("SELECT id::text FROM po_lines WHERE po_id = '" + tpo + "'");
    assertThat(texte("SELECT (landed_cost_type_id = '" + fret + "'::uuid)::text FROM po_lines WHERE id = '" + ligne + "'")).isEqualTo("true");
    owner("UPDATE purchase_orders SET status = 'approved' WHERE id = '" + tpo + "';"
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, po_id, status, approval_status, created_by)"
        + " VALUES ('00000000-0000-0000-0000-00000000f135', '" + T + "', 'BOL-2031-77', '" + FW + "', '2031-04-05', '2031-05-05', '" + tpo + "', 'draft', 'draft', '" + U + "');"
        + "INSERT INTO ap_invoice_lines (invoice_id, line_no, description, quantity, unit_price, po_line_id) VALUES ('00000000-0000-0000-0000-00000000f135', 1, 'Fret Shanghai - Abidjan', 1, 650, '" + ligne + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '00000000-0000-0000-0000-00000000f135'");
    assertThat(texte("SELECT amount::int || ' ' || is_estimate || ' ' || (ap_invoice_id IS NOT NULL) FROM import_file_costs WHERE import_file_id = '" + file + "' AND NOT is_estimate"))
        .isEqualTo("650 false true");
    assertThat(asUser("SELECT estimated::int || '/' || actual::int FROM import_file_cost_comparison WHERE import_file_id = '" + file + "'")).isEqualTo("500/650");

    // Répartition (réels seulement) et coût de revient unitaire.
    asUser("SELECT allocate_import_costs('" + file + "', '2031-04-15')::text");
    assertThat(asUser("SELECT string_agg(item_code || ':' || quantity::int || ':' || purchase_value::int || ':' || landed_costs::int || ':' || unit_landed_cost, ' ' ORDER BY item_code)"
        + " FROM import_file_cost_report WHERE import_file_id = '" + file + "'")).isEqualTo("A-135:10:10000:325:1032.5000 B-135:5:10000:325:2065.0000");
  }
}
