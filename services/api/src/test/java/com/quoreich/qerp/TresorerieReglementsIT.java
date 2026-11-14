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
 * V70 (lot T1, G-16 / G-38) — trésorerie reliée aux règlements : comptes de trésorerie typés reliés à
 * leur compte général, solde calculé, règlement passé sur le compte choisi (ou par défaut) avec son
 * mouvement, annulation, compte obligatoire paramétrable, mouvement manuel et virement interne en
 * écriture BQ, tables de banque fermées aux écritures directes.
 */
@SpringBootTest
class TresorerieReglementsIT {

  private static final String DATABASE = "qerp_it_tresorerie_reglements";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-7070-0000-0000-000000000070";
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, LECTEUR, "viewer", A);
  }

  private static String gl(String code, String nom, String type) {
    owner("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + A + "', '" + code + "', '" + nom + "', '" + type + "') ON CONFLICT (tenant_id, code) DO NOTHING");
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String tresorerie(String type, String nom, String glCode, int ouverture) throws SQLException {
    String id = asUser(ADMIN, "INSERT INTO bank_accounts (tenant_id, name, bank_name, account_type, currency, gl_account_id, opening_balance, opening_date)"
        + " VALUES ('" + A + "', '" + nom + "', 'BOA', '" + type + "', 'XOF', '" + gl(glCode, nom, "asset") + "', " + ouverture + ", '2036-01-01') RETURNING id::text");
    asUser(ADMIN, "SELECT set_default_treasury_account('" + id + "')::text");
    return id;
  }

  private static String solde(String compte) {
    return texte("SELECT balance::numeric(18,2)::text FROM bank_accounts WHERE id = '" + compte + "'");
  }

  private static String facture(int montant) throws SQLException {
    String id = asUser(ADMIN, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'F70-" + UUID.randomUUID().toString().substring(0, 8) + "', '" + CLIENT + "', '2036-03-30', " + montant
        + ", 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(ADMIN, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "' RETURNING id::text");
    return id;
  }

  private static String regler(String facture, int montant, String mode, String compte) throws SQLException {
    return asUser(ADMIN, "SELECT (record_settlement('ar', '" + CLIENT + "', '2036-03-02', '" + mode + "', 'R70', '[{\"invoice_id\":\"" + facture + "\",\"amount\":" + montant
        + "}]'::jsonb" + (compte == null ? "" : ", '" + compte + "'") + "))[1]::text");
  }

  private static String ecriture(String paiement) {
    return texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE l.entry_id = (SELECT journal_entry_id FROM payments WHERE id = '" + paiement + "')");
  }

  @Test
  @DisplayName("comptes de trésorerie : droit requis, compte général de la bonne classe, défaut automatique, solde calculé")
  void comptes() throws SQLException {
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO bank_accounts (tenant_id, name, bank_name, gl_account_id) VALUES ('" + A + "', 'x', 'x', '" + gl("5219", "x", "asset") + "') RETURNING id::text"))
        .hasMessageContaining("row-level security");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO bank_accounts (tenant_id, name, bank_name) VALUES ('" + A + "', 'Sans compte', 'BOA') RETURNING id::text"))
        .hasMessageContaining("Compte comptable obligatoire");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO bank_accounts (tenant_id, name, bank_name, gl_account_id) VALUES ('" + A + "', 'Mauvaise classe', 'BOA', '"
        + gl("6019", "Achats V70", "expense") + "') RETURNING id::text")).hasMessageContaining("attend un compte 52");
    String boa = asUser(ADMIN, "INSERT INTO bank_accounts (tenant_id, name, bank_name, account_type, gl_account_id, opening_balance) VALUES ('" + A
        + "', 'BOA principal', 'BOA', 'bank', '" + gl("5218", "BOA principal", "asset") + "', 100000) RETURNING balance::numeric(18,2)::text");
    assertThat(boa).isEqualTo("100000.00");
    assertThat(texte("SELECT count(*)::text FROM bank_accounts WHERE tenant_id = '" + A + "' AND account_type = 'bank' AND is_default AND is_active"))
        .as("un compte par défaut par type, désigné d'office au premier compte").isEqualTo("1");
    asUser(ADMIN, "UPDATE bank_accounts SET balance = 5 WHERE name = 'BOA principal' RETURNING id::text");
    assertThat(texte("SELECT balance::numeric(18,2)::text FROM bank_accounts WHERE name = 'BOA principal'")).as("solde jamais saisi").isEqualTo("100000.00");
    assertThatThrownBy(() -> asUser(ADMIN, "INSERT INTO bank_transactions (tenant_id, bank_account_id, amount, transaction_type) SELECT '" + A
        + "', id, 10, 'credit' FROM bank_accounts WHERE name = 'BOA principal' RETURNING id::text")).hasMessageContaining("permission denied");
  }

  @Test
  @DisplayName("règlements : compte choisi ou par défaut du mode, mouvement et solde, annulation, compte obligatoire, repli sur le rôle")
  void reglements() throws SQLException {
    String banque = tresorerie("bank", "Banque V70", "5212", 0);
    String caisse = tresorerie("cash", "Caisse V70", "5711", 0);
    String f = facture(1000);

    String especes = regler(f, 400, "cash", null);
    assertThat(ecriture(especes)).as("espèces : compte de caisse par défaut").isEqualTo("411:0.00/400.00 5711:400.00/0.00");
    String virement = regler(f, 500, "bank_transfer", banque);
    assertThat(ecriture(virement)).isEqualTo("411:0.00/500.00 5212:500.00/0.00");
    assertThat(solde(caisse) + " " + solde(banque)).isEqualTo("400.00 500.00");
    assertThat(texte("SELECT string_agg(source || ':' || amount::numeric(18,2), ' ') FROM bank_transactions WHERE payment_id = '" + especes + "'")).isEqualTo("payment:400.00");

    asUser(ADMIN, "SELECT reverse_settlement('" + especes + "', 'Erreur de caisse', '2036-03-03')::text");
    assertThat(solde(caisse)).as("annulation : mouvement inverse sur le même compte").isEqualTo("0.00");

    owner("INSERT INTO treasury_settings (tenant_id, require_treasury_account) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET require_treasury_account = true");
    assertThatThrownBy(() -> regler(f, 100, "mobile_money", null)).hasMessageContaining("Compte de trésorerie obligatoire");
    owner("UPDATE treasury_settings SET require_treasury_account = false WHERE tenant_id = '" + A + "'");
    String mobile = regler(f, 100, "mobile_money", null);
    assertThat(ecriture(mobile)).as("sans compte : rôle Monnaie électronique (552)").isEqualTo("411:0.00/100.00 552:100.00/0.00");
    assertThat(texte("SELECT count(*)::text FROM bank_transactions WHERE payment_id = '" + mobile + "'")).isEqualTo("0");
  }

  @Test
  @DisplayName("mouvement manuel et virement interne : écriture BQ, soldes ; rapprochement validé figé ; lecteur refusé")
  void mouvements() throws SQLException {
    String banque = tresorerie("bank", "Banque V70-3", "5213", 10000);
    String caisse = tresorerie("cash", "Caisse V70-3", "5712", 0);
    String frais = gl("6311", "Frais bancaires V70", "expense");

    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT record_treasury_movement('" + banque + "', '2036-04-01', -2500, '" + frais + "', 'Frais')::text"))
        .hasMessageContaining("Droit insuffisant");
    String t = asUser(ADMIN, "SELECT record_treasury_movement('" + banque + "', '2036-04-01', -2500, '" + frais + "', 'Frais de tenue de compte', 'AGIOS-04')::text");
    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit || '/' || l.credit, ' ' ORDER BY g.code) || ' ' || e.journal_code FROM bank_transactions t"
        + " JOIN journal_entries e ON e.id = t.journal_entry_id JOIN journal_lines l ON l.entry_id = e.id JOIN gl_accounts g ON g.id = l.account_id WHERE t.id = '" + t + "' GROUP BY e.journal_code"))
        .isEqualTo("5213:0.00/2500.00 6311:2500.00/0.00 BQ");

    asUser(ADMIN, "SELECT transfer_between_treasury_accounts('" + banque + "', '" + caisse + "', '2036-04-02', 1000, 'Alimentation de la caisse')::text");
    assertThat(solde(banque) + " " + solde(caisse)).isEqualTo("6500.00 1000.00");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT transfer_between_treasury_accounts('" + banque + "', '" + banque + "', '2036-04-02', 10)::text"))
        .hasMessageContaining("deux comptes différents");

    String r = asUser(ADMIN, "INSERT INTO bank_reconciliations (tenant_id, bank_account_id, period_start, period_end, book_balance, bank_balance, status)"
        + " VALUES ('" + A + "', '" + banque + "', '2036-04-01', '2036-04-30', 6500, 6500, 'validated') RETURNING id::text");
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE bank_reconciliations SET notes = 'x' WHERE id = '" + r + "' RETURNING id::text")).hasMessageContaining("figé");
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
