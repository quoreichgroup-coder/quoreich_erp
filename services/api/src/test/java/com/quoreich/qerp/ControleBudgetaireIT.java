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
 * V73 (lot B1, G-08) — contrôle budgétaire : cycle de vie du budget (approbation par un tiers, lignes
 * figées, révision motivée), engagé / réalisé / disponible recalculés, blocage d'une commande au-delà du
 * disponible, dépassement autorisé et tracé, mode avertissement, facture sans commande contrôlée.
 */
@SpringBootTest
class ControleBudgetaireIT {

  private static final String DATABASE = "qerp_it_controle_budgetaire";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String PREPARATEUR = "aaaaaaaa-7373-0000-0000-000000000073";
  private static final String APPROBATEUR = "aaaaaaaa-7373-0000-0000-000000000074";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0073";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + PREPARATEUR + "'), ('" + APPROBATEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + PREPARATEUR + "', '" + A + "', 'Contrôleur de gestion'), ('" + APPROBATEUR + "', '" + A
        + "', 'Directeur financier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V73') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type, is_header) VALUES ('" + A + "', '60', 'Achats et variations de stocks', 'expense', true)"
        + " ON CONFLICT (tenant_id, code) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, PREPARATEUR, "budget_planner", A, APPROBATEUR, "budget_approver", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String commande(int total) {
    String po = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_date, total, status, created_by) VALUES ('" + po + "', '" + A + "', '" + FOURNISSEUR
        + "', '2039-03-01', " + total + ", 'draft', '" + ADMIN + "')");
    return po;
  }

  private static String disponible() throws SQLException {
    return asUser(ADMIN, "SELECT planned || ' ' || committed || ' ' || actual || ' ' || available FROM budget_status('2039') WHERE account_code = '60'");
  }

  @Test
  @DisplayName("budget approuvé par un tiers, figé, révisé ; commande bloquée au-delà du disponible, dépassement autorisé, avertissement")
  void controle() throws SQLException {
    String b = asUser(PREPARATEUR, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget 2039', '2039', 'base', 0, 'approved', auth.uid()) RETURNING status || ' ' || id");
    assertThat(b).as("créé en brouillon quoi qu'on envoie").startsWith("draft ");
    String budget = b.substring(6);
    String ligne = asUser(PREPARATEUR, "INSERT INTO budget_lines (budget_id, gl_account_id, period, planned_amount) VALUES ('" + budget + "', '" + compte("60") + "', '2039', 100000) RETURNING id::text");
    asUser(PREPARATEUR, "SELECT budget_submit('" + budget + "')::text");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT budget_approve('" + budget + "')::text")).hasMessageContaining("Droit insuffisant");
    owner("SELECT set_config('qerp.system_roles_seed', 'on', false); INSERT INTO erp_role_permissions (role_id, permission_code) SELECT id, 'budget.approve' FROM erp_roles WHERE tenant_id = '"
        + A + "' AND code = 'budget_planner' ON CONFLICT DO NOTHING");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT budget_approve('" + budget + "')::text")).hasMessageContaining("autre personne");
    asUser(APPROBATEUR, "SELECT budget_approve('" + budget + "')::text");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "UPDATE budget_lines SET planned_amount = 1 WHERE id = '" + ligne + "' RETURNING id::text")).hasMessageContaining("réviser");
    assertThatThrownBy(() -> asUser(APPROBATEUR, "SELECT budget_revise_line('" + ligne + "', 120000, '')::text")).hasMessageContaining("Motif");
    asUser(APPROBATEUR, "SELECT budget_revise_line('" + ligne + "', 120000, 'Ouverture du second dépôt')::text");
    assertThat(texte("SELECT old_amount || '>' || new_amount FROM budget_revisions WHERE budget_line_id = '" + ligne + "'")).isEqualTo("100000.00>120000.00");

    owner("INSERT INTO budget_settings (tenant_id, control_mode) VALUES ('" + A + "', 'block') ON CONFLICT (tenant_id) DO UPDATE SET control_mode = 'block'");
    String po1 = commande(80000);
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po1 + "'; UPDATE purchase_orders SET status = 'approved' WHERE id = '" + po1 + "'");
    String e = UUID.randomUUID().toString();
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, entry_date, description, source, status, created_by) VALUES ('" + e + "', '" + A
        + "', 'JE-V73', '2039-02-10', 'Achat comptant', 'manual', 'draft', '" + ADMIN + "');"
        + "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ('" + e + "', '" + compte("601") + "', 10000, 0), ('" + e + "', '" + compte("521") + "', 0, 10000);"
        + "UPDATE journal_entries SET status = 'posted' WHERE id = '" + e + "'");
    assertThat(disponible()).as("budget − engagé (commande) − réalisé (601, sous-compte de 60)").isEqualTo("120000.00 80000.00 10000.00 30000.00");

    String po2 = commande(50000);
    assertThatThrownBy(() -> owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po2 + "'"))
        .hasMessageContaining("Budget dépassé").hasMessageContaining("50000");
    assertThatThrownBy(() -> asUser(PREPARATEUR, "SELECT budget_override_po('" + po2 + "', 'Urgence chantier')::text")).hasMessageContaining("Droit insuffisant");
    asUser(ADMIN, "SELECT budget_override_po('" + po2 + "', 'Urgence chantier')::text");
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po2 + "'");
    assertThat(texte("SELECT budget_warning FROM purchase_orders WHERE id = '" + po2 + "'")).contains("Dépassement du budget 60");

    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, po_id, invoice_date, due_date, subtotal, tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + A + "', 'FF-V73-1', '" + FOURNISSEUR + "', '" + po1 + "', '2039-03-20', '2039-04-20', 30000, 0, 'draft', 'draft', '" + ADMIN + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = 'FF-V73-1'");
    assertThat(disponible()).as("facturé : l'engagé baisse, le réalisé monte d'autant").isEqualTo("120000.00 50000.00 40000.00 30000.00");

    owner("UPDATE budget_settings SET control_mode = 'warn' WHERE tenant_id = '" + A + "'");
    String po3 = commande(90000);
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po3 + "'");
    assertThat(texte("SELECT budget_warning FROM purchase_orders WHERE id = '" + po3 + "'")).as("mode avertissement : passe, signalée").contains("Dépassement");

    owner("UPDATE budget_settings SET control_mode = 'block' WHERE tenant_id = '" + A + "';"
        + "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + A + "', 'FF-V73-2', '" + FOURNISSEUR + "', '2039-05-02', '2039-06-02', 40000, 0, 'draft', 'draft', '" + ADMIN + "')");
    assertThatThrownBy(() -> owner("UPDATE ap_invoices SET approval_status = 'submitted' WHERE invoice_number = 'FF-V73-2'"))
        .as("facture sans commande : 40 000 pour 30 000 disponibles (commandes en attente non engagées)").hasMessageContaining("Budget dépassé");
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
