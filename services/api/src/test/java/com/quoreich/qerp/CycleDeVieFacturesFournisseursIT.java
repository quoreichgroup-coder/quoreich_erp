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
 * V41 — facture fournisseur : brouillon → soumise (contrôles des paramètres de la société) →
 * approuvée par un tiers habilité → comptabilisée ; rejet motivé ; doublon refusé.
 */
@SpringBootTest
class CycleDeVieFacturesFournisseursIT {

  private static final String DATABASE = "qerp_it_cycle_ap";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String AUTEUR = PostgresFixture.ALPHA_USER;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-0000000004a1";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0411";
  private static final String COMMANDE = "00000000-0000-0000-0000-0000000b0411";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A + "', 'Comptable')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V41')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "DELETE FROM ap_approval_thresholds WHERE tenant_id = '" + A + "';"
        + "INSERT INTO ap_general_settings (tenant_id, po_required, three_way_match) VALUES ('" + A + "', 'optional', false)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET po_required = 'optional', three_way_match = false;"
        + "INSERT INTO procurement_settings (tenant_id, require_gr_before_ap, three_way_tolerance_pct, three_way_tolerance_amount)"
        + " VALUES ('" + A + "', false, 2, 5000) ON CONFLICT (tenant_id) DO UPDATE SET require_gr_before_ap = false,"
        + " three_way_tolerance_pct = 2, three_way_tolerance_amount = 5000");
    PostgresFixture.grantRoles(DATABASE, AUTEUR, "admin", A, COMPTABLE, "accountant", A);
  }

  private static String facture(String numero, int ht, String po) throws SQLException {
    return asUser(AUTEUR, "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, po_id, invoice_date, due_date,"
        + " subtotal, tax_amount, total, status, approval_status, created_by) VALUES (get_user_tenant_id(auth.uid()), '"
        + numero + "', '" + FOURNISSEUR + "', " + (po == null ? "NULL" : "'" + po + "'") + ", CURRENT_DATE, CURRENT_DATE + 30, "
        + ht + ", 0, " + ht + ", 'draft', 'pending', auth.uid()) RETURNING id::text");
  }

  private static String etape(String facture) {
    return texte("SELECT id::text FROM ap_invoice_approvals WHERE invoice_id = '" + facture + "' AND status = 'pending'"
        + " ORDER BY level_order LIMIT 1");
  }

  @Test
  @DisplayName("brouillon → soumise → l'auteur ne décide pas → le comptable approuve → comptabilisée ; plus d'approbation directe")
  void approbationParUnTiers() throws SQLException {
    String f = facture("FF-V41-1", 100000, null);
    assertThat(texte("SELECT approval_status FROM ap_invoices WHERE id = '" + f + "'")).isEqualTo("draft");
    assertThatThrownBy(() -> asUser(AUTEUR, "UPDATE ap_invoices SET approval_status = 'approved', status = 'open'"
            + " WHERE id = '" + f + "' RETURNING id::text"))
        .hasMessageContaining("change par soumission");

    assertThat(asUser(AUTEUR, "SELECT ap_invoice_submit('" + f + "')::text")).isEqualTo("1");
    assertThatThrownBy(() -> asUser(AUTEUR, "UPDATE ap_invoices SET subtotal = 1 WHERE id = '" + f + "' RETURNING id::text"))
        .hasMessageContaining("seule une facture en brouillon ou rejetée");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_decide('" + etape(f) + "', true, null)::text"))
        .hasMessageContaining("Séparation des tâches");

    asUser(COMPTABLE, "SELECT ap_invoice_decide('" + etape(f) + "', true, 'Bon à payer')::text");
    assertThat(texte("SELECT approval_status || ' ' || status || ' ' || (journal_entry_id IS NOT NULL)::text FROM ap_invoices"
            + " WHERE id = '" + f + "'"))
        .as("approuvée, ouverte, comptabilisée (V37)")
        .isEqualTo("approved open true");

    assertThatThrownBy(() -> facture("ff-v41-1 ", 5, null))
        .as("même fournisseur, même numéro (casse et espaces ignorés)")
        .hasMessageContaining("ap_invoices_supplier_number_key");
  }

  @Test
  @DisplayName("paramètres : bon de commande exigé, réception exigée, rapprochement à 3 voies avec tolérance ; rejet motivé")
  void parametresEtRejet() throws SQLException {
    owner("UPDATE ap_general_settings SET po_required = 'mandatory', three_way_match = true WHERE tenant_id = '" + A + "';"
        + "UPDATE procurement_settings SET require_gr_before_ap = true WHERE tenant_id = '" + A + "';"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES"
        + " ('" + COMMANDE + "', '" + A + "', 'BC-V41', '" + FOURNISSEUR + "', 'approved', '" + AUTEUR + "') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO po_lines (id, po_id, description, quantity, unit_cost) VALUES"
        + " ('00000000-0000-0000-0000-0000000b0412', '" + COMMANDE + "', 'Article', 10, 10000) ON CONFLICT (id) DO NOTHING");

    String sansCommande = facture("FF-V41-SANS", 50000, null);
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + sansCommande + "')::text"))
        .hasMessageContaining("exige un bon de commande");

    String avantReception = facture("FF-V41-AVANT", 50000, COMMANDE);
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + avantReception + "')::text"))
        .hasMessageContaining("exige une réception");

    // Réception de 6 unités sur 10 : 60 000 reçus ; tolérance max(5 000, 2 %) = 5 000.
    owner("INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, received_by) VALUES"
        + " ('00000000-0000-0000-0000-0000000c0411', '" + A + "', 'REC-V41', '" + COMMANDE + "', '" + AUTEUR + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES"
        + " ('00000000-0000-0000-0000-0000000c0411', '00000000-0000-0000-0000-0000000b0412', 6);"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '00000000-0000-0000-0000-0000000c0411'");
    String tropCher = facture("FF-V41-TROP", 66000, COMMANDE);
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + tropCher + "')::text"))
        .hasMessageContaining("Rapprochement à 3 voies");
    String dansTolerance = facture("FF-V41-OK", 64000, COMMANDE);
    assertThat(asUser(AUTEUR, "SELECT ap_invoice_submit('" + dansTolerance + "')::text")).isEqualTo("1");

    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT ap_invoice_decide('" + etape(dansTolerance) + "', false, ' ')::text"))
        .hasMessageContaining("Motif");
    asUser(COMPTABLE, "SELECT ap_invoice_decide('" + etape(dansTolerance) + "', false, 'Prix unitaire à justifier')::text");
    assertThat(texte("SELECT approval_status FROM ap_invoices WHERE id = '" + dansTolerance + "'")).isEqualTo("rejected");
    asUser(AUTEUR, "UPDATE ap_invoices SET subtotal = 60000, total = 60000 WHERE id = '" + dansTolerance + "' RETURNING id::text");
    assertThat(asUser(AUTEUR, "SELECT ap_invoice_submit('" + dansTolerance + "')::text")).isEqualTo("1");
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
