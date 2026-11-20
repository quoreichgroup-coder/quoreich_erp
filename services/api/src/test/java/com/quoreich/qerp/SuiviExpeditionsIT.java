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
 * V131 — suivi des expéditions : dossier ouvert depuis la commande (déjà rempli), événements réels qui font avancer le
 * dossier, arrivée estimée qui met à jour l'ETA en gardant l'ETA initiale (retard mesuré), import d'un fichier de suivi
 * sans doublon et refusé en bloc sur une ligne illisible, chronologie ERP + événements, conteneur au format ISO 6346.
 */
@SpringBootTest
class SuiviExpeditionsIT {

  private static final String DATABASE = "qerp_it_suivi_expeditions";
  private static final String T = "33333333-3333-3333-3333-333333333131";
  private static final String U = "cccccccc-0000-0000-0000-000000000131";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0131";
  private static final String PO = "00000000-0000-0000-0000-00000000d131";

  private static String etat(String file) {
    return texte("SELECT status || ' ' || COALESCE(eta::text, '-') || ' ' || COALESCE(initial_eta::text, '-') || ' ' || COALESCE(arrival_date::text, '-')"
        + " || ' ' || COALESCE(vessel, '-') FROM import_files WHERE id = '" + file + "'");
  }

  @Test
  @DisplayName("dossier depuis la commande, événements, ETA et retard, import de fichier de suivi, chronologie")
  void suivi() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Importateur V131') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur V131') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name, country) VALUES ('" + F + "', '" + T + "', 'Usine Ningbo V131', 'CN') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, expected_date, incoterm, status, created_by)"
        + " VALUES ('" + PO + "', '" + T + "', 'PO-131', '" + F + "', '2031-04-01', '2031-06-30', 'FOB', 'approved', '" + U + "')");
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);

    String file = asUser("SELECT create_import_file_from_po('" + PO + "')::text");
    assertThat(texte("SELECT incoterm || ' ' || origin_country || ' ' || (SELECT count(*) FROM import_file_orders o WHERE o.import_file_id = f.id) FROM import_files f WHERE id = '" + file + "'"))
        .isEqualTo("FOB CN 1");
    assertThat(etat(file)).isEqualTo("open 2031-06-30 2031-06-30 - -");
    assertThatThrownBy(() -> asUser("SELECT create_import_file_from_po('" + PO + "')::text")).hasMessageContaining("appartient déjà");

    asUser("INSERT INTO shipment_events (tenant_id, import_file_id, event_code, event_class, event_at, location, vessel, container_number)"
        + " VALUES ('" + T + "', '" + file + "', 'DEPARTED', 'actual', '2031-05-10', 'CNNGB', 'MSC ANNA', 'mscu 1234567') RETURNING id::text");
    assertThat(etat(file)).as("départ réel : en transit, navire repris").isEqualTo("in_transit 2031-06-30 2031-06-30 - MSC ANNA");
    asUser("INSERT INTO shipment_events (tenant_id, import_file_id, event_code, event_class, event_at) VALUES ('" + T + "', '" + file + "', 'ARRIVED', 'estimated', '2031-07-05') RETURNING id::text");
    assertThat(etat(file)).as("nouvelle ETA, ETA initiale gardée").isEqualTo("in_transit 2031-07-05 2031-06-30 - MSC ANNA");
    assertThat(asUser("SELECT tracking_state || ' ' || delay_days FROM shipment_tracking_status WHERE import_file_id = '" + file + "'")).isEqualTo("delayed 5");
    assertThatThrownBy(() -> asUser("INSERT INTO shipment_events (tenant_id, import_file_id, event_code, event_at, container_number) VALUES ('" + T + "', '" + file + "', 'LOADED', '2031-05-09', 'ABC123') RETURNING id::text"))
        .hasMessageContaining("container_number");

    String lignes = "'[{\"event_code\":\"TRANSSHIPMENT\",\"event_at\":\"2031-06-01\",\"location\":\"MAPTM\"},"
        + "{\"event_code\":\"ARRIVED\",\"event_at\":\"2031-07-04\",\"location\":\"CIABJ\",\"container_number\":\"MSCU1234567\"},"
        + "{\"event_code\":\"CUSTOMS_RELEASED\",\"event_at\":\"2031-07-06\"},"
        + "{\"event_code\":\"TRANSSHIPMENT\",\"event_at\":\"2031-06-01\",\"location\":\"MAPTM\"}]'::jsonb";
    assertThatThrownBy(() -> asUser("SELECT import_shipment_events('" + file + "', '[{\"event_code\":\"XX\",\"event_at\":\"2031-06-01\"}]'::jsonb)::text"))
        .hasMessageContaining("ligne 1 : étape non reconnue");
    assertThat(asUser("SELECT import_shipment_events('" + file + "', " + lignes + ")::text")).contains("\"added\": 3", "\"ignored\": 1");
    assertThat(asUser("SELECT import_shipment_events('" + file + "', " + lignes + ")::text")).as("réimport : tout ignoré").contains("\"added\": 0");
    assertThat(etat(file)).as("arrivée et mainlevée réelles : dédouané, date d'arrivée").isEqualTo("cleared 2031-07-05 2031-06-30 2031-07-04 MSC ANNA");
    assertThat(asUser("SELECT tracking_state || ' ' || delay_days || ' ' || last_event_code FROM shipment_tracking_status WHERE import_file_id = '" + file + "'"))
        .isEqualTo("arrived 4 CUSTOMS_RELEASED");

    assertThat(asUser("SELECT string_agg(event_code, ' ' ORDER BY event_at, event_code) FROM shipment_timeline('" + file + "')"))
        .isEqualTo("PO_ORDERED DEPARTED TRANSSHIPMENT DELIVERY_PLANNED ARRIVED ARRIVED CUSTOMS_RELEASED");
  }
}
