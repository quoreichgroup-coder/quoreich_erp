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
 * V62 (PC-1) — plan opérationnel de la société, attributs de compte (sens normal, mode d'imputation,
 * attributs personnalisés), historique des modifications, solde anormal au contrôle de qualité, droits.
 */
@SpringBootTest
class PlansComptablesAttributsIT {

  private static final String DATABASE = "qerp_it_plans_attributs";
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN_B = PostgresFixture.BETA_USER;
  private static final String LECTEUR = "bbbbbbbb-0000-0000-0000-0000000006b1";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + B + "', 'Lecteur B') ON CONFLICT (id) DO NOTHING;"
        + "DELETE FROM gl_account_attribute_definitions WHERE tenant_id = '" + B + "'");
    PostgresFixture.grantRoles(DATABASE, ADMIN_B, "admin", B, LECTEUR, "viewer", B);
  }

  private static String code() {
    return "5" + String.valueOf(Math.abs(UUID.randomUUID().getMostSignificantBits())).substring(0, 6);
  }

  private static void ecriture(String source, String debit, String credit, int montant) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '"
        + B + "', 'JE-V62-" + e.substring(0, 6) + "', CURRENT_DATE, 'Essai V62', '" + source + "', 'draft', '" + ADMIN_B + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + debit + "', " + montant + ", 0), ('"
        + e + "', '" + credit + "', 0, " + montant + ");"
        + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
  }

  @Test
  @DisplayName("plan opérationnel par défaut, sens normal déduit du type, mode d'imputation, solde anormal signalé")
  void planEtAttributs() throws SQLException {
    String banque = asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B + "', '" + code() + "', 'Banque V62', 'asset') RETURNING id::text");
    String client = asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B + "', '41" + code().substring(1) + "', 'Clients V62', 'asset') RETURNING id::text");
    assertThat(texte("SELECT c.code || ' ' || c.kind || ' ' || c.status || ' ' || g.normal_balance FROM gl_accounts g JOIN charts c ON c.id = g.chart_id WHERE g.id = '" + banque + "'"))
        .isEqualTo("PRINCIPAL operational active debit");

    asUser(ADMIN_B, "UPDATE gl_accounts SET posting_mode = 'automatic_only' WHERE id = '" + client + "' RETURNING id::text");
    assertThatThrownBy(() -> ecriture("manual", banque, client, 1000)).hasStackTraceContaining("compte collectif");
    ecriture("ar_receipt", banque, client, 1000);
    assertThat(asUser(ADMIN_B, "SELECT count(*)::text FROM chart_of_accounts_issues() WHERE account_id = '" + client + "' AND issue = 'Solde anormal'"))
        .as("client créditeur").isEqualTo("1");
    asUser(ADMIN_B, "UPDATE gl_accounts SET posting_mode = 'blocked' WHERE id = '" + banque + "' RETURNING id::text");
    assertThatThrownBy(() -> ecriture("ar_receipt", banque, client, 10)).hasStackTraceContaining("bloquée");

    assertThat(texte("SELECT changes::text FROM gl_account_history WHERE account_id = '" + banque + "' AND action = 'update' ORDER BY id DESC LIMIT 1"))
        .as("historique avant / après").contains("posting_mode").contains("manual").contains("blocked");
  }

  @Test
  @DisplayName("attributs personnalisés : définis par la société, obligatoires et listes contrôlés ; droits d'administration")
  void attributsPersonnalises() throws SQLException {
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO gl_account_attribute_definitions (tenant_id, key, label, data_type) VALUES ('" + B
            + "', 'centre', 'Centre', 'text') RETURNING id::text"))
        .hasMessageContaining("row-level security");
    asUser(ADMIN_B, "INSERT INTO gl_account_attribute_definitions (tenant_id, key, label, data_type, options, required) VALUES ('" + B
        + "', 'rubrique_fiscale', 'Rubrique fiscale', 'list', ARRAY['deductible', 'non_deductible'], true) RETURNING id::text");
    String c = code();
    assertThatThrownBy(() -> asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + B + "', '" + c + "', 'Sans attribut', 'asset') RETURNING id::text"))
        .hasMessageContaining("obligatoire");
    assertThatThrownBy(() -> asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type, custom_attributes) VALUES ('" + B + "', '" + c
            + "', 'Mauvaise valeur', 'asset', '{\"rubrique_fiscale\":\"autre\"}') RETURNING id::text"))
        .hasMessageContaining("valeur invalide");
    assertThat(asUser(ADMIN_B, "INSERT INTO gl_accounts (tenant_id, code, name, account_type, custom_attributes) VALUES ('" + B + "', '" + c
        + "', 'Avec attribut', 'asset', '{\"rubrique_fiscale\":\"deductible\"}') RETURNING custom_attributes->>'rubrique_fiscale'")).isEqualTo("deductible");
    assertThat(asUser(LECTEUR, "WITH u AS (UPDATE charts SET name = 'x' WHERE tenant_id = '" + B + "' RETURNING 1) SELECT count(*)::text FROM u"))
        .as("plans : droit accounting.chart_admin").isEqualTo("0");
    owner("UPDATE gl_account_attribute_definitions SET is_active = false WHERE tenant_id = '" + B + "'");
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
