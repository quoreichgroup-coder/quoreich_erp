package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V116 — dernières écritures ouvertes à tout membre : un « Lecteur » ne crée ni demande, ni commande, ni réception,
 * ne touche ni prévisions, ni modèles, ni circuits, ni historique IA ; l'acheteur (procurement_l1) crée demande et
 * commande ; l'historique IA n'accepte qu'un ajout signé par son auteur, jamais une modification.
 */
@SpringBootTest
class EcrituresReserveesIT {

  private static final String DATABASE = "qerp_it_ecritures_reservees";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ACHETEUR = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000116e9";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ACHETEUR, "procurement_l1", A, LECTEUR, "viewer", A);
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

  private static final String TENANT = "get_user_tenant_id(auth.uid())";

  @Test
  @DisplayName("achats : le lecteur ne crée rien, l'acheteur crée demande et commande")
  void achatsReservesAuxDroits() throws SQLException {
    String fournisseur = PostgresFixture.textAsAdmin(DATABASE, "INSERT INTO suppliers (tenant_id, name) VALUES ('" + A
        + "', 'Fournisseur V116') RETURNING id::text");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO purchase_requisitions (tenant_id, requested_by) VALUES (" + TENANT + ", auth.uid()) RETURNING 1"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO purchase_orders (tenant_id, supplier_id, created_by) VALUES (" + TENANT + ", '" + fournisseur
        + "', auth.uid()) RETURNING 1")).hasMessageContaining("row-level security");
    String commande = asUser(ACHETEUR, "INSERT INTO purchase_orders (tenant_id, supplier_id, created_by) VALUES (" + TENANT + ", '" + fournisseur
        + "', auth.uid()) RETURNING id::text");
    assertThat(commande).isNotNull();
    assertThat(asUser(ACHETEUR, "INSERT INTO purchase_requisitions (tenant_id, requested_by) VALUES (" + TENANT + ", auth.uid()) RETURNING 1")).isEqualTo("1");
    assertThat(asUser(LECTEUR, "SELECT count(*)::text FROM purchase_orders WHERE id = '" + commande + "'")).as("lecture inchangée").isEqualTo("1");
    assertThat(asUser(LECTEUR, "DELETE FROM purchase_orders WHERE id = '" + commande + "' RETURNING 1")).isNull();
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO goods_receipts (tenant_id, gr_number, po_id, received_by) VALUES (" + TENANT + ", 'GR-LECTEUR', '"
        + commande + "', auth.uid()) RETURNING 1")).hasMessageContaining("row-level security");
  }

  @Test
  @DisplayName("prévisions, modèles, circuits, ancienne matrice : lecture seule sans droit ; historique IA : ajout signé seulement")
  void tablesDeParametrage() throws SQLException {
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO cashflow_forecasts (tenant_id, week_start, category, direction) VALUES (" + TENANT
        + ", CURRENT_DATE, 'Test', 'inflow') RETURNING 1")).hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO report_templates (tenant_id, module, name, data_source) VALUES (" + TENANT
        + ", 'gl', 'Modèle', 'gl') RETURNING 1")).hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO workflow_rules (tenant_id, name, module, event_type) VALUES (" + TENANT
        + ", 'Règle', 'ap', 'invoice') RETURNING 1")).hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(ACHETEUR, "INSERT INTO workflow_instances (tenant_id) VALUES (" + TENANT + ") RETURNING 1"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO ai_analysis_history (tenant_id, analysis_type, created_by) VALUES (" + TENANT
        + ", 'cashflow_forecast', '" + ACHETEUR + "') RETURNING 1")).as("ajout au nom d'un autre").hasMessageContaining("row-level security");
    String h = asUser(LECTEUR, "INSERT INTO ai_analysis_history (tenant_id, analysis_type, created_by) VALUES (" + TENANT
        + ", 'cashflow_forecast', auth.uid()) RETURNING id::text");
    assertThat(h).isNotNull();
    assertThat(asUser(LECTEUR, "UPDATE ai_analysis_history SET status = 'success' WHERE id = '" + h + "' RETURNING 1")).as("jamais modifié").isNull();
    assertThat(asUser(ACHETEUR, "DELETE FROM ai_analysis_history WHERE id = '" + h + "' RETURNING 1")).as("jamais effacé").isNull();
  }
}
