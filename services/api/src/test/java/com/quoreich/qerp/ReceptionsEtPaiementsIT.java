package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V34 — correctifs critiques du Lot 3 (docs/audit-lot3.md, ACH-1, ACH-2, AP-8, GL-1).
 *
 * <ul>
 *   <li>Réception : le stock n'est compté qu'une fois, au coût de la commande ; la réception
 *       partielle laisse la commande « partiellement reçue » ; la sur-réception est refusée ;
 *       une réception naît en attente (en-tête, puis lignes) et, validée, est figée.
 *   <li>Les écritures de paiement sont datées du paiement, non du jour de saisie.
 *   <li>Un membre sans rôle comptable n'écrit plus de ligne d'écriture.
 * </ul>
 */
@SpringBootTest
class ReceptionsEtPaiementsIT {

  private static final String DATABASE = "qerp_it_receptions";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String SANS_DROIT = "aaaaaaaa-0000-0000-0000-0000000000e1";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-00000000f101";
  private static final String ARTICLE = "00000000-0000-0000-0000-00000000a101";
  private static final String COMMANDE = "00000000-0000-0000-0000-00000000b101";
  private static final String LIGNE = "00000000-0000-0000-0000-00000000b102";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    owner("INSERT INTO auth.users (id) VALUES ('" + SANS_DROIT + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + SANS_DROIT + "', '" + A + "', 'Membre sans rôle')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V34')"
        + " ON CONFLICT (id) DO NOTHING");
  }

  @Test
  @DisplayName("réception : stock compté une fois au coût de la commande, partielle puis complète, sur-réception refusée")
  void receptionPartiellePuisComplete() {
    owner("INSERT INTO items (id, tenant_id, code, name) VALUES ('" + ARTICLE + "', '" + A + "', 'ART-V34', 'Article V34');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES"
        + " ('" + COMMANDE + "', '" + A + "', 'BC-V34', '" + FOURNISSEUR + "', 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (id, po_id, item_id, description, quantity, unit_cost) VALUES"
        + " ('" + LIGNE + "', '" + COMMANDE + "', '" + ARTICLE + "', 'Article V34', 10, 1000)");

    recevoir("REC-V34-1", 4, "CURRENT_DATE - 3");
    assertThat(texte("SELECT quantity_on_hand::numeric(18,2) || ' ' || average_cost::numeric(18,2) FROM items"
            + " WHERE id = '" + ARTICLE + "'"))
        .as("4 unités reçues : stock 4 (et non 8), coût moyen = coût de la commande")
        .isEqualTo("4.00 1000.00");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + COMMANDE + "'")).isEqualTo("partially_received");
    assertThat(texte("SELECT (movement_date = CURRENT_DATE - 3)::text || ' ' || unit_cost::numeric(18,2)"
            + " FROM stock_movements WHERE item_id = '" + ARTICLE + "'"))
        .as("mouvement daté de la réception et valorisé")
        .isEqualTo("true 1000.00");

    assertThatThrownBy(() -> recevoir("REC-V34-2", 7, "CURRENT_DATE"))
        .hasMessageContaining("Sur-réception refusée");
    assertThat(compte("SELECT count(*) FROM goods_receipts WHERE gr_number = 'REC-V34-2' AND status = 'completed'")).isZero();

    owner("DELETE FROM goods_receipts WHERE gr_number = 'REC-V34-2'");
    recevoir("REC-V34-3", 6, "CURRENT_DATE");
    assertThat(texte("SELECT quantity_on_hand::numeric(18,2)::text FROM items WHERE id = '" + ARTICLE + "'")).isEqualTo("10.00");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + COMMANDE + "'")).isEqualTo("received");

    assertThatThrownBy(() -> recevoir("REC-V34-4", 1, "CURRENT_DATE"))
        .as("une commande entièrement reçue n'accepte plus de réception")
        .hasMessageContaining("Réception refusée");
  }

  @Test
  @DisplayName("réception : créée en attente, validée elle est figée (en-tête et lignes)")
  void receptionValideeFigee() {
    owner("INSERT INTO items (id, tenant_id, code, name) VALUES ('00000000-0000-0000-0000-00000000a201', '" + A + "', 'ART-V34-B', 'B');"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000b201', '" + A + "', 'BC-V34-B', '" + FOURNISSEUR + "', 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (id, po_id, item_id, description, quantity, unit_cost) VALUES"
        + " ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000b201',"
        + " '00000000-0000-0000-0000-00000000a201', 'B', 5, 200)");

    assertThatThrownBy(() -> owner("INSERT INTO goods_receipts (tenant_id, gr_number, po_id, status, received_by) VALUES"
            + " ('" + A + "', 'REC-V34-DIRECT', '00000000-0000-0000-0000-00000000b201', 'completed', '" + ADMIN + "')"))
        .hasMessageContaining("se crée en attente");

    owner("INSERT INTO goods_receipts (id, tenant_id, gr_number, po_id, received_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000c201', '" + A + "', 'REC-V34-VIDE', '00000000-0000-0000-0000-00000000b201', '" + ADMIN + "')");
    assertThatThrownBy(() -> owner("UPDATE goods_receipts SET status = 'completed' WHERE id = '00000000-0000-0000-0000-00000000c201'"))
        .hasMessageContaining("sans ligne");

    owner("INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES"
        + " ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-00000000b202', 2);"
        + "UPDATE goods_receipts SET status = 'completed' WHERE id = '00000000-0000-0000-0000-00000000c201'");
    assertThat(texte("SELECT quantity_on_hand::numeric(18,2)::text FROM items WHERE id = '00000000-0000-0000-0000-00000000a201'"))
        .as("article repris de la ligne de commande quand la ligne reçue ne le précise pas")
        .isEqualTo("2.00");

    assertThatThrownBy(() -> owner("UPDATE goods_receipts SET status = 'pending' WHERE id = '00000000-0000-0000-0000-00000000c201'"))
        .hasMessageContaining("ne se modifie plus");
    assertThatThrownBy(() -> owner("DELETE FROM goods_receipts WHERE id = '00000000-0000-0000-0000-00000000c201'"))
        .hasMessageContaining("ne se modifie plus");
    assertThatThrownBy(() -> owner("UPDATE gr_lines SET quantity_received = 5 WHERE gr_id = '00000000-0000-0000-0000-00000000c201'"))
        .hasMessageContaining("réception validée");
    assertThatThrownBy(() -> owner("INSERT INTO gr_lines (gr_id, po_line_id, quantity_received) VALUES"
            + " ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-00000000b202', 1)"))
        .hasMessageContaining("réception validée");
    assertThat(texte("SELECT quantity_on_hand::numeric(18,2)::text FROM items WHERE id = '00000000-0000-0000-0000-00000000a201'"))
        .isEqualTo("2.00");
  }

  @Test
  @DisplayName("les écritures d'encaissement et de paiement sont datées du paiement")
  void ecrituresDateesDuPaiement() {
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, total,"
        + " tenant_id, created_by, status, amount_paid) VALUES ('00000000-0000-0000-0000-00000000d301', 'FAC-V34',"
        + " 'c0000001-0000-0000-0000-000000000000', CURRENT_DATE - 10, CURRENT_DATE + 20, 1000, 0, 1000,"
        + " '" + A + "', '" + ADMIN + "', 'sent', 0);"
        + "INSERT INTO payments (ar_invoice_id, amount, reference, tenant_id, payment_type, payment_date, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000d301', 400, 'ENC-V34', '" + A + "', 'ar_receipt', CURRENT_DATE - 5, '" + ADMIN + "');"
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, status,"
        + " approval_status, created_by) VALUES ('00000000-0000-0000-0000-00000000d302', '" + A + "', 'FF-V34',"
        + " '" + FOURNISSEUR + "', CURRENT_DATE - 10, CURRENT_DATE + 20, 500, 'draft', 'approved', '" + ADMIN + "');"
        + "INSERT INTO payments (ap_invoice_id, amount, reference, tenant_id, payment_type, payment_date, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000d302', 500, 'PAY-V34', '" + A + "', 'ap_payment', CURRENT_DATE - 4, '" + ADMIN + "')");

    assertThat(compte("SELECT count(*) FROM journal_entries WHERE description = 'AR Receipt: ENC-V34'"
        + " AND entry_date = CURRENT_DATE - 5 AND status = 'posted'")).isEqualTo(1);
    assertThat(compte("SELECT count(*) FROM journal_entries WHERE description = 'AP Payment: PAY-V34'"
        + " AND entry_date = CURRENT_DATE - 4 AND status = 'posted'")).isEqualTo(1);
  }

  @Test
  @DisplayName("un membre sans rôle comptable ne peut plus ajouter de ligne à une écriture en brouillon")
  void lignesDEcritureReserveesAuxComptables() throws SQLException {
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO journal_entries (id, tenant_id, entry_number, description, source, status, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000e301', '" + A + "', 'JE-V34', 'Brouillon V34', 'manual', 'draft', '" + ADMIN + "')"
        + " ON CONFLICT (id) DO NOTHING");
    String compte = texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' ORDER BY code LIMIT 1");
    String ligne = "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES"
        + " ('00000000-0000-0000-0000-00000000e301', '" + compte + "', 10, 0)";

    assertThatThrownBy(() -> asUser(SANS_DROIT, ligne)).hasMessageContaining("row-level security");
    asUser(ADMIN, ligne);
    assertThat(compte("SELECT count(*) FROM journal_lines WHERE entry_id = '00000000-0000-0000-0000-00000000e301'"))
        .isEqualTo(1);
    assertThat(compte("SELECT count(*) FROM pg_policies WHERE tablename = 'journal_lines' AND policyname = 'Access via entry'"))
        .isZero();
  }

  // ─── Outils ───

  /** Une réception comme l'écran la fait : en-tête en attente, lignes, puis validation. */
  private static void recevoir(String numero, int quantite, String date) {
    owner("INSERT INTO goods_receipts (tenant_id, gr_number, po_id, receipt_date, received_by) VALUES"
        + " ('" + A + "', '" + numero + "', '" + COMMANDE + "', " + date + ", '" + ADMIN + "');"
        + "INSERT INTO gr_lines (gr_id, po_line_id, item_id, quantity_received)"
        + " SELECT id, '" + LIGNE + "', '" + ARTICLE + "', " + quantite + " FROM goods_receipts WHERE gr_number = '" + numero + "'");
    owner("UPDATE goods_receipts SET status = 'completed' WHERE gr_number = '" + numero + "'");
  }

  private static void asUser(String user, String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement()) {
        st.execute(sql);
        c.commit();
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static long compte(String sql) {
    return PostgresFixture.countAsAdmin(DATABASE, sql);
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
