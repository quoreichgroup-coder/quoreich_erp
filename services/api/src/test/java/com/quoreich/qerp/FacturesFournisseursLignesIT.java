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
 * V72 (lot A4, G-17 / G-18) — factures fournisseurs à lignes : en-tête = somme des lignes, TTC de
 * contrôle, 3 voies ligne à ligne (quantité, prix, tolérance), factures non parvenues (408) à la
 * réception soldées par la facture, retour contre-passé, écart de prix en charge, droit ap.invoice.
 */
@SpringBootTest
class FacturesFournisseursLignesIT {

  private static final String DATABASE = "qerp_it_factures_fournisseurs_lignes";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String AUTEUR = PostgresFixture.ALPHA_USER;
  private static final String COMPTABLE = "aaaaaaaa-7272-0000-0000-000000000072";
  private static final String LECTEUR = "aaaaaaaa-7272-0000-0000-000000000073";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0072";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "'), ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A + "', 'Comptable'), ('" + LECTEUR + "', '" + A
        + "', 'Lecteur') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V72') ON CONFLICT (id) DO NOTHING;"
        + "DELETE FROM ap_approval_thresholds WHERE tenant_id = '" + A + "';"
        + "INSERT INTO ap_general_settings (tenant_id, po_required, three_way_match) VALUES ('" + A + "', 'optional', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET po_required = 'optional', three_way_match = true;"
        + "INSERT INTO procurement_settings (tenant_id, require_gr_before_ap, three_way_tolerance_pct, three_way_tolerance_amount, grni_on_receipt)"
        + " VALUES ('" + A + "', false, 0, 0, true) ON CONFLICT (tenant_id) DO UPDATE SET require_gr_before_ap = false,"
        + " three_way_tolerance_pct = 0, three_way_tolerance_amount = 0, grni_on_receipt = true");
    PostgresFixture.grantRoles(DATABASE, AUTEUR, "admin", A, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  /** Commande approuvée à deux lignes (10 × 1 000, 5 × 2 000) ; renvoie [commande, ligne 1, ligne 2]. */
  private static String[] commande() {
    String po = UUID.randomUUID().toString(), l1 = UUID.randomUUID().toString(), l2 = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, created_by) VALUES ('" + po + "', '" + A + "', '" + FOURNISSEUR + "', 'approved', '" + AUTEUR + "');"
        + "INSERT INTO po_lines (id, po_id, description, quantity, unit_cost) VALUES ('" + l1 + "', '" + po + "', 'Ciment', 10, 1000), ('" + l2 + "', '" + po + "', 'Fer', 5, 2000)");
    return new String[] {po, l1, l2};
  }

  private static String recevoir(String po, String l1, int q1, String l2, int q2) {
    String gr = UUID.randomUUID().toString();
    owner("INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, receipt_date, received_by) VALUES ('" + gr + "', '" + A + "', 'REC-V72-" + gr.substring(0, 6)
        + "', '" + po + "', '2038-03-05', '" + AUTEUR + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES ('" + gr + "', '" + l1 + "', " + q1 + ")"
        + (l2 == null ? "" : ", ('" + gr + "', '" + l2 + "', " + q2 + ")") + ";"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr + "'");
    return gr;
  }

  private static String facture(String po) throws SQLException {
    return asUser(AUTEUR, "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, po_id, invoice_date, due_date, subtotal, tax_amount, total, status, approval_status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'FF-V72-" + UUID.randomUUID().toString().substring(0, 6) + "', '" + FOURNISSEUR + "', '" + po
        + "', '2038-03-10', '2038-04-10', 0, 0, 0, 'draft', 'draft', auth.uid()) RETURNING id::text");
  }

  private static void ligne(String f, int no, String poLine, String desc, String qte, String prix, String taxe) throws SQLException {
    asUser(AUTEUR, "INSERT INTO ap_invoice_lines (tenant_id, invoice_id, line_no, po_line_id, description, quantity, unit_price, tax_code_id) VALUES (get_user_tenant_id(auth.uid()), '"
        + f + "', " + no + ", " + (poLine == null ? "NULL" : "'" + poLine + "'") + ", '" + desc + "', " + qte + ", " + prix + ", " + (taxe == null ? "NULL" : "'" + taxe + "'") + ") RETURNING id::text");
  }

  private static String ecriture(String sqlEntry) {
    return texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = (" + sqlEntry + ")");
  }

  private static void approuver(String f) throws SQLException {
    asUser(AUTEUR, "SELECT ap_invoice_submit('" + f + "')::text");
    asUser(COMPTABLE, "SELECT ap_invoice_decide((SELECT id FROM ap_invoice_approvals WHERE invoice_id = '" + f + "' AND status = 'pending' ORDER BY level_order LIMIT 1), true, 'Bon à payer')::text");
  }

  @Test
  @DisplayName("408 à la réception, 3 voies ligne à ligne (quantité, prix), TTC de contrôle, facture soldant 408, lignes figées")
  void lignesEt408() throws SQLException {
    String[] c = commande();
    String gr = recevoir(c[0], c[1], 8, c[2], 5);
    assertThat(ecriture("SELECT journal_entry_id FROM grni_ledger WHERE source_id = '" + gr + "' LIMIT 1")).as("réception : DR achats / CR 408")
        .isEqualTo("408:0.00/18000.00 601:18000.00/0.00");

    String tva = texte("SELECT id::text FROM tax_codes WHERE tenant_id = '" + A + "' AND code = 'TVA18V72'");
    if (tva == null) {
      owner("INSERT INTO tax_codes (tenant_id, code, name, rate) VALUES ('" + A + "', 'TVA18V72', 'TVA 18 %', 18)");
      tva = texte("SELECT id::text FROM tax_codes WHERE tenant_id = '" + A + "' AND code = 'TVA18V72'");
    }
    String f = facture(c[0]);
    ligne(f, 1, c[1], "Ciment", "9", "1000", null);
    ligne(f, 2, c[2], "Fer", "5", "2000", tva);
    assertThat(texte("SELECT subtotal || ' ' || tax_amount || ' ' || total FROM ap_invoices WHERE id = '" + f + "'")).as("en-tête = somme des lignes")
        .isEqualTo("19000.00 1800.00 20800.00");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + f + "')::text")).hasMessageContaining("9.0000 facturé pour 8");

    asUser(AUTEUR, "UPDATE ap_invoice_lines SET quantity = 8, unit_price = 1050 WHERE invoice_id = '" + f + "' AND line_no = 1 RETURNING id::text");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + f + "')::text")).hasMessageContaining("au-dessus du prix commandé");
    asUser(AUTEUR, "UPDATE ap_invoice_lines SET unit_price = 1000 WHERE invoice_id = '" + f + "' AND line_no = 1 RETURNING id::text");
    asUser(AUTEUR, "UPDATE ap_invoices SET control_total = 20000 WHERE id = '" + f + "' RETURNING id::text");
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT ap_invoice_submit('" + f + "')::text")).hasMessageContaining("montant TTC de contrôle");
    asUser(AUTEUR, "UPDATE ap_invoices SET control_total = 19800 WHERE id = '" + f + "' RETURNING id::text");

    approuver(f);
    assertThat(ecriture("SELECT journal_entry_id FROM ap_invoices WHERE id = '" + f + "'")).as("facture : DR 408 / DR TVA / CR fournisseur")
        .isEqualTo("401:0.00/19800.00 408:18000.00/0.00 4452:1800.00/0.00");
    assertThat(texte("SELECT (grni_open('" + c[1] + "') + grni_open('" + c[2] + "'))::text")).isEqualTo("0.00");
    assertThatThrownBy(() -> ligne(f, 3, null, "Ajout", "1", "10", null)).hasMessageContaining("ne se modifient qu");
  }

  @Test
  @DisplayName("retour contre-passé sur 408, écart de prix toléré passé en charge ; lecteur sans droit de saisie")
  void retourEtEcartDePrix() throws SQLException {
    owner("UPDATE procurement_settings SET three_way_tolerance_pct = 5 WHERE tenant_id = '" + A + "'");
    String[] c = commande();
    String gr = recevoir(c[0], c[1], 10, null, 0);
    String grl = texte("SELECT id::text FROM gr_lines WHERE gr_id = '" + gr + "'");
    asUser(AUTEUR, "SELECT create_supplier_return('" + gr + "', 'Sacs abîmés', '2038-03-06', '[{\"gr_line_id\":\"" + grl + "\",\"quantity\":2}]'::jsonb, false, NULL, NULL)::text");
    assertThat(texte("SELECT grni_open('" + c[1] + "')::text")).as("10 reçus − 2 retournés, au prix commandé").isEqualTo("8000.00");

    String f = facture(c[0]);
    ligne(f, 1, c[1], "Ciment", "8", "1040", null);
    approuver(f);
    assertThat(ecriture("SELECT journal_entry_id FROM ap_invoices WHERE id = '" + f + "'")).as("écart de prix (4 %, toléré) en charge")
        .isEqualTo("401:0.00/8320.00 408:8000.00/0.00 601:320.00/0.00");

    assertThat(asUser(LECTEUR, "SELECT count(*)::text FROM ap_invoices WHERE id = '" + f + "'")).isEqualTo("1");
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, total, status, approval_status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'FF-V72-L', '" + FOURNISSEUR + "', '2038-03-10', '2038-04-10', 1, 0, 1, 'draft', 'draft', auth.uid()) RETURNING id::text"))
        .hasMessageContaining("row-level security");
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
