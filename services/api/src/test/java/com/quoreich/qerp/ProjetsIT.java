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
 * V111 — projets : un projet crée sa section sur l'axe paramétré ; budget par compte ; réalisé lu dans
 * les écritures portant la section (dont les notes de frais imputées au projet) ; engagé des commandes
 * en cours ; clôture qui ferme la section ; gardes et droits.
 */
@SpringBootTest
class ProjetsIT {

  private static final String DATABASE = "qerp_it_projets";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String CHEF = "aaaaaaaa-0000-0000-0000-0000000111c1";
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000111e9";
  private static final String AXE = "a1110000-0000-0000-0000-000000000001";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    StringBuilder sql = new StringBuilder();
    for (String u : new String[] {CHEF, LECTEUR}) {
      sql.append("INSERT INTO auth.users (id) VALUES ('").append(u).append("') ON CONFLICT DO NOTHING;")
          .append("INSERT INTO profiles (id, tenant_id, full_name) VALUES ('").append(u).append("', '").append(A).append("', 'U') ON CONFLICT (id) DO NOTHING;");
    }
    sql.append("INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('").append(AXE).append("', '").append(A).append("', 'PROJ', 'Projets') ON CONFLICT DO NOTHING;")
        .append("INSERT INTO project_settings (tenant_id, project_axis_id) VALUES ('").append(A).append("', '").append(AXE).append("') ON CONFLICT DO NOTHING;");
    owner(sql.toString());
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, CHEF, "project_admin", A, LECTEUR, "viewer", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String projet(String code) throws SQLException {
    return asUser(CHEF, "INSERT INTO projects (tenant_id, project_code, name, status, start_date) VALUES (get_user_tenant_id(auth.uid()), '" + code
        + "', 'Projet " + code + "', 'active', CURRENT_DATE) RETURNING id::text");
  }

  private static String section(String projet) {
    return texte("SELECT analytic_value_id::text FROM projects WHERE id = '" + projet + "'");
  }

  /** Écriture comptabilisée (débit / crédit), la ligne de charge ou de produit imputée à la section. */
  private static void ecriture(String sectionId, String debit, String credit, int montant, boolean imputerDebit) {
    String e = UUID.randomUUID().toString(), l1 = UUID.randomUUID().toString(), l2 = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-111-" + e.substring(0, 8) + "', CURRENT_DATE, 'Projet', 'manual', 'draft', '" + COMPTABLE + "');"
        + "INSERT INTO journal_lines (id, entry_id, account_id, debit, credit) VALUES ('" + l1 + "', '" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('"
        + l2 + "', '" + e + "', '" + compte(credit) + "', 0, " + montant + ");"
        + "INSERT INTO journal_line_analytics (line_id, axis_id, value_id) VALUES ('" + (imputerDebit ? l1 : l2) + "', '" + AXE + "', '" + sectionId + "');"
        + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
  }

  private static String chiffres(String projet) throws SQLException {
    return asUser(CHEF, "SELECT budget_costs::numeric(18,0) || ' ' || actual_costs::numeric(18,0) || ' ' || actual_revenue::numeric(18,0) || ' ' || committed::numeric(18,0)"
        + " FROM project_financials() WHERE project_id = '" + projet + "'");
  }

  @Test
  @DisplayName("section créée avec le projet ; budget, réalisé (charges, produits), engagé des commandes ; grand livre du projet")
  void sectionBudgetRealiseEngage() throws SQLException {
    String p = projet("P111A");
    String v = section(p);
    assertThat(texte("SELECT axis_id::text || ' ' || code || ' ' || is_active::text FROM analytic_values WHERE id = '" + v + "'")).isEqualTo(AXE + " P111A true");

    asUser(CHEF, "INSERT INTO project_budget_lines (tenant_id, project_id, gl_account_id, amount) VALUES (get_user_tenant_id(auth.uid()), '" + p + "', '"
        + compte("601") + "', 500000) RETURNING id::text");
    assertThatThrownBy(() -> asUser(CHEF, "INSERT INTO project_budget_lines (tenant_id, project_id, gl_account_id, amount) VALUES (get_user_tenant_id(auth.uid()), '" + p + "', '"
        + compte("521") + "', 1) RETURNING id::text")).hasMessageContaining("charges ou de produits");

    ecriture(v, "601", "521", 120000, true);
    ecriture(v, "411", "701", 300000, false);
    String fournisseur = UUID.randomUUID().toString();
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + fournisseur + "', '" + A + "', 'Fournisseur projet')");
    String po = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, supplier_id, total, status, created_by) VALUES ('" + po + "', '" + A + "', '" + fournisseur + "', 80000, 'approved', '"
        + COMPTABLE + "');"
        + "INSERT INTO purchase_order_analytics (tenant_id, document_id, axis_id, value_id) VALUES ('" + A + "', '" + po + "', '" + AXE + "', '" + v + "')");
    assertThat(chiffres(p)).as("budget 500 000, charges 120 000, produits 300 000, engagé 80 000").isEqualTo("500000 120000 300000 80000");
    assertThat(asUser(CHEF, "SELECT count(*)::text FROM project_ledger('" + p + "')")).isEqualTo("2");
  }

  @Test
  @DisplayName("statut par la fonction, motif exigé, section fermée à la clôture ; code figé ; droits")
  void cycleEtGardes() throws SQLException {
    String p = projet("P111B");
    assertThatThrownBy(() -> asUser(CHEF, "UPDATE projects SET status = 'closed' WHERE id = '" + p + "' RETURNING id::text")).hasMessageContaining("change par");
    assertThatThrownBy(() -> asUser(CHEF, "UPDATE projects SET project_code = 'X' WHERE id = '" + p + "' RETURNING id::text")).hasMessageContaining("ne changent pas");
    assertThatThrownBy(() -> asUser(CHEF, "SELECT project_set_status('" + p + "', 'closed', '')::text")).hasMessageContaining("Motif");
    asUser(CHEF, "SELECT project_set_status('" + p + "', 'closed', 'Livré')::text");
    assertThat(texte("SELECT is_active::text FROM analytic_values WHERE id = '" + section(p) + "'")).as("plus d'imputation sur un projet clôturé").isEqualTo("false");
    assertThatThrownBy(() -> asUser(CHEF, "UPDATE projects SET name = 'Autre' WHERE id = '" + p + "' RETURNING id::text")).hasMessageContaining("clôturé");
    asUser(CHEF, "SELECT project_set_status('" + p + "', 'active', NULL)::text");
    assertThat(texte("SELECT is_active::text FROM analytic_values WHERE id = '" + section(p) + "'")).isEqualTo("true");

    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO projects (tenant_id, project_code, name) VALUES (get_user_tenant_id(auth.uid()), 'P111X', 'X') RETURNING id::text"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT project_set_status('" + p + "', 'on_hold', 'x')::text")).hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO project_costs (project_id, cost_date, category, amount) VALUES ('" + p + "', CURRENT_DATE, 'x', 1) RETURNING id::text"))
        .as("ancienne saisie libre des coûts fermée").hasMessageContaining("permission denied");
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
