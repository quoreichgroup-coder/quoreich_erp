package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Lignes de facture et codes TVA (V21) : montants calculés par la base, en-tête = somme des
 * lignes, comptabilisation regroupée par compte, gels, isolation. Joué sous la RLS réelle.
 */
@SpringBootTest
class LignesFactureIT {

  private static final String DATABASE = "qerp_it_lignes";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-000000000005";
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";
  private static final String TVA18 = "e0000000-0000-0000-0000-000000000018";
  private static final String EXO = "e0000000-0000-0000-0000-000000000000";
  private static final String TVA_PROPRE = "e0000000-0000-0000-0000-0000000000a1";
  private static final String TVA_BETA = "e0000000-0000-0000-0000-0000000000b1";
  private static final String DEPT = "d0000000-0000-0000-0000-0000000000f1";
  private static final String COM = "d0000000-0000-0000-0000-0000000000f2";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    PostgresFixture.applySyscohada(DATABASE, B);
    owner("INSERT INTO auth.users (id) VALUES ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + COMPTABLE + "', '" + A
        + "', 'Comptable Alpha') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO user_roles (user_id, role, tenant_id) SELECT '" + COMPTABLE + "', 'accountant', '" + A
        + "' WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = '" + COMPTABLE + "');"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('" + A
        + "', '4432', 'TVA facturée sur prestations', 'liability') ON CONFLICT (tenant_id, code) DO NOTHING;"
        + "INSERT INTO tax_codes (id, tenant_id, code, name, rate) VALUES"
        + " ('" + TVA18 + "', '" + A + "', 'TVA18', 'TVA 18 %', 18), ('" + EXO + "', '" + A + "', 'EXO', 'Exonéré', 0),"
        + " ('" + TVA_BETA + "', '" + B + "', 'TVA18', 'TVA 18 % Beta', 18) ON CONFLICT DO NOTHING;"
        + "INSERT INTO tax_codes (id, tenant_id, code, name, rate, gl_account_id) SELECT '" + TVA_PROPRE + "', '" + A
        + "', 'TVA18S', 'TVA 18 % prestations', 18, id FROM gl_accounts WHERE tenant_id = '" + A
        + "' AND code = '4432' ON CONFLICT DO NOTHING;"
        + "INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('" + DEPT + "', '" + A
        + "', 'DEPT', 'Département') ON CONFLICT DO NOTHING;"
        + "INSERT INTO analytic_values (id, tenant_id, axis_id, code, name) VALUES ('" + COM + "', '" + A + "', '"
        + DEPT + "', 'COM', 'Commercial') ON CONFLICT DO NOTHING");
  }

  private static String compte(String code) {
    return rows("SELECT id FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'").getFirst();
  }

  /** Facture brouillon avec ses lignes ; renvoie son identifiant. */
  private static String brouillon(String numero, String... lignes) throws SQLException {
    String id = UUID.randomUUID().toString();
    StringBuilder sql = new StringBuilder(
        "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount,"
            + " tenant_id, created_by, status) VALUES ('" + id + "', '" + numero + "', '" + CLIENT
            + "', '2030-07-01', '2030-08-01', 0, 0, get_user_tenant_id(auth.uid()), auth.uid(), 'draft');");
    int n = 1;
    for (String l : lignes) {
      sql.append("INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price,"
          + " discount_pct, tax_code_id, revenue_account_id) VALUES (get_user_tenant_id(auth.uid()), '")
          .append(id).append("', ").append(n++).append(", ").append(l).append(");");
    }
    asUser(COMPTABLE, sql.toString());
    return id;
  }

