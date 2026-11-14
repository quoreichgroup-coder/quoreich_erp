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
 * V49 — acomptes clients (4191), imputation sur facture, remboursement, surplus d'avoir imputé
 * sur une autre facture, lettrage automatique des factures soldées et délettrage.
 */
@SpringBootTest
class AcomptesEtLettrageIT {

  private static final String DATABASE = "qerp_it_acomptes";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000004e9";
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";
  private static final String AUTRE = "c0000002-0000-0000-0000-000000000000";

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
        + " ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A);
  }

  private static String facture(String client, int montant) throws SQLException {
    String id = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal,"
        + " tax_amount, status, created_by) VALUES (get_user_tenant_id(auth.uid()), 'F49-" + UUID.randomUUID().toString().substring(0, 8)
        + "', '" + client + "', CURRENT_DATE + 30, " + montant + ", 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "' RETURNING id::text");
    return id;
  }

  private static String acompte(int montant) throws SQLException {
    return asUser(COMPTABLE, "SELECT record_customer_advance('" + CLIENT + "', CURRENT_DATE, 'bank_transfer', 'VIR-ACP', "
        + montant + ", NULL)::text");
  }

  private static String ecriture(String sql) {
    return texte("SELECT je.journal_code || ' ' || string_agg(g.code || ':' || l.debit::text || '/' || l.credit::text, ' '"
        + " ORDER BY g.code) FROM journal_entries je JOIN journal_lines l ON l.entry_id = je.id JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE je.id = (" + sql + ") GROUP BY je.journal_code");
  }

  @Test
  @DisplayName("acompte au passif (521 / 4191), imputé sur facture (4191 / 411), solde encaissé : facture lettrée au grand livre")
  void acompteImputeEtLettrage() throws SQLException {
    String acp = acompte(60000);
    assertThat(texte("SELECT advance_number LIKE 'ACP-%' FROM ar_customer_advances WHERE id = '" + acp + "'")).isEqualTo("t");
    assertThat(ecriture("SELECT journal_entry_id FROM ar_customer_advances WHERE id = '" + acp + "'"))
        .isEqualTo("BQ 4191:0.00/60000.00 521:60000.00/0.00");

    String f = facture(CLIENT, 100000);
    String imputation = asUser(COMPTABLE, "SELECT apply_customer_credit('" + f + "', 'advance', '" + acp + "', 40000, CURRENT_DATE)::text");
    assertThat(ecriture("SELECT journal_entry_id FROM payments WHERE id = '" + imputation + "'"))
        .isEqualTo("OD 411:0.00/40000.00 4191:40000.00/0.00");
    assertThat(texte("SELECT status || ' ' || amount_paid::text FROM ar_invoices WHERE id = '" + f + "'")).isEqualTo("partially_paid 40000.00");

    asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '" + f + "', 60000, CURRENT_DATE, 'cash', auth.uid()) RETURNING id::text");
    String code = texte("SELECT code || ' ' || gl_lettered::text FROM ar_letterings WHERE invoice_id = '" + f + "'");
    assertThat(code).as("facture soldée lettrée, grand livre compris").endsWith(" true");
    String lettre = code.split(" ")[0];
    assertThat(texte("SELECT count(*)::text || ' ' || SUM(debit)::text || ' ' || SUM(credit)::text FROM journal_lines"
            + " WHERE lettering_code = '" + lettre + "'"))
        .as("facture (débit) = imputation + encaissement (crédits) sur le 411")
        .isEqualTo("3 100000.00 100000.00");

    // Annulation de l'encaissement : la facture redevient due et se délettre.
    String enc = texte("SELECT id::text FROM payments WHERE ar_invoice_id = '" + f + "' AND payment_type = 'ar_receipt'");
    asUser(COMPTABLE, "SELECT reverse_settlement('" + enc + "', 'Chèque impayé', CURRENT_DATE)::text");
    assertThat(texte("SELECT count(*)::text FROM ar_letterings WHERE invoice_id = '" + f + "'")).isEqualTo("0");
    assertThat(texte("SELECT count(*)::text FROM journal_lines WHERE lettering_code = '" + lettre + "'")).isEqualTo("0");

    // Imputation d'acompte : ni contre-passation, ni saisie directe.
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT reverse_settlement('" + imputation + "', 'x', CURRENT_DATE)::text"))
        .hasMessageContaining("ne s'annule pas");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date,"
            + " payment_method, created_by) VALUES (get_user_tenant_id(auth.uid()), 'ar_advance', '" + f + "', 1, CURRENT_DATE,"
            + " 'advance', auth.uid()) RETURNING id::text"))
        .hasMessageContaining("fonction d'imputation");
  }

  @Test
  @DisplayName("contrôles : autre client, dépassement du disponible ou du reste dû, droits du lecteur ; remboursement")
  void controlesEtRemboursement() throws SQLException {
    String acp = acompte(30000);
    String fAutre = facture(AUTRE, 50000);
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT apply_customer_credit('" + fAutre + "', 'advance', '" + acp + "', 1000, CURRENT_DATE)::text"))
        .hasMessageContaining("autre client");
    String f = facture(CLIENT, 20000);
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT apply_customer_credit('" + f + "', 'advance', '" + acp + "', 25000, CURRENT_DATE)::text"))
        .hasMessageContaining("reste dû");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT record_customer_advance('" + CLIENT + "', CURRENT_DATE, 'cash', NULL, 1000, NULL)::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT refund_customer_credit('advance', '" + acp + "', 1000, CURRENT_DATE, 'cash', NULL)::text"))
        .hasMessageContaining("Droit insuffisant");

    asUser(COMPTABLE, "SELECT refund_customer_credit('advance', '" + acp + "', 10000, CURRENT_DATE, 'cash', 'REMB-1')::text");
    assertThat(ecriture("SELECT journal_entry_id FROM ar_customer_refunds WHERE advance_id = '" + acp + "'"))
        .isEqualTo("BQ 4191:10000.00/0.00 521:0.00/10000.00");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT refund_customer_credit('advance', '" + acp + "', 20001, CURRENT_DATE, 'cash', NULL)::text"))
        .hasMessageContaining("disponible");
  }

  @Test
  @DisplayName("surplus d'un avoir (facture déjà réglée) imputé sur une autre facture du client, sans nouvelle écriture")
  void surplusDAvoirImpute() throws SQLException {
    String f1 = facture(CLIENT, 30000);
    asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '" + f1 + "', 30000, CURRENT_DATE, 'cash', auth.uid()) RETURNING id::text");
    String av = asUser(COMPTABLE, "SELECT create_ar_credit_note('" + f1 + "', 'Geste commercial', CURRENT_DATE, NULL)::text");
    assertThat(texte("SELECT amount_allocated::text FROM ar_credit_notes WHERE id = '" + av + "'")).isEqualTo("0.00");

    String f2 = facture(CLIENT, 30000);
    int ecrituresAvant = Integer.parseInt(texte("SELECT count(*) FROM journal_entries WHERE tenant_id = '" + A + "'"));
    asUser(COMPTABLE, "SELECT apply_customer_credit('" + f2 + "', 'credit_note', '" + av + "', 30000, CURRENT_DATE)::text");
    assertThat(texte("SELECT status FROM ar_invoices WHERE id = '" + f2 + "'")).isEqualTo("paid");
    assertThat(Integer.parseInt(texte("SELECT count(*) FROM journal_entries WHERE tenant_id = '" + A + "'"))).isEqualTo(ecrituresAvant);
    assertThat(texte("SELECT gl_lettered::text FROM ar_letterings WHERE invoice_id = '" + f2 + "'"))
        .as("facture 2 (débit) = avoir entièrement imputé (crédit)")
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
