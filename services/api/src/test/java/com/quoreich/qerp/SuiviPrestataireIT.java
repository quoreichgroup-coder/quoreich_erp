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
 * V134 — connecteur de suivi : jeton propre à la société, clé API jamais lisible, réception d'événements DCSA réservée à
 * la tâche (jamais à un utilisateur), rattachement par connaissement ou conteneur, sans doublon, effet sur le dossier,
 * événements non reconnus ou sans dossier comptés, jeton inconnu refusé.
 */
@SpringBootTest
class SuiviPrestataireIT {

  private static final String DATABASE = "qerp_it_suivi_prestataire";
  private static final String T = "33333333-3333-3333-3333-333333333134";
  private static final String U = "cccccccc-0000-0000-0000-000000000134";

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

  private static final String F = "00000000-0000-0000-0000-0000000f0134";

  private static final String EVENTS = "'{\"events\": ["
      + "{\"eventID\": \"e1\", \"eventType\": \"TRANSPORT\", \"transportEventTypeCode\": \"DEPA\", \"eventClassifierCode\": \"ACT\","
      + " \"eventDateTime\": \"2031-05-10T08:00:00Z\", \"transportDocumentReference\": \"MEDU1234\","
      + " \"transportCall\": {\"UNLocationCode\": \"CNNGB\", \"vessel\": {\"vesselName\": \"MSC ANNA\"}}},"
      + "{\"eventID\": \"e2\", \"eventType\": \"EQUIPMENT\", \"equipmentEventTypeCode\": \"DISC\", \"eventClassifierCode\": \"ACT\","
      + " \"eventDateTime\": \"2031-07-04T10:00:00Z\", \"equipmentReference\": \"MSCU 1234567\", \"eventLocation\": {\"UNLocationCode\": \"CIABJ\"}},"
      + "{\"eventID\": \"e3\", \"eventType\": \"SHIPMENT\", \"shipmentEventTypeCode\": \"ISSU\", \"eventDateTime\": \"2031-05-01T00:00:00Z\"},"
      + "{\"eventID\": \"e4\", \"eventType\": \"TRANSPORT\", \"transportEventTypeCode\": \"ARRI\", \"eventClassifierCode\": \"EST\","
      + " \"eventDateTime\": \"2031-07-01T00:00:00Z\", \"transportDocumentReference\": \"AUTRE-BL\"}]}'::jsonb";

  @Test
  @DisplayName("jeton par société, clé API illisible, réception DCSA réservée à la tâche, rattachement, doublons, effets")
  void connecteur() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Importateur V134') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur V134') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Usine V134') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    String file = asUser("INSERT INTO import_files (tenant_id, supplier_id, bill_of_lading, containers) VALUES ('" + T + "', '" + F + "', 'MEDU1234', 'MSCU1234567') RETURNING id::text");

    String token = asUser("SELECT set_tracking_connection('dcsa', true, 'cle-secrete-du-prestataire')");
    assertThat(token).matches("[0-9a-f]{64}");
    assertThat(asUser("SELECT set_tracking_connection('dcsa', true)")).as("même jeton, clé gardée").isEqualTo(token);
    assertThat(texte("SELECT api_key FROM tracking_connections WHERE tenant_id = '" + T + "'")).isEqualTo("cle-secrete-du-prestataire");
    assertThatThrownBy(() -> owner("SET ROLE authenticated; SELECT api_key FROM public.tracking_connections")).hasMessageContaining("permission denied");
    assertThatThrownBy(() -> owner("SET ROLE authenticated; SELECT public.ingest_tracking_events('" + token + "', '{}'::jsonb)")).hasMessageContaining("permission denied");

    // Réception (qerp_api, comme la route publique) : 2 rattachés (connaissement, conteneur), 1 sans dossier, 1 non reconnu.
    assertThat(asUser("SELECT ingest_tracking_events('" + token + "', " + EVENTS + ")::text"))
        .contains("\"added\": 2", "\"unmatched\": 1", "\"ignored\": 1");
    assertThat(texte("SELECT status || ' ' || vessel FROM import_files WHERE id = '" + file + "'")).isEqualTo("arrived MSC ANNA");
    assertThat(texte("SELECT string_agg(event_code || ':' || source || ':' || COALESCE(container_number, '-'), ' ' ORDER BY event_at) FROM shipment_events WHERE import_file_id = '" + file + "'"))
        .isEqualTo("DEPARTED:provider:- DISCHARGED:provider:MSCU1234567");
    assertThat(asUser("SELECT ingest_tracking_events('" + token + "', " + EVENTS + ")::text")).as("renvoi : doublons ignorés").contains("\"added\": 0");
    assertThatThrownBy(() -> asUser("SELECT ingest_tracking_events('" + "0".repeat(64) + "', " + EVENTS + ")::text")).hasMessageContaining("inconnue");
    assertThat(asUser("SELECT last_result ->> 'unmatched' FROM tracking_connections WHERE tenant_id = '" + T + "'")).isEqualTo("1");
  }
}
