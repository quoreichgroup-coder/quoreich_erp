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
 * V105 — jeux de comptes par client, fournisseur et article : le compte vient du jeu de la fiche, sinon du
 * compte par défaut de la société ; écritures, encaissements et lettrage restent sur le même compte ;
 * comptes de bilan verrouillés tant que des postes ouverts les utilisent (paramètre désactivable).
 */
@SpringBootTest
class JeuxDeComptesIT {

  private static final String DATABASE = "qerp_it_jeux_de_comptes";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000105e9";
  private static final String ADMIN = "aaaaaaaa-0000-0000-0000-0000000105ad";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "'), ('" + ADMIN + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur'), ('" + ADMIN + "', '" + A + "', 'Admin')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES"
        + " ('" + A + "', '4111', 'Clients groupe', 'asset'), ('" + A + "', '4012', 'Fournisseurs étrangers', 'liability'),"
        + " ('" + A + "', '604', 'Achats stockés de matières', 'expense'), ('" + A + "', '321', 'Matières premières', 'asset'),"
        + " ('" + B + "', '4111', 'Clients groupe B', 'asset') ON CONFLICT DO NOTHING;"
        + "INSERT INTO inventory_settings (tenant_id, auto_je_on_movement) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = true");
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, LECTEUR, "viewer", A, ADMIN, "admin", A);
  }

  // ─── Données ───

  private static String compte(String tenant, String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + tenant + "' AND code = '" + code + "'");
  }

  private static String jeu(String kind, String code, String... lignes) throws SQLException {
    String id = asUser(COMPTABLE, "INSERT INTO posting_account_sets (tenant_id, kind, code, name) VALUES (get_user_tenant_id(auth.uid()), '"
        + kind + "', '" + code + "', 'Jeu " + code + "') RETURNING id::text");
    for (int i = 0; i < lignes.length; i += 2) {
      asUser(COMPTABLE, "INSERT INTO posting_account_set_lines (set_id, tenant_id, kind, role_code, gl_account_id) VALUES ('" + id
          + "', get_user_tenant_id(auth.uid()), '" + kind + "', '" + lignes[i] + "', '" + compte(A, lignes[i + 1]) + "') RETURNING role_code");
    }
    return id;
  }

  private static String client(String jeu) {
    String id = UUID.randomUUID().toString();
    owner("INSERT INTO customers (id, tenant_id, name, account_set_id) VALUES ('" + id + "', '" + A + "', 'Client " + id.substring(0, 6)
        + "', " + (jeu == null ? "NULL" : "'" + jeu + "'") + ")");
    return id;
  }

  private static String facture(String client, int montant) throws SQLException {
    String id = asUser(COMPTABLE, "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, due_date, subtotal, tax_amount, status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'F105-" + UUID.randomUUID().toString().substring(0, 8) + "', '" + client
        + "', CURRENT_DATE + 30, " + montant + ", 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(COMPTABLE, "UPDATE ar_invoices SET status = 'sent' WHERE id = '" + id + "' RETURNING id::text");
    return id;
  }

  private static String encaisser(String facture, int montant) throws SQLException {
    return asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date, payment_method, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), 'ar_receipt', '" + facture + "', " + montant + ", CURRENT_DATE, 'cash', auth.uid()) RETURNING id::text");
  }

  /** « code:débit/crédit » des lignes de l'écriture, triées par compte. */
  private static String ecriture(String entrySql) {
    return texte("SELECT string_agg(g.code || ':' || l.debit::numeric(18,0) || '/' || l.credit::numeric(18,0), ' ' ORDER BY g.code)"
        + " FROM journal_lines l JOIN gl_accounts g ON g.id = l.account_id WHERE l.entry_id = (" + entrySql + ")");
  }

  // ─── Tests ───

  @Test
  @DisplayName("client du jeu « GROUPE » : facture, encaissement et lettrage sur 4111 ; client sans jeu : 411 par défaut")
  void jeuClient() throws SQLException {
    String groupe = jeu("customer", "GROUPE", "AR_RECEIVABLE", "4111");
    String cg = client(groupe);
    String f = facture(cg, 50000);
    assertThat(ecriture("SELECT journal_entry_id FROM ar_invoices WHERE id = '" + f + "'")).isEqualTo("4111:50000/0 701:0/50000");
    String p = encaisser(f, 50000);
    assertThat(ecriture("SELECT journal_entry_id FROM payments WHERE id = '" + p + "'")).isEqualTo("4111:0/50000 571:50000/0");
    assertThat(texte("SELECT gl_lettered::text FROM ar_letterings WHERE invoice_id = '" + f + "'"))
        .as("lettrage sur le compte du jeu").isEqualTo("true");

    String local = client(null);
    String f2 = facture(local, 10000);
    assertThat(ecriture("SELECT journal_entry_id FROM ar_invoices WHERE id = '" + f2 + "'")).isEqualTo("411:10000/0 701:0/10000");
  }

  @Test
  @DisplayName("fournisseur étranger (4012) et article de matières (321) : écritures par le jeu de la fiche")
  void jeuxFournisseurEtArticle() throws SQLException {
    String etranger = jeu("supplier", "ETRANGER", "AP_PAYABLE", "4012", "PURCHASES", "604");
    String fournisseur = UUID.randomUUID().toString();
    owner("INSERT INTO suppliers (id, tenant_id, name, account_set_id) VALUES ('" + fournisseur + "', '" + A + "', 'Fournisseur import', '" + etranger + "');"
        + "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + A + "', 'FF-105', '" + fournisseur + "', CURRENT_DATE, CURRENT_DATE + 30, 80000, 0, 'draft', 'pending', '" + COMPTABLE + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = 'FF-105' AND tenant_id = '" + A + "'");
    assertThat(ecriture("SELECT journal_entry_id FROM ap_invoices WHERE invoice_number = 'FF-105' AND tenant_id = '" + A + "'"))
        .isEqualTo("4012:0/80000 604:80000/0");
    String paiement = asUser(COMPTABLE, "INSERT INTO payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method, created_by)"
        + " SELECT tenant_id, 'ap_payment', id, 80000, CURRENT_DATE, 'cash', auth.uid() FROM ap_invoices WHERE invoice_number = 'FF-105'"
        + " AND tenant_id = get_user_tenant_id(auth.uid()) RETURNING id::text");
    assertThat(ecriture("SELECT journal_entry_id FROM payments WHERE id = '" + paiement + "'")).isEqualTo("4012:80000/0 571:0/80000");

    String matieres = jeu("item", "MATIERES", "INVENTORY", "321");
    String article = UUID.randomUUID().toString();
    owner("INSERT INTO items (id, tenant_id, code, name, account_set_id) VALUES ('" + article + "', '" + A + "', 'MAT-105', 'Matière', '" + matieres + "');"
        + "INSERT INTO stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, created_by, reason) VALUES ('" + A + "', '"
        + article + "', 'receipt', 5, 2000, '" + COMPTABLE + "', 'Entrée')");
    assertThat(ecriture("SELECT journal_entry_id FROM stock_movements WHERE item_id = '" + article + "'"))
        .as("stock au compte du jeu, variation au compte par défaut").isEqualTo("321:10000/0 6031:0/10000");
  }

  @Test
  @DisplayName("verrou : jeu d'un client à postes ouverts, compte de bilan d'un jeu ou par défaut ; levé par le paramètre")
  void verrouDesComptesDeBilan() throws SQLException {
    String groupe = jeu("customer", "VERROU", "AR_RECEIVABLE", "4111");
    String c1 = client(groupe);
    String f = facture(c1, 20000);
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE customers SET account_set_id = NULL WHERE id = '" + c1 + "' RETURNING id::text"))
        .hasMessageContaining("postes ouverts");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE posting_account_set_lines SET gl_account_id = '" + compte(A, "411") + "' WHERE set_id = '"
            + groupe + "' RETURNING role_code")).hasMessageContaining("postes ouverts");
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE posting_account_sets SET is_active = false WHERE id = '" + groupe + "' RETURNING id::text"))
        .hasMessageContaining("postes ouverts");

    String c2 = client(null);
    facture(c2, 5000);
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE tenant_posting_accounts SET gl_account_id = '" + compte(A, "4111")
            + "' WHERE tenant_id = get_user_tenant_id(auth.uid()) AND role_code = 'AR_RECEIVABLE' RETURNING role_code"))
        .as("le compte par défaut est protégé aussi").hasMessageContaining("postes ouverts");
    // Un rôle de résultat reste libre.
    asUser(COMPTABLE, "INSERT INTO posting_account_set_lines (set_id, tenant_id, kind, role_code, gl_account_id) VALUES ('" + groupe
        + "', get_user_tenant_id(auth.uid()), 'customer', 'SALES_REVENUE', '" + compte(A, "701") + "') RETURNING role_code");

    // Paramètre désactivé : le changement passe ; réactivé ensuite.
    asUser(COMPTABLE, "INSERT INTO posting_settings (tenant_id, lock_control_accounts) VALUES (get_user_tenant_id(auth.uid()), false)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET lock_control_accounts = false RETURNING tenant_id::text");
    asUser(COMPTABLE, "UPDATE customers SET account_set_id = NULL WHERE id = '" + c1 + "' RETURNING id::text");
    asUser(COMPTABLE, "UPDATE posting_settings SET lock_control_accounts = true WHERE tenant_id = get_user_tenant_id(auth.uid()) RETURNING tenant_id::text");
    assertThat(texte("SELECT status FROM ar_invoices WHERE id = '" + f + "'")).isEqualTo("sent");
  }

  @Test
  @DisplayName("contrôles : type du jeu, compte inactif = paramétrage manquant, droit du catalogue, compte d'une autre société")
  void controles() throws SQLException {
    String fournisseurs = jeu("supplier", "LOCAL", "AP_PAYABLE", "401");
    String c = client(null);
    assertThatThrownBy(() -> asUser(COMPTABLE, "UPDATE customers SET account_set_id = '" + fournisseurs + "' WHERE id = '" + c + "' RETURNING id::text"))
        .hasMessageContaining("jeu « client »");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO posting_account_set_lines (set_id, tenant_id, kind, role_code, gl_account_id) VALUES ('"
            + fournisseurs + "', get_user_tenant_id(auth.uid()), 'supplier', 'AR_RECEIVABLE', '" + compte(A, "411") + "') RETURNING role_code"))
        .as("rôle non admis pour un jeu fournisseur").hasMessageContaining("foreign key");
    assertThatThrownBy(() -> asUser(COMPTABLE, "INSERT INTO posting_account_set_lines (set_id, tenant_id, kind, role_code, gl_account_id) VALUES ('"
            + fournisseurs + "', get_user_tenant_id(auth.uid()), 'supplier', 'GRNI', '" + compte(B, "4111") + "') RETURNING role_code"))
        .as("compte d'une autre société").isInstanceOf(SQLException.class);
    assertThatThrownBy(() -> asUser(LECTEUR, "INSERT INTO posting_account_sets (tenant_id, kind, code, name) VALUES (get_user_tenant_id(auth.uid()),"
            + " 'customer', 'X', 'X') RETURNING id::text")).hasMessageContaining("row-level security");

    String inactif = jeu("customer", "INACTIF", "AR_RECEIVABLE", "4111");
    String ci = client(inactif);
    owner("UPDATE gl_accounts SET is_active = false WHERE tenant_id = '" + A + "' AND code = '4111'");
    try {
      assertThatThrownBy(() -> facture(ci, 1000)).as("aucun repli silencieux sur le compte par défaut").hasMessageContaining("Paramétrage comptable incomplet");
    } finally {
      owner("UPDATE gl_accounts SET is_active = true WHERE tenant_id = '" + A + "' AND code = '4111'");
    }
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
