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
 * V45 — avoir client : lié à une facture émise, motivé, numéroté, écriture miroir au journal des
 * ventes, imputé sur le reste dû ; jamais plus que le facturé non crédité ; réservé au droit
 * ar.credit_note ; jamais saisi ni imputé à la main.
 */
@SpringBootTest
class AvoirsClientsIT {

  private static final String DATABASE = "qerp_it_avoirs";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000004d5";
  private static final String CLIENT = "c0000003-0000-0000-0000-000000000000";
  private static final String TVA = "00000000-0000-0000-0000-0000000a4518";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO tax_codes (id, tenant_id, code, name, rate) VALUES ('" + TVA + "', '" + A
        + "', 'TVA18_V45', 'TVA 18 %', 18) ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  /** Facture émise : 2 × 50 000 avec TVA 18 % + 1 × 20 000 sans TVA = 138 000 TTC. */
  private static String facture(String numero) throws SQLException {
    String id = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal,"
        + " tax_amount, status, created_by) VALUES (get_user_tenant_id(auth.uid()), '" + numero + "', '" + CLIENT
        + "', CURRENT_DATE + 30, 0, 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(COMPTABLE, "INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price,"
        + " tax_code_id) VALUES (get_user_tenant_id(auth.uid()), '" + id + "', 1, 'Conseil', 2, 50000, '" + TVA + "'),"
        + " (get_user_tenant_id(auth.uid()), '" + id + "', 2, 'Frais', 1, 20000, NULL) RETURNING id::text");
    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "' RETURNING id::text");
    return id;
  }

  private static String ligne(String facture, int n) {
    return texte("SELECT id::text FROM ar_invoice_lines WHERE invoice_id = '" + facture + "' AND line_no = " + n);
  }

  @Test
  @DisplayName("avoir partiel : numéroté, écriture miroir VT (701 + 4431 au débit, 411 au crédit), imputé sur le reste dû")
  void avoirPartiel() throws SQLException {
    String f = facture("FAC-V45-1");
    assertThat(texte("SELECT total::text FROM ar_invoices WHERE id = '" + f + "'")).isEqualTo("138000.00");

    String av = asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Une journée non réalisée', CURRENT_DATE,"
        + " '[{\"invoice_line_id\":\"" + ligne(f, 1) + "\",\"quantity\":1}]'::jsonb)::text");
    assertThat(texte("SELECT (credit_note_number NOT LIKE 'AV-PROVISOIRE%')::text || ' ' || subtotal::text || ' '"
            + " || tax_amount::text || ' ' || total::text || ' ' || amount_allocated::text FROM ar_credit_notes WHERE id = '" + av + "'"))
        .isEqualTo("true 50000.00 9000.00 59000.00 59000.00");
    assertThat(texte("SELECT je.journal_code || ' ' || string_agg(g.code || ':' || l.debit::text || '/' || l.credit::text, ' '"
            + " ORDER BY g.code) FROM ar_credit_notes c JOIN journal_entries je ON je.id = c.journal_entry_id"
            + " JOIN journal_lines l ON l.entry_id = je.id JOIN gl_accounts g ON g.id = l.account_id"
            + " WHERE c.id = '" + av + "' GROUP BY je.journal_code"))
        .isEqualTo("VT 411:0.00/59000.00 4431:9000.00/0.00 701:50000.00/0.00");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ar_invoices WHERE id = '" + f + "'"))
        .as("reste dû 138 000 − 59 000")
        .isEqualTo("partially_paid 59000.00");

    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Trop', CURRENT_DATE,"
            + " '[{\"invoice_line_id\":\"" + ligne(f, 1) + "\",\"quantity\":2}]'::jsonb)::text"))
        .as("1 seule unité reste à créditer sur la ligne 1")
        .hasMessageContaining("non encore crédité");

    asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Annulation du solde', CURRENT_DATE, NULL)::text");
    assertThat(texte("SELECT SUM(total)::text FROM ar_credit_notes WHERE invoice_id = '" + f + "'")).isEqualTo("138000.00");
    assertThat(texte("SELECT status FROM ar_invoices WHERE id = '" + f + "'")).as("entièrement créditée").isEqualTo("paid");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Encore', CURRENT_DATE, NULL)::text"))
        .hasMessageContaining("Rien à créditer");
  }

  @Test
  @DisplayName("facture déjà réglée : l'avoir reste un crédit client non imputé")
  void factureDejaReglee() throws SQLException {
    String f = facture("FAC-V45-2");
    asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method,"
        + " created_by) VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '" + f + "', 138000, CURRENT_DATE,"
        + " 'bank_transfer', auth.uid()) RETURNING id::text");
    String av = asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Retour de marchandise', CURRENT_DATE,"
        + " '[{\"invoice_line_id\":\"" + ligne(f, 2) + "\",\"quantity\":1}]'::jsonb)::text");
    assertThat(texte("SELECT total::text || ' ' || amount_allocated::text FROM ar_credit_notes WHERE id = '" + av + "'"))
        .isEqualTo("20000.00 0.00");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ar_invoices WHERE id = '" + f + "'"))
        .isEqualTo("paid 138000.00");
  }

  @Test
  @DisplayName("contrôles : droit, motif, brouillon, saisie et imputation directes refusées")
  void controles() throws SQLException {
    String f = facture("FAC-V45-3");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT create_ar_credit_note('" + f + "', 'x', CURRENT_DATE, NULL)::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', ' ', CURRENT_DATE, NULL)::text"))
        .hasMessageContaining("Motif");
    String brouillon = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date,"
        + " subtotal, tax_amount, status, created_by) VALUES (get_user_tenant_id(auth.uid()), 'BROUILLON-V45', '" + CLIENT
        + "', CURRENT_DATE + 30, 1000, 0, 'draft', auth.uid()) RETURNING id::text");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT create_ar_credit_note('" + brouillon + "', 'x', CURRENT_DATE, NULL)::text"))
        .hasMessageContaining("Seule une facture émise");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO ar_credit_notes (tenant_id, credit_note_number, invoice_id,"
            + " customer_id, credit_date, reason, created_by) VALUES (get_user_tenant_id(auth.uid()), 'AV-X', '" + f + "', '"
            + CLIENT + "', CURRENT_DATE, 'x', auth.uid()) RETURNING id::text"))
        .as("aucune saisie directe (nuage : RLS sans politique d'écriture ; sur site : droit SELECT seul)")
        .hasMessageMatching("(?s).*(permission denied|row-level security).*");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount,"
            + " payment_date, payment_method, created_by) VALUES (get_user_tenant_id(auth.uid()), 'ar_credit', '" + f
            + "', 1, CURRENT_DATE, 'credit_note', auth.uid()) RETURNING id::text"))
        .hasMessageContaining("imputation d'un avoir");
    String av = asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f + "', 'Geste commercial', CURRENT_DATE, NULL)::text");
    String imputation = texte("SELECT p.id::text FROM payments p JOIN ar_credit_notes c ON c.credit_note_number = p.reference"
        + " WHERE c.id = '" + av + "' AND p.payment_type = 'ar_credit'");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT reverse_settlement('" + imputation + "', 'x', CURRENT_DATE)::text"))
        .hasMessageContaining("ne s'annule pas");
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
