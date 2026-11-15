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
 * V71 (lot T2) — relevés et rapprochement bancaire : relevé équilibré et continu, rapprochement
 * automatique sans ambiguïté, ligne inconnue de l'ERP comptabilisée, état de rapprochement avec les
 * mouvements en suspens, validation refusée tant qu'une ligne n'a pas de contrepartie.
 */
@SpringBootTest
class RapprochementBancaireIT {

  private static final String DATABASE = "qerp_it_rapprochement";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-7171-0000-0000-000000000071";
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

  private static String importer(String compte, String debut, String fin, String ouverture, String cloture, String lignes) throws SQLException {
    return asUser(ADMIN, "SELECT import_bank_statement('" + compte + "', 'releve.xlsx', '" + debut + "', '" + fin + "', " + ouverture + ", " + cloture + ", '" + lignes + "'::jsonb)::text");
  }

  @Test
  @DisplayName("relevé contrôlé, rapprochement automatique, frais comptabilisés, état de rapprochement validé, continuité")
  void rapprochement() throws SQLException {
    String banque = asUser(ADMIN, "INSERT INTO bank_accounts (tenant_id, name, bank_name, account_type, gl_account_id, opening_balance, opening_date) VALUES ('" + A
        + "', 'Banque V71', 'BOA', 'bank', '" + gl("5214", "Banque V71", "asset") + "', 0, '2037-01-01') RETURNING id::text");
    String frais = gl("6312", "Frais bancaires V71", "expense");

    String f = asUser(ADMIN, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'F71-" + UUID.randomUUID().toString().substring(0, 8) + "', '" + CLIENT + "', '2037-02-28', 500, 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(ADMIN, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + f + "' RETURNING id::text");
    asUser(ADMIN, "SELECT (record_settlement('ar', '" + CLIENT + "', '2037-01-10', 'bank_transfer', 'VIR-C1', '[{\"invoice_id\":\"" + f + "\",\"amount\":500}]'::jsonb, '" + banque + "'))[1]::text");
    String cheque = asUser(ADMIN, "SELECT record_treasury_movement('" + banque + "', '2037-01-20', -300, '" + gl("4011", "Fournisseur V71", "liability") + "', 'Chèque fournisseur', 'CHQ-1')::text");

    String janvier = "[{\"date\":\"2037-01-11\",\"label\":\"VIR RECU CLIENT VIR-C1\",\"amount\":500,\"reference\":\"VIR-C1\"},"
        + "{\"date\":\"2037-01-31\",\"label\":\"FRAIS TENUE DE COMPTE\",\"amount\":-25}]";
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT import_bank_statement('" + banque + "', 'x', '2037-01-01', '2037-01-31', 0, 475, '" + janvier + "'::jsonb)::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> importer(banque, "2037-01-01", "2037-01-31", "0", "480", janvier)).hasMessageContaining("déséquilibré");
    String r = importer(banque, "2037-01-01", "2037-01-31", "0", "475", janvier);
    assertThat(r).contains("\"lignes\": 2").contains("\"rapprochees\": 1");
    assertThatThrownBy(() -> importer(banque, "2037-01-15", "2037-01-31", "0", "-25", "[{\"date\":\"2037-01-31\",\"label\":\"FRAIS\",\"amount\":-25}]"))
        .as("période déjà couverte").hasMessageContaining("couvre déjà");

    String rec = asUser(ADMIN, "SELECT prepare_bank_reconciliation('" + banque + "', '2037-01-31')::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT validate_bank_reconciliation('" + rec + "')::text")).hasMessageContaining("sans contrepartie");
    String ligneFrais = texte("SELECT id::text FROM bank_statement_lines WHERE bank_account_id = '" + banque + "' AND amount = -25");
    asUser(ADMIN, "SELECT post_statement_line('" + ligneFrais + "', '" + frais + "', 'Frais de tenue de compte janvier')::text");
    asUser(ADMIN, "SELECT validate_bank_reconciliation('" + rec + "')::text");
    assertThat(texte("SELECT status || ' ' || bank_balance || ' ' || book_balance || ' ' || outstanding_payments FROM bank_reconciliations WHERE id = '" + rec + "'"))
        .as("relevé 475 − chèque en suspens 300 = solde comptable 175").isEqualTo("validated 475.00 175.00 300.00");
    assertThat(texte("SELECT last_reconciled_at::text FROM bank_accounts WHERE id = '" + banque + "'")).isEqualTo("2037-01-31");

    assertThatThrownBy(() -> importer(banque, "2037-02-01", "2037-02-28", "400", "100", "[{\"date\":\"2037-02-03\",\"label\":\"CHQ 1\",\"amount\":-300,\"reference\":\"CHQ-1\"}]"))
        .as("continuité avec le relevé précédent").hasMessageContaining("solde final du relevé précédent");
    assertThat(importer(banque, "2037-02-01", "2037-02-28", "475", "175", "[{\"date\":\"2037-02-03\",\"label\":\"CHQ 1\",\"amount\":-300,\"reference\":\"CHQ-1\"}]"))
        .as("hors fenêtre de dates : pas de rapprochement automatique").contains("\"rapprochees\": 0");
    String ligneCheque = texte("SELECT id::text FROM bank_statement_lines WHERE bank_account_id = '" + banque + "' AND amount = -300");
    assertThat(asUser(LECTEUR, "UPDATE bank_statement_lines SET matched_transaction_id = '" + cheque + "' WHERE id = '" + ligneCheque + "' RETURNING id::text"))
        .as("lecteur : aucune ligne modifiée (RLS)").isNull();
    asUser(ADMIN, "UPDATE bank_statement_lines SET matched_transaction_id = '" + cheque + "' WHERE id = '" + ligneCheque + "' RETURNING id::text");
    assertThat(texte("SELECT is_reconciled::text FROM bank_transactions WHERE id = '" + cheque + "'")).isEqualTo("true");
    String rec2 = asUser(ADMIN, "SELECT prepare_bank_reconciliation('" + banque + "', '2037-02-28')::text");
    asUser(ADMIN, "SELECT validate_bank_reconciliation('" + rec2 + "')::text");
    assertThat(texte("SELECT outstanding_payments || ' ' || book_balance FROM bank_reconciliations WHERE id = '" + rec2 + "'")).isEqualTo("0.00 175.00");
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
