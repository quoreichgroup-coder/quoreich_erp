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
 * V79 — budget sans règle codée en dur : réalisé au sens normal du compte (un produit se réalise au crédit),
 * types de comptes budgétables paramétrés (saisie et import), scénarios par société (référencés, désactivables),
 * réalisé mensuel de l'exercice précédent pour la saisonnalité.
 */
@SpringBootTest
class BudgetParametresScenariosIT {

  private static final String DATABASE = "qerp_it_budget_parametres";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static void ecriture(String date, String debit, String credit, int montant) {
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-V79-" + e.substring(0, 8) + "', '" + date + "', 'Pièce V79', 'manual', 'draft', '" + ADMIN + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte(debit) + "', " + montant + ", 0), ('" + e + "', '"
        + compte(credit) + "', 0, " + montant + ");"
        + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
  }

  @Test
  @DisplayName("produits réalisés au crédit, saisonnalité de l'exercice précédent, types budgétables paramétrés")
  void sensEtParametres() throws SQLException {
    String b = UUID.randomUUID().toString();
    owner("INSERT INTO budgets (id, tenant_id, name, fiscal_year, total_amount, status, created_by) VALUES ('" + b + "', '" + A + "', 'Budget 2046', '2046', 0, 'draft', '" + ADMIN + "');"
        + "INSERT INTO budget_lines (tenant_id, budget_id, gl_account_id, period, planned_amount) VALUES"
        + " ('" + A + "', '" + b + "', '" + compte("701") + "', '2046', 50000), ('" + A + "', '" + b + "', '" + compte("601") + "', '2046', 30000);"
        + "UPDATE budgets SET status = 'approved', is_control = true, approved_by = '" + ADMIN + "', approved_at = now() WHERE id = '" + b + "'");
    assertThat(texte("SELECT scenario FROM budgets WHERE id = '" + b + "'")).as("scénario par défaut créé à la première utilisation").isEqualTo("base");
    ecriture("2046-02-10", "411", "701", 20000);
    ecriture("2045-03-15", "601", "521", 4000);
    assertThat(asUser(ADMIN, "SELECT string_agg(account_code || ' ' || nature || ' ' || trim_scale(actual), ', ' ORDER BY account_code) FROM budget_status('2046')"))
        .as("une vente se réalise au crédit du produit").isEqualTo("601 expense 0, 701 revenue 20000");
    assertThat(asUser(ADMIN, "SELECT trim_scale(m.actual)::text FROM budget_prior_year_monthly('2046') m JOIN budget_lines l ON l.id = m.line_id"
        + " JOIN gl_accounts g ON g.id = l.gl_account_id WHERE g.code = '601' AND m.month = 3")).isEqualTo("4000");

    String brouillon = asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, total_amount, status, created_by) VALUES ('" + A
        + "', 'Investissements 2047', '2047', 0, 'draft', auth.uid()) RETURNING id::text");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO budget_lines (budget_id, gl_account_id, period, planned_amount) VALUES ('" + brouillon + "', '" + compte("521")
        + "', '2047', 10) RETURNING id::text")).as("trésorerie non budgétable par défaut").hasMessageContaining("pas budgétable");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT import_budget_lines('" + brouillon + "', '[{\"line\":2,\"account\":\"521\",\"period\":\"2047\",\"amount\":10}]')::text"))
        .hasMessageContaining("type non budgétable");
    asUser(ADMIN, "INSERT INTO budget_settings (tenant_id, budgetable_types) VALUES ('" + A + "', ARRAY['asset','expense','revenue'])"
        + " ON CONFLICT (tenant_id) DO UPDATE SET budgetable_types = EXCLUDED.budgetable_types RETURNING tenant_id::text");
    assertThat(asUser(ADMIN, "INSERT INTO budget_lines (budget_id, gl_account_id, period, planned_amount) VALUES ('" + brouillon + "', '" + compte("521")
        + "', '2047', 10) RETURNING period")).isEqualTo("2047");
  }

  @Test
  @DisplayName("scénarios de la société : référencés par les budgets, désactivables, réservés au paramétrage")
  void scenarios() throws SQLException {
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget haut', '2048', 'haut', 0, 'draft', auth.uid()) RETURNING id::text")).hasMessageContaining("Scénario « haut » inconnu");
    asUser(ADMIN, "INSERT INTO budget_scenarios (tenant_id, code, name) VALUES ('" + A + "', 'haut', 'Hypothèse haute') RETURNING id::text");
    assertThat(asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget haut', '2048', 'haut', 0, 'draft', auth.uid()) RETURNING scenario")).isEqualTo("haut");
    asUser(ADMIN, "UPDATE budget_scenarios SET is_active = false WHERE tenant_id = '" + A + "' AND code = 'haut' RETURNING id::text");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget haut bis', '2048', 'haut', 0, 'draft', auth.uid()) RETURNING id::text")).hasMessageContaining("désactivé");
    assertThatThrownBy(() -> asUser(ADMIN, "DELETE FROM budget_scenarios WHERE tenant_id = '" + A + "' AND code = 'haut' RETURNING id::text"))
        .as("scénario utilisé : clé étrangère").hasMessageContaining("budgets_scenario_fkey");
    String lecteur = "aaaaaaaa-7979-0000-0000-000000000079";
    owner("INSERT INTO auth.users (id) VALUES ('" + lecteur + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + lecteur + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    assertThatThrownBy(() -> asUser(lecteur, "INSERT INTO budget_scenarios (tenant_id, code, name) VALUES ('" + A + "', 'bas', 'Bas') RETURNING id::text"))
        .as("budget.settings requis").hasMessageContaining("row-level security");
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
