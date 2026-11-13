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
 * V36 — record_settlement : un règlement se saisit pour UN tiers et ne s'impute que sur SES
 * factures ouvertes, en une transaction (tout ou rien).
 */
@SpringBootTest
class ReglementsParTiersIT {

  private static final String DATABASE = "qerp_it_reglements";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String CLIENT_1 = "c0000001-0000-0000-0000-000000000000";
  private static final String CLIENT_2 = "00000000-0000-0000-0000-0000000c0362";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0361";
  private static final String F1 = "00000000-0000-0000-0000-0000000a3601";
  private static final String F2 = "00000000-0000-0000-0000-0000000a3602";
  private static final String F_AUTRE = "00000000-0000-0000-0000-0000000a3603";
  private static final String FF_NON_APPROUVEE = "00000000-0000-0000-0000-0000000b3601";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO customers (id, tenant_id, name) VALUES ('" + CLIENT_2 + "', '" + A + "', 'Client deux')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V36')"
        + " ON CONFLICT (id) DO NOTHING;"
        + facture(F1, "REG-1", CLIENT_1, 1000, "CURRENT_DATE - 20")
        + facture(F2, "REG-2", CLIENT_1, 500, "CURRENT_DATE - 10")
        + facture(F_AUTRE, "REG-AUTRE", CLIENT_2, 700, "CURRENT_DATE - 15")
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, status,"
        + " approval_status, created_by) VALUES ('" + FF_NON_APPROUVEE + "', '" + A + "', 'FF-V36', '" + FOURNISSEUR + "',"
        + " CURRENT_DATE, CURRENT_DATE + 30, 300, 'open', 'pending', '" + ADMIN + "') ON CONFLICT (id) DO NOTHING;");
  }

  private static String facture(String id, String numero, String client, int total, String date) {
    return "INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, total,"
        + " tenant_id, created_by, status, amount_paid) VALUES ('" + id + "', '" + numero + "', '" + client + "', " + date
        + ", " + date + " + 30, " + total + ", 0, " + total + ", '" + A + "', '" + ADMIN + "', 'sent', 0)"
        + " ON CONFLICT (id) DO NOTHING;";
  }

  private static String imputations(String... paires) {
    StringBuilder json = new StringBuilder("[");
    for (int i = 0; i < paires.length; i += 2) {
      if (i > 0) json.append(',');
      json.append("{\"invoice_id\":\"").append(paires[i]).append("\",\"amount\":").append(paires[i + 1]).append('}');
    }
    return json.append(']').toString();
  }

  private static void regler(String kind, String tiers, String allocations) throws SQLException {
    asUser("SELECT record_settlement('" + kind + "', '" + tiers + "', CURRENT_DATE, 'bank_transfer', 'REG-IT', '"
        + allocations + "'::jsonb)");
  }

  @Test
  @DisplayName("un règlement client réparti sur deux de SES factures : deux encaissements, deux écritures, factures recalculées")
  void reglementReparti() throws SQLException {
    regler("ar", CLIENT_1, imputations(F1, "1000", F2, "200"));

    assertThat(texte("SELECT string_agg(invoice_number || ':' || status || ':' || amount_paid::numeric(18,0), ' ' ORDER BY invoice_number)"
            + " FROM ar_invoices WHERE id IN ('" + F1 + "', '" + F2 + "')"))
        .isEqualTo("REG-1:paid:1000 REG-2:partially_paid:200");
    assertThat(compte("SELECT count(*) FROM journal_entries WHERE source = 'ar_receipt' AND description = 'AR Receipt: REG-IT'"))
        .isEqualTo(2);
  }

  @Test
  @DisplayName("refus : facture d'un autre client, montant au-delà du restant, facture fournisseur non approuvée — rien n'est enregistré")
  void refus() {
    long avant = compte("SELECT count(*) FROM payments");

    assertThatThrownBy(() -> regler("ar", CLIENT_1, imputations(F2, "100", F_AUTRE, "100")))
        .hasMessageContaining("n'appartient pas au client choisi");
    assertThatThrownBy(() -> regler("ar", CLIENT_2, imputations(F_AUTRE, "701")))
        .hasMessageContaining("restant dû");
    assertThatThrownBy(() -> regler("ar", CLIENT_2, imputations(F_AUTRE, "100", F_AUTRE, "100")))
        .hasMessageContaining("deux fois");
    assertThatThrownBy(() -> regler("ap", FOURNISSEUR, imputations(FF_NON_APPROUVEE, "100")))
        .hasMessageContaining("n'est pas approuvée");
    assertThatThrownBy(() -> regler("ap", FOURNISSEUR, imputations(F_AUTRE, "100")))
        .as("une facture client ne se paie pas comme une facture fournisseur")
        .hasMessageContaining("introuvable");

    assertThat(compte("SELECT count(*) FROM payments"))
        .as("tout ou rien : la première imputation valide du premier essai n'a pas été gardée")
        .isEqualTo(avant);
  }

  @Test
  @DisplayName("une facture fournisseur ne cite qu'une commande de son propre fournisseur")
  void pieceOrigineDuMemeTiers() {
    String autre = "00000000-0000-0000-0000-0000000f0369";
    String commande = "00000000-0000-0000-0000-0000000d3601";
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + autre + "', '" + A + "', 'Autre fournisseur')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, created_by) VALUES"
        + " ('" + commande + "', '" + A + "', 'BC-V36', '" + autre + "', 'approved', '" + ADMIN + "') ON CONFLICT (id) DO NOTHING");

    assertThatThrownBy(() -> owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, po_id, due_date,"
            + " subtotal, created_by) VALUES ('" + A + "', 'FF-V36-X', '" + FOURNISSEUR + "', '" + commande + "',"
            + " CURRENT_DATE, 100, '" + ADMIN + "')"))
        .hasMessageContaining("n'est pas une commande de ce fournisseur");
    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, po_id, due_date, subtotal, created_by)"
        + " VALUES ('" + A + "', 'FF-V36-OK', '" + autre + "', '" + commande + "', CURRENT_DATE, 100, '" + ADMIN + "')"
        + " ON CONFLICT DO NOTHING");
    assertThat(compte("SELECT count(*) FROM ap_invoices WHERE invoice_number = 'FF-V36-OK'")).isEqualTo(1);
  }

  // ─── Outils ───

  private static void asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + ADMIN + "\",\"role\":\"authenticated\"}");
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
