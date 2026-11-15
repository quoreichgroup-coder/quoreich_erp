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
 * V77 (lot B2) — pré-engagement des demandes d'achat et budgets par section analytique : une demande soumise
 * réserve le budget et se contrôle comme une commande ; la section d'une demande passe à la commande puis à la
 * facture, dont l'écriture l'impute à la ligne de charges ; une ligne de budget sur une section couvre ses
 * sous-sections ; l'imputation d'une pièce approuvée est figée.
 */
@SpringBootTest
class BudgetPreEngagementAnalytiqueIT {

  private static final String DATABASE = "qerp_it_budget_pre_engagement";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0077";
  private static final String AXE = "00000000-0000-0000-0000-0000000a0077";
  private static final String DIR = "00000000-0000-0000-0000-0000000d0077";
  private static final String ATELIER = "00000000-0000-0000-0000-0000000d0078";
  private static final String AUTRE = "00000000-0000-0000-0000-0000000d0079";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V77') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type, is_header) VALUES ('" + A + "', '60', 'Achats et variations de stocks', 'expense', true)"
        + " ON CONFLICT (tenant_id, code) DO NOTHING;"
        + "INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('" + AXE + "', '" + A + "', 'CF', 'Centre financier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO analytic_values (id, tenant_id, axis_id, code, name, parent_id) VALUES"
        + " ('" + DIR + "', '" + A + "', '" + AXE + "', 'PROD', 'Production', NULL),"
        + " ('" + ATELIER + "', '" + A + "', '" + AXE + "', 'PROD-AT', 'Atelier', '" + DIR + "'),"
        + " ('" + AUTRE + "', '" + A + "', '" + AXE + "', 'ADM', 'Administration', NULL) ON CONFLICT (id) DO NOTHING");
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  /** Demande en brouillon, imputée à une section, puis soumise (le contrôle se déclenche au changement de statut). */
  private static String demande(int total, String section) {
    String pr = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_requisitions (id, tenant_id, requested_by, request_date, description, estimated_total, status) VALUES ('" + pr + "', '" + A
        + "', '" + ADMIN + "', '2041-03-02', 'Demande V77', " + total + ", 'draft');"
        + "INSERT INTO purchase_requisition_analytics (tenant_id, document_id, axis_id, value_id) VALUES ('" + A + "', '" + pr + "', '" + AXE + "', '" + section + "')");
    return pr;
  }

  private static String situation(String section) throws SQLException {
    return asUser(ADMIN, "SELECT trim_scale(planned) || ' ' || trim_scale(precommitted) || ' ' || trim_scale(committed) || ' ' || trim_scale(actual) || ' ' || trim_scale(available) FROM budget_status('2041')"
        + " WHERE account_code = '60' AND analytic_value_id " + (section == null ? "IS NULL" : "= '" + section + "'"));
  }

  @Test
  @DisplayName("demande pré-engagée et contrôlée ; section reprise jusqu'à l'écriture ; budget de section couvrant ses sous-sections")
  void preEngagementEtAnalytique() throws SQLException {
    String budget = UUID.randomUUID().toString();
    owner("INSERT INTO budgets (id, tenant_id, name, fiscal_year, scenario, total_amount, status, is_control, created_by, approved_by, approved_at) VALUES ('" + budget
        + "', '" + A + "', 'Budget 2041', '2041', 'base', 0, 'approved', true, '" + ADMIN + "', '" + ADMIN + "', now());"
        + "INSERT INTO budget_lines (tenant_id, budget_id, gl_account_id, period, planned_amount, analytic_value_id) VALUES"
        + " ('" + A + "', '" + budget + "', '" + compte("60") + "', '2041', 100000, NULL),"
        + " ('" + A + "', '" + budget + "', '" + compte("60") + "', '2041', 30000, '" + DIR + "');"
        + "INSERT INTO budget_settings (tenant_id, control_mode) VALUES ('" + A + "', 'block') ON CONFLICT (tenant_id) DO UPDATE SET control_mode = 'block'");

    String pr1 = demande(20000, ATELIER);
    owner("UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '" + pr1 + "'");
    assertThat(situation(null)).as("demande soumise : pré-engagée sur la ligne générale").isEqualTo("100000 20000 0 0 80000");
    assertThat(situation(DIR)).as("… et sur la section parente de l'atelier").isEqualTo("30000 20000 0 0 10000");

    String pr2 = demande(15000, ATELIER);
    assertThatThrownBy(() -> owner("UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '" + pr2 + "'"))
        .as("15 000 pour 10 000 disponibles sur la section Production").hasMessageContaining("Budget dépassé").hasMessageContaining("PROD Production");
    String pr3 = demande(15000, AUTRE);
    owner("UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '" + pr3 + "'");
    assertThat(situation(DIR)).as("une autre section ne consomme pas le budget de Production").isEqualTo("30000 20000 0 0 10000");

    asUser(ADMIN, "SELECT budget_override_document('PR', '" + pr2 + "', 'Panne de la ligne 2')::text");
    owner("UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '" + pr2 + "'");
    assertThat(texte("SELECT budget_warning FROM purchase_requisitions WHERE id = '" + pr2 + "'")).contains("PROD Production");
    owner("UPDATE purchase_requisitions SET status = 'cancelled' WHERE id = '" + pr2 + "'");

    // Conversion : la demande libère son pré-engagement, la commande reprend sa section.
    String po = UUID.randomUUID().toString();
    owner("UPDATE purchase_requisitions SET status = 'approved' WHERE id = '" + pr1 + "';"
        + "INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_date, total, status, created_by) VALUES ('" + po + "', '" + A + "', '" + FOURNISSEUR
        + "', '2041-03-05', 20000, 'draft', '" + ADMIN + "');"
        + "UPDATE purchase_requisitions SET po_id = '" + po + "', status = 'converted' WHERE id = '" + pr1 + "'");
    assertThat(texte("SELECT value_id::text FROM purchase_order_analytics WHERE document_id = '" + po + "'")).isEqualTo(ATELIER);
    assertThat(situation(DIR)).as("convertie, commande en brouillon : rien n'est réservé").isEqualTo("30000 0 0 0 30000");
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po + "'; UPDATE purchase_orders SET status = 'approved' WHERE id = '" + po + "'");
    assertThat(situation(DIR)).isEqualTo("30000 0 20000 0 10000");
    assertThatThrownBy(() -> asUser(ADMIN, "DELETE FROM purchase_order_analytics WHERE document_id = '" + po + "' RETURNING value_id::text"))
        .as("commande approuvée : imputation figée").hasMessageContaining("figée");

    // Facture : section reprise de la commande, imputée à la ligne de charges de l'écriture.
    String inv = UUID.randomUUID().toString();
    owner("INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, po_id, invoice_date, due_date, subtotal, tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + inv + "', '" + A + "', 'FF-V77-1', '" + FOURNISSEUR + "', '" + po + "', '2041-03-20', '2041-04-20', 20000, 0, 'draft', 'draft', '" + ADMIN + "')");
    assertThat(texte("SELECT value_id::text FROM ap_invoice_analytics WHERE document_id = '" + inv + "'")).isEqualTo(ATELIER);
    owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + inv + "'");
    assertThat(texte("SELECT string_agg(g.code || '=' || COALESCE(v.code, '-'), ',' ORDER BY g.code) FROM ap_invoices i JOIN journal_lines l ON l.entry_id = i.journal_entry_id"
        + " JOIN gl_accounts g ON g.id = l.account_id LEFT JOIN journal_line_analytics la ON la.line_id = l.id LEFT JOIN analytic_values v ON v.id = la.value_id WHERE i.id = '" + inv + "'"))
        .as("seule la charge porte la section").isEqualTo("401=-,601=PROD-AT");
    assertThat(situation(DIR)).as("facturée : l'engagé devient réalisé sur la section").isEqualTo("30000 0 0 20000 10000");
    assertThat(asUser(ADMIN, "SELECT actual::text FROM budget_monthly_actual('2041') m JOIN budget_lines l ON l.id = m.line_id WHERE l.analytic_value_id = '" + DIR + "' AND m.month = 3"))
        .isEqualTo("20000.00");

    owner("UPDATE budget_settings SET precommit_requisitions = false WHERE tenant_id = '" + A + "'");
    assertThat(situation(null)).as("pré-engagement désactivé : la demande ADM ne compte plus").isEqualTo("100000 0 0 20000 80000");
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
