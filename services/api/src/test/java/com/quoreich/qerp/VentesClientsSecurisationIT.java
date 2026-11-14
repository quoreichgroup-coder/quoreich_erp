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
 * V42 — ventes et clients (audit docs/audit-erp, G-01, G-02, G-03, G-06, G-07) : règlements figés et
 * annulables par contre-passation, jamais sur la facture d'une autre société ; facture client figée
 * une fois émise ; livraison qui ne retire le stock qu'une fois, au coût moyen ; facture issue d'une
 * livraison préparée en brouillon avec ses lignes.
 */
@SpringBootTest
class VentesClientsSecurisationIT {

  private static final String DATABASE = "qerp_it_ventes_securisation";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000004b2";
  private static final String CLIENT_A = "c0000001-0000-0000-0000-000000000000";
  private static final String CLIENT_B = "c0000b42-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.applySyscohada(DATABASE, B);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO customers (id, tenant_id, name, status) VALUES ('" + CLIENT_B + "', '" + B
        + "', 'Client Beta V42', 'active') ON CONFLICT (id) DO NOTHING;"
        + "UPDATE customers SET payment_terms = 45 WHERE id = '" + CLIENT_A + "'");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  /** Facture émise de 100 000 HT, par le propriétaire (fixture). */
  private static String factureEmise(String tenant, String client) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO ar_invoices (id, tenant_id, invoice_number, customer_id, invoice_date, due_date, subtotal,"
        + " tax_amount, status, created_by) VALUES ('" + id + "', '" + tenant + "', 'F-" + id.substring(0, 8) + "', '"
        + client + "', CURRENT_DATE, CURRENT_DATE + 30, 100000, 0, 'draft', '" + COMPTABLE + "');"
        + "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "'");
    return id;
  }

  private static String encaisser(String user, String facture, int montant) throws SQLException {
    return asUser(user, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date,"
        + " payment_method, reference, created_by) VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '"
        + facture + "', " + montant + ", CURRENT_DATE, 'bank_transfer', 'VIR-V42', auth.uid()) RETURNING id::text");
  }

  @Test
  @DisplayName("règlement : jamais sur la facture d'une autre société, ni modifié, ni supprimé, ni par un lecteur")
  void reglementsProteges() throws SQLException {
    String factureB = factureEmise(B, CLIENT_B);
    assertThatThrownBy(() -> encaisser(COMPTABLE, factureB, 1000))
        .as("facture d'une autre société")
        .hasMessageContaining("Facture introuvable dans la société du règlement");
    assertThat(texte("SELECT amount_paid::text FROM ar_invoices WHERE id = '" + factureB + "'")).isEqualTo("0.00");

    String facture = factureEmise(A, CLIENT_A);
    assertThatThrownBy(() -> encaisser(LECTEUR, facture, 1000)).hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> encaisser(COMPTABLE, facture, 100001)).hasMessageContaining("supérieur au reste dû");

    String paiement = encaisser(COMPTABLE, facture, 40000);
    assertThat(texte("SELECT (journal_entry_id IS NOT NULL)::text FROM payments WHERE id = '" + paiement + "'"))
        .as("le règlement garde le lien vers son écriture")
        .isEqualTo("true");
    for (String user : new String[] {LECTEUR, COMPTABLE}) {
      assertThatThrownBy(() -> asUser(user, "UPDATE payments SET amount = 1 WHERE id = '" + paiement + "' RETURNING id::text"))
          .hasMessageContaining("ne se modifie pas et ne se supprime pas");
      assertThatThrownBy(() -> asUser(user, "DELETE FROM payments WHERE id = '" + paiement + "' RETURNING id::text"))
          .hasMessageContaining("ne se modifie pas et ne se supprime pas");
    }
  }

  @Test
  @DisplayName("annulation d'un encaissement : motif, droit, contre-passation, facture de nouveau due, une seule fois")
  void annulationParContrePassation() throws SQLException {
    String facture = factureEmise(A, CLIENT_A);
    String paiement = encaisser(COMPTABLE, facture, 100000);
    assertThat(texte("SELECT status FROM ar_invoices WHERE id = '" + facture + "'")).isEqualTo("paid");

    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT reverse_settlement('" + paiement + "', 'Erreur', CURRENT_DATE)::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT reverse_settlement('" + paiement + "', '  ', CURRENT_DATE)::text"))
        .hasMessageContaining("Motif");

    String annulation = asUser(COMPTABLE, "SELECT reverse_settlement('" + paiement + "', 'Chèque impayé', CURRENT_DATE)::text");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ar_invoices WHERE id = '" + facture + "'"))
        .isEqualTo("sent 0.00");
    assertThat(texte("SELECT amount::text || ' ' || reversal_reason FROM payments WHERE id = '" + annulation + "'"))
        .isEqualTo("-100000.00 Chèque impayé");
    assertThat(texte("SELECT je.status FROM payments p JOIN journal_entries je ON je.id = p.journal_entry_id"
            + " WHERE p.id = '" + paiement + "'"))
        .as("écriture d'origine contre-passée")
        .isEqualTo("reversed");
    assertThat(texte("SELECT (SUM(l.debit) = SUM(l.credit))::text || ' ' || je.source FROM payments p"
            + " JOIN journal_entries je ON je.id = p.journal_entry_id JOIN journal_lines l ON l.entry_id = je.id"
            + " WHERE p.id = '" + annulation + "' GROUP BY je.source"))
        .isEqualTo("true reversal");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT reverse_settlement('" + paiement + "', 'Encore', CURRENT_DATE)::text"))
        .hasMessageContaining("déjà annulé");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount,"
            + " payment_date, payment_method, created_by, reversal_of) VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '"
            + facture + "', -1, CURRENT_DATE, 'cash', auth.uid(), '" + paiement + "') RETURNING id::text"))
        .as("une annulation ne se saisit pas à la main")
        .hasMessageContaining("fonction d'annulation");

    // De nouveau due : un nouvel encaissement est accepté.
    encaisser(COMPTABLE, facture, 100000);
    assertThat(texte("SELECT status FROM ar_invoices WHERE id = '" + facture + "'")).isEqualTo("paid");
  }

  @Test
  @DisplayName("facture client : brouillon modifiable par le comptable, émise figée (en-tête, lignes, suppression) ; lecteur refusé")
  void factureClientFigeeUneFoisEmise() throws SQLException {
    String id = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal,"
        + " tax_amount, status, created_by) VALUES (get_user_tenant_id(auth.uid()), 'BROUILLON-V42', '" + CLIENT_A
        + "', CURRENT_DATE + 30, 0, 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(COMPTABLE, "INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price)"
        + " VALUES (get_user_tenant_id(auth.uid()), '" + id + "', 1, 'Prestation', 2, 5000) RETURNING id::text");
    asUser(COMPTABLE, "UPDATE ar_invoices SET due_date = CURRENT_DATE + 60 WHERE id = '" + id + "' RETURNING id::text");
    assertThatThrownBy(() -> asUser(LECTEUR, "UPDATE ar_invoices SET due_date = CURRENT_DATE WHERE id = '" + id
            + "' RETURNING id::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'paid' WHERE id = '" + id + "' RETURNING id::text"))
        .hasMessageContaining("ne peut qu'être émise");

    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "' RETURNING id::text");
    assertThat(texte("SELECT (journal_entry_id IS NOT NULL)::text FROM ar_invoices WHERE id = '" + id + "'")).isEqualTo("true");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE ar_invoices SET due_date = CURRENT_DATE + 90 WHERE id = '" + id
            + "' RETURNING id::text"))
        .hasMessageContaining("est émise");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'cancelled' WHERE id = '" + id
            + "' RETURNING id::text"))
        .hasMessageContaining("est émise");
    assertThatThrownBy(() -> asUser(COMPTABLE, "DELETE FROM ar_invoices WHERE id = '" + id + "' RETURNING id::text"))
        .hasMessageContaining("est émise");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE ar_invoice_lines SET unit_price = 1 WHERE invoice_id = '" + id
            + "' RETURNING id::text"))
        .hasMessageContaining("figées");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description,"
            + " quantity, unit_price) VALUES (get_user_tenant_id(auth.uid()), '" + id + "', 2, 'Ajout', 1, 1) RETURNING id::text"))
        .hasMessageContaining("figées");
  }

  @Test
  @DisplayName("livraison : stock retiré une fois, au coût moyen ; facture préparée en brouillon avec les lignes livrées")
  void livraisonEtFactureBrouillon() throws SQLException {
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "admin", A);
    String article = UUID.randomUUID().toString();
    String commande = UUID.randomUUID().toString();
    String ligne = UUID.randomUUID().toString();
    owner("UPDATE sales_settings SET auto_invoice_on_delivery = true WHERE tenant_id = '" + A + "';"
        + "INSERT INTO items (id, tenant_id, code, name, quantity_on_hand, average_cost) VALUES ('" + article + "', '"
        + A + "', 'ART-" + article.substring(0, 6) + "', 'Article V42', 10, 5000);"
        + "INSERT INTO stock_valuation_layers (tenant_id, item_id, layer_date, qty_in, cost_in, qty_remaining) VALUES ('"
        + A + "', '" + article + "', CURRENT_DATE, 10, 5000, 10);"
        + "INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total, status, created_by) VALUES ('"
        + commande + "', '" + A + "', 'SO-" + commande.substring(0, 6) + "', '" + CLIENT_A + "', 0, 'confirmed', '"
        + COMPTABLE + "');"
        + "INSERT INTO so_lines (id, so_id, item_id, description, quantity, unit_price) VALUES ('" + ligne + "', '"
        + commande + "', '" + article + "', 'Article V42', 8, 12000)");

    asUser(COMPTABLE, "SELECT post_delivery('" + commande + "', jsonb_build_array(jsonb_build_object('so_line_id', '"
        + ligne + "', 'quantity', 6)))::text");

    assertThat(texte("SELECT quantity_on_hand::text FROM items WHERE id = '" + article + "'"))
        .as("10 − 6 : une seule sortie (avant V42 : 10 − 12, ou refus « stock insuffisant »)")
        .isEqualTo("4.00");
    assertThat(texte("SELECT quantity::text || ' ' || unit_cost::text FROM stock_movements WHERE item_id = '" + article
            + "' AND reference_type = 'delivery_note'"))
        .isEqualTo("-6.00 5000");
    assertThat(texte("SELECT i.status || ' ' || i.subtotal::text || ' ' || (i.due_date - i.invoice_date)::text"
            + " || ' ' || (SELECT count(*) FROM ar_invoice_lines l WHERE l.invoice_id = i.id)::text"
            + " FROM ar_invoices i WHERE i.so_id = '" + commande + "'"))
        .as("brouillon, 6 × 12 000, échéance selon les conditions du client (45 j), une ligne")
        .isEqualTo("draft 72000.00 45 1");
    assertThat(texte("SELECT (journal_entry_id IS NULL)::text FROM ar_invoices WHERE so_id = '" + commande + "'"))
        .as("aucune écriture avant l'émission par le comptable")
        .isEqualTo("true");
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