  private static void emettre(String id) throws SQLException {
    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "'");
  }

  @Test
  @DisplayName("montants calculés à la ligne (remise, TVA arrondie) ; en-tête = somme des lignes")
  void montantsCalcules() throws Exception {
    String f = brouillon("LIG-1",
        "'Licence', 2, 500, 10, '" + TVA18 + "', NULL",
        "'Forfait', 1, 333.33, 0, '" + TVA18 + "', NULL",
        "'Formation exonérée', 1, 100, 0, '" + EXO + "', NULL");
    assertThat(rows("SELECT line_no || ' ' || net_amount || ' ' || tax_amount FROM ar_invoice_lines WHERE invoice_id = '"
            + f + "' ORDER BY line_no"))
        .containsExactly("1 900.00 162.00", "2 333.33 60.00", "3 100.00 0.00");
    assertThat(rows("SELECT subtotal || ' ' || tax_amount || ' ' || total FROM ar_invoices WHERE id = '" + f + "'"))
        .containsExactly("1333.33 222.00 1555.33");

    asUser(COMPTABLE, "DELETE FROM ar_invoice_lines WHERE invoice_id = '" + f + "' AND line_no = 3");
    assertThat(rows("SELECT subtotal || ' ' || tax_amount FROM ar_invoices WHERE id = '" + f + "'"))
        .containsExactly("1233.33 222.00");
  }

  @Test
  @DisplayName("comptabilisation : un compte de vente et un compte de TVA par regroupement, analytique sur chaque produit")
  void comptabilisationLigneALigne() throws Exception {
    String f = brouillon("LIG-2",
        "'Marchandise', 1, 1000, 0, '" + TVA18 + "', NULL",
        "'Prestation', 1, 500, 0, '" + TVA_PROPRE + "', '" + compte("706") + "'",
        "'Marchandise exonérée', 1, 200, 0, '" + EXO + "', NULL");
    asUser(COMPTABLE, "INSERT INTO ar_invoice_analytics (tenant_id, invoice_id, axis_id, value_id) VALUES"
        + " (get_user_tenant_id(auth.uid()), '" + f + "', '" + DEPT + "', '" + COM + "')");
    emettre(f);
    assertThat(rows("SELECT g.code || ' D' || l.debit || ' C' || l.credit || ' ' || coalesce(v.code, '-')"
            + " FROM ar_invoices i JOIN journal_lines l ON l.entry_id = i.journal_entry_id"
            + " JOIN gl_accounts g ON g.id = l.account_id LEFT JOIN journal_line_analytics la ON la.line_id = l.id"
            + " LEFT JOIN analytic_values v ON v.id = la.value_id WHERE i.id = '" + f + "' ORDER BY g.code"))
        .containsExactly(
            "411 D1970.00 C0.00 -",
            "4431 D0.00 C180.00 -",
            "4432 D0.00 C90.00 -",
            "701 D0.00 C1200.00 COM",
            "706 D0.00 C500.00 COM");
  }

  @Test
  @DisplayName("après émission, les lignes sont figées")
  void lignesFigees() throws Exception {
    String f = brouillon("LIG-3", "'Article', 1, 100, 0, '" + TVA18 + "', NULL");
    emettre(f);
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE ar_invoice_lines SET quantity = 2 WHERE invoice_id = '" + f + "'"))
        .hasMessageContaining("Les lignes d'une facture émise sont figées");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description,"
            + " quantity, unit_price) VALUES (get_user_tenant_id(auth.uid()), '" + f + "', 9, 'Ajout', 1, 1)"))
        .hasMessageContaining("figées");
  }

  @Test
  @DisplayName("code TVA : taux figé, code inactif refusé sur une nouvelle ligne, réservé à l'administrateur")
  void codesTva() throws Exception {
    assertThatThrownBy(() -> owner("UPDATE tax_codes SET rate = 20 WHERE id = '" + TVA18 + "'"))
        .hasMessageContaining("figés");
    String inactif = UUID.randomUUID().toString();
    owner("INSERT INTO tax_codes (id, tenant_id, code, name, rate, is_active) VALUES ('" + inactif + "', '" + A
        + "', 'OLD" + inactif.substring(0, 4).toUpperCase().replaceAll("[^A-Z0-9]", "X") + "', 'Ancien taux', 15, false)");
    assertThatThrownBy(() -> brouillon("LIG-4", "'Article', 1, 100, 0, '" + inactif + "', NULL"))
        .hasMessageContaining("Code TVA inactif");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO tax_codes (tenant_id, code, name, rate) VALUES"
            + " (get_user_tenant_id(auth.uid()), 'TVA10', 'TVA 10 %', 10)"))
        .hasMessageContaining("row-level security");
  }

  @Test
  @DisplayName("isolation : ni code TVA ni compte de vente d'une autre société ; brouillon supprimable avec ses lignes")
  void isolationEtSuppression() throws Exception {
    assertThatThrownBy(() -> brouillon("LIG-5", "'Article', 1, 100, 0, '" + TVA_BETA + "', NULL"))
        .hasMessageContaining("ar_invoice_lines_tax_code_id_tenant_id_fkey");
    String compteBeta = rows("SELECT id FROM gl_accounts WHERE tenant_id = '" + B + "' AND code = '701'").getFirst();
    assertThatThrownBy(() -> brouillon("LIG-6", "'Article', 1, 100, 0, NULL, '" + compteBeta + "'"))
        .hasMessageContaining("ar_invoice_lines_revenue_account_id_tenant_id_fkey");

    String f = brouillon("LIG-7", "'Article', 1, 100, 0, '" + TVA18 + "', NULL");
    owner("DELETE FROM ar_invoices WHERE id = '" + f + "'");
    assertThat(rows("SELECT count(*) FROM ar_invoice_lines WHERE invoice_id = '" + f + "'")).containsExactly("0");
  }

  // ─── Outils ───

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

  private static List<String> rows(String sql) {
    List<String> out = new ArrayList<>();
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement st = c.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      while (rs.next()) out.add(rs.getString(1));
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }
}
