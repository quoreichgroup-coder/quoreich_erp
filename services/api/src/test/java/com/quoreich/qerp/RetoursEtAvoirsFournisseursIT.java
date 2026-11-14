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
 * V52 — retour fournisseur sur réception (stock sorti au coût de commande, jamais le 401) et avoir
 * fournisseur lié à la facture (écriture miroir AC, imputé sur le reste dû) ; remplacement attendu =
 * quantité de nouveau à recevoir ; rapprochement à 3 voies net des retours.
 */
@SpringBootTest
class RetoursEtAvoirsFournisseursIT {

  private static final String DATABASE = "qerp_it_retours_fournisseurs";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0521";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    owner("INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V52')"
        + " ON CONFLICT (id) DO NOTHING");
  }

  /** Commande approuvée d'un article stocké, réceptionnée en totalité ; renvoie [article, commande, ligne, réception, ligne reçue]. */
  private static String[] reception(int quantite, int cout) {
    String art = UUID.randomUUID().toString(), po = UUID.randomUUID().toString(), pl = UUID.randomUUID().toString();
    String gr = UUID.randomUUID().toString(), gl = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost) VALUES ('" + art + "', '" + A
        + "', 'F-" + art.substring(0, 6) + "', 'Article acheté', 0, 0);"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES ('" + po + "', '" + A
        + "', 'PO-" + po.substring(0, 6) + "', '" + FOURNISSEUR + "', 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (id, po_id, item_id, description, quantity, unit_cost) VALUES ('" + pl + "', '" + po + "', '"
        + art + "', 'Article acheté', " + quantite + ", " + cout + ");"
        + "INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, received_by) VALUES ('" + gr + "', '" + A + "', 'GR-"
        + gr.substring(0, 6) + "', '" + po + "', '" + ADMIN + "');"
        + "INSERT INTO gr_lines (id, gr_id, po_line_id, quantity_received) VALUES ('" + gl + "', '" + gr + "', '" + pl + "', "
        + quantite + ");"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr + "'");
    return new String[] {art, po, pl, gr, gl};
  }

  private static String facture(String po, int ht, int tva) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount,"
        + " status, approval_status, created_by, po_id) VALUES ('" + id + "', '" + A + "', 'FF-" + id.substring(0, 6) + "', '"
        + FOURNISSEUR + "', CURRENT_DATE, CURRENT_DATE + 30, " + ht + ", " + tva + ", 'draft', 'pending', '" + ADMIN + "', '"
        + po + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + id + "'");
    return id;
  }

  private static String lignes(String grLine, int qte) {
    return "jsonb_build_array(jsonb_build_object('gr_line_id', '" + grLine + "', 'quantity', " + qte + "))";
  }

  private static String ecriture(String entryIdSql) {
    return texte("SELECT e.journal_code || ' : ' || string_agg(g.code || CASE WHEN l.debit > 0 THEN ' D ' || l.debit::text"
        + " ELSE ' C ' || l.credit::text END, ' | ' ORDER BY l.debit DESC, g.code) FROM journal_entries e"
        + " JOIN journal_lines l ON l.entry_id = e.id JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE e.id = (" + entryIdSql + ") GROUP BY e.journal_code");
  }

  @Test
  @DisplayName("retour avec avoir : stock sorti 6031/311, avoir AC 401/601/4452 imputé sur la facture, contrôles")
  void retourAvecAvoir() throws SQLException {
    String[] r = reception(10, 2000);
    String inv = facture(r[1], 20000, 3600);

    String ret = asUser("SELECT create_supplier_return('" + r[3] + "', 'Articles défectueux', CURRENT_DATE, "
        + lignes(r[4], 3) + ", false, '" + inv + "', 'AV-FRN-1')::text");

    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + r[0] + "'")).isEqualTo("7.00");
    assertThat(ecriture("SELECT journal_entry_id FROM stock_movements WHERE reference_type = 'supplier_return' AND reference_id = '" + ret + "'"))
        .isEqualTo("OD : 6031 D 6000.00 | 311 C 6000.00");
    assertThat(texte("SELECT c.credit_note_number LIKE 'AVF-%' AND c.total = 7080 AND c.amount_allocated = 7080"
            + " AND c.supplier_reference = 'AV-FRN-1' AND c.supplier_return_id = r.id FROM supplier_returns r"
            + " JOIN ap_credit_notes c ON c.id = r.credit_note_id WHERE r.id = '" + ret + "'"))
        .isEqualTo("t");
    assertThat(ecriture("SELECT c.journal_entry_id FROM supplier_returns r JOIN ap_credit_notes c ON c.id = r.credit_note_id"
            + " WHERE r.id = '" + ret + "'"))
        .isEqualTo("AC : 401 D 7080.00 | 4452 C 1080.00 | 601 C 6000.00");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ap_invoices WHERE id = '" + inv + "'"))
        .isEqualTo("partially_paid 7080.00");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + r[1] + "'")).as("pas de remplacement attendu").isEqualTo("received");

    assertThatThrownBy(() -> asUser("SELECT create_supplier_return('" + r[3] + "', 'Trop', CURRENT_DATE, " + lignes(r[4], 8) + ")::text"))
        .hasMessageContaining("reste 7");
    assertThatThrownBy(() -> asUser("SELECT create_supplier_return('" + r[3] + "', ' ', CURRENT_DATE, " + lignes(r[4], 1) + ")::text"))
        .hasMessageContaining("Motif");
    assertThatThrownBy(() -> asUser("SELECT create_ap_credit_note('" + inv + "', 'Remise', CURRENT_DATE, 15000, 0)::text"))
        .as("HT des avoirs plafonné au HT de la facture")
        .hasMessageContaining("supérieur au HT");
    assertThatThrownBy(() -> asUser("INSERT INTO payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date,"
            + " payment_method, created_by) VALUES ('" + A + "', 'ap_credit', '" + inv + "', 10, CURRENT_DATE, 'credit_note', '"
            + ADMIN + "') RETURNING id::text"))
        .hasMessageContaining("fonction d'avoir");
    String imputation = texte("SELECT id::text FROM payments WHERE ap_invoice_id = '" + inv + "' AND payment_type = 'ap_credit'");
    assertThatThrownBy(() -> asUser("SELECT reverse_settlement('" + imputation + "', 'Erreur', CURRENT_DATE)::text"))
        .hasMessageContaining("ne s'annule pas");
  }

  @Test
  @DisplayName("remplacement attendu : la commande se réceptionne de nouveau ; avoir différé ; 3 voies net des retours")
  void remplacementEtAvoirDiffere() throws SQLException {
    String[] r = reception(5, 1000);
    String ret = asUser("SELECT create_supplier_return('" + r[3] + "', 'Mauvaise référence', CURRENT_DATE, "
        + lignes(r[4], 2) + ", true)::text");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + r[1] + "'")).isEqualTo("partially_received");
    assertThat(texte("SELECT (credit_note_id IS NULL)::text || ' ' || total_value::text FROM supplier_returns WHERE id = '" + ret + "'"))
        .isEqualTo("true 2000.00");

    // Facturation à 3 voies : reçu 5 − retourné 2 = 3 000 facturables, tolérance nulle.
    owner("INSERT INTO ap_general_settings (tenant_id, po_required, three_way_match) VALUES ('" + A + "', 'optional', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET three_way_match = true;"
        + "INSERT INTO procurement_settings (tenant_id, require_gr_before_ap, three_way_tolerance_pct, three_way_tolerance_amount)"
        + " VALUES ('" + A + "', false, 0, 0) ON CONFLICT (tenant_id) DO UPDATE SET three_way_tolerance_pct = 0,"
        + " three_way_tolerance_amount = 0");
    String tropCher = UUID.randomUUID().toString();
    owner("INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount,"
        + " status, approval_status, created_by, po_id) VALUES ('" + tropCher + "', '" + A + "', 'FF-3V-" + tropCher.substring(0, 4)
        + "', '" + FOURNISSEUR + "', CURRENT_DATE, CURRENT_DATE + 30, 5000, 0, 'draft', 'draft', '" + ADMIN + "', '" + r[1] + "')");
    assertThatThrownBy(() -> asUser("SELECT ap_invoice_submit('" + tropCher + "')::text"))
        .hasMessageContaining("Rapprochement à 3 voies");
    owner("UPDATE ap_general_settings SET three_way_match = false WHERE tenant_id = '" + A + "'");

    // Livraison de remplacement : 2 acceptés (reste à recevoir), 3 refusés.
    String gr2 = UUID.randomUUID().toString();
    owner("INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, received_by) VALUES ('" + gr2 + "', '" + A + "', 'GR-"
        + gr2.substring(0, 6) + "', '" + r[1] + "', '" + ADMIN + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES ('" + gr2 + "', '" + r[2] + "', 3)");
    assertThatThrownBy(() -> owner("UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr2 + "'"))
        .hasStackTraceContaining("Sur-réception");
    owner("DELETE FROM gr_lines WHERE gr_id = '" + gr2 + "';"
        + "INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES ('" + gr2 + "', '" + r[2] + "', 2);"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '" + gr2 + "'");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + r[1] + "'")).isEqualTo("received");

    // Avoir différé : seulement sur une facture de la même commande.
    String autre = facture(reception(1, 100)[1], 100, 0);
    assertThatThrownBy(() -> asUser("SELECT credit_supplier_return('" + ret + "', '" + autre + "')::text"))
        .hasMessageContaining("commande du retour");
    String inv = facture(r[1], 5000, 900);
    asUser("SELECT credit_supplier_return('" + ret + "', '" + inv + "', 'AV-77')::text");
    assertThat(texte("SELECT c.subtotal::text || ' ' || c.tax_amount::text FROM supplier_returns r JOIN ap_credit_notes c"
            + " ON c.id = r.credit_note_id WHERE r.id = '" + ret + "'"))
        .as("2 × 1 000 ; TVA au taux de la facture (18 %)")
        .isEqualTo("2000.00 360.00");
    assertThatThrownBy(() -> asUser("SELECT credit_supplier_return('" + ret + "', '" + inv + "')::text"))
        .hasMessageContaining("déjà son avoir");
  }

  // ─── Outils ───

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + ADMIN + "\",\"role\":\"authenticated\"}");
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
