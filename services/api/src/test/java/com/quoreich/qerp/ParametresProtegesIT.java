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
 * V107 / V108 — paramètres et circuits protégés : seuils d'approbation et paramètres fournisseurs réservés au
 * droit du catalogue, files d'approbation et alertes en lecture seule (écrites par les fonctions métier),
 * modules réservés à l'administrateur ; limites de trésorerie calculées sur le solde réel.
 */
@SpringBootTest
class ParametresProtegesIT {

  private static final String DATABASE = "qerp_it_parametres_proteges";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000108e9";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  @Test
  @DisplayName("seuils et paramètres : le lecteur ne modifie rien, le comptable (ap.settings) oui ; un niveau par type")
  void parametresReservesAuDroit() throws SQLException {
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO ap_approval_thresholds (tenant_id, level, approver, sla_hours, doc_types) VALUES"
        + " (get_user_tenant_id(auth.uid()), 'LX', 'Moi', 1, 'factures') RETURNING 1"))
        .as("insertion refusée par la RLS").hasMessageContaining("row-level security");
    String id = asUser(COMPTABLE, "INSERT INTO ap_approval_thresholds (tenant_id, level, max_amount, approver, sla_hours, doc_types) VALUES"
        + " (get_user_tenant_id(auth.uid()), 'L9 — Test', 1000000, 'Directeur', 24, 'factures') RETURNING id::text");
    assertThat(id).isNotNull();
    assertThat(asUser(LECTEUR, "DELETE FROM ap_approval_thresholds WHERE id = '" + id + "' RETURNING 1")).isNull();
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO ap_approval_thresholds (tenant_id, level, approver, sla_hours, doc_types) VALUES"
        + " (get_user_tenant_id(auth.uid()), 'L9 — Test', 'Autre', 24, 'factures') RETURNING 1")).hasMessageContaining("duplicate key");
    assertThat(asUser(LECTEUR, "UPDATE procurement_approval_thresholds SET max_amount = 1 WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .as("seuils d'achat : droit procurement.settings").isNull();
  }

  @Test
  @DisplayName("files d'approbation et alertes en lecture seule ; modules réservés à l'administrateur")
  void ecrituresDirectesFermees() {
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE procurement_approvals SET status = 'approved' WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(COMPTABLE, "DELETE FROM erp_alerts WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING 1"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO procurement_match_decisions (tenant_id) VALUES (get_user_tenant_id(auth.uid())) RETURNING 1"))
        .hasMessageContaining("permission denied");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO licenses (tenant_id) VALUES (get_user_tenant_id(auth.uid())) RETURNING 1"))
        .hasMessageContaining("permission denied");
  }

  @Test
  @DisplayName("limites de trésorerie : sous le minimum, découvert dépassé, non suivi")
  void limitesTresorerie() throws SQLException {
    String gl = texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '521'");
    owner("INSERT INTO bank_accounts (tenant_id, name, bank_name, currency, account_type, gl_account_id, opening_balance, balance) VALUES"
        + " ('" + A + "', 'Banque 107 min', 'Banque test', 'XOF', 'bank', '" + gl + "', 0, 0)");
    owner("UPDATE bank_accounts SET min_balance = 100000 WHERE tenant_id = '" + A + "' AND name = 'Banque 107 min'");
    assertThat(asUser(COMPTABLE, "SELECT status FROM treasury_limit_status WHERE name = 'Banque 107 min'")).isEqualTo("below_min");
    owner("UPDATE bank_accounts SET min_balance = NULL WHERE tenant_id = '" + A + "' AND name = 'Banque 107 min'");
    assertThat(asUser(COMPTABLE, "SELECT status FROM treasury_limit_status WHERE name = 'Banque 107 min'")).isEqualTo("not_monitored");
    assertThatThrownBy(() -> owner("UPDATE bank_accounts SET min_balance = 10, max_balance = 5 WHERE tenant_id = '" + A + "' AND name = 'Banque 107 min'"))
        .hasStackTraceContaining("bank_accounts_min_max_check");
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
