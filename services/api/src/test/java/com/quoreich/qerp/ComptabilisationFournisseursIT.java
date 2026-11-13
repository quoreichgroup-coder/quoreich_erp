package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V37 — la facture fournisseur approuvée porte son écriture (rôles PURCHASES, VAT_INPUT,
 * AP_PAYABLE), et un paramétrage incomplet refuse l'approbation (QG001) au lieu de laisser une
 * facture approuvée sans écriture. Échoue sans V37 : l'ancienne fonction cherchait 4010 / 6010.
 */
@SpringBootTest
class ComptabilisationFournisseursIT {

  private static final String DATABASE = "qerp_it_comptabilisation_ap";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String FOURNISSEUR_A = "00000000-0000-0000-0000-0000000f0371";
  private static final String FOURNISSEUR_B = "00000000-0000-0000-0000-0000000f0372";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR_A + "', '" + A + "', 'Fournisseur V37'),"
        + " ('" + FOURNISSEUR_B + "', '" + B + "', 'Fournisseur V37 B') ON CONFLICT (id) DO NOTHING");
  }

  private static void facture(String tenant, String fournisseur, String numero, int ht, int tva) {
    owner("INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount,"
        + " status, approval_status, created_by) VALUES ('" + tenant + "', '" + numero + "', '" + fournisseur + "',"
        + " CURRENT_DATE - 2, CURRENT_DATE + 28, " + ht + ", " + tva + ", 'draft', 'pending', '" + ADMIN + "')");
  }

  private static void approuver(String numero) {
    owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = '" + numero + "'");
  }

  @Test
  @DisplayName("approuvée : écriture 601 / 4452 au débit, 401 au crédit, datée de la facture, équilibrée")
  void ecritureAuPlanSyscohada() {
    facture(A, FOURNISSEUR_A, "FF-V37-1", 100000, 18000);
    approuver("FF-V37-1");

    assertThat(texte("SELECT string_agg(g.code || ':' || l.debit::numeric(18,0) || ':' || l.credit::numeric(18,0), ' ' ORDER BY g.code)"
            + " FROM ap_invoices a JOIN journal_lines l ON l.entry_id = a.journal_entry_id JOIN gl_accounts g ON g.id = l.account_id"
            + " WHERE a.invoice_number = 'FF-V37-1'"))
        .isEqualTo("401:0:118000 4452:18000:0 601:100000:0");
    assertThat(texte("SELECT (e.entry_date = a.invoice_date)::text || ' ' || e.status FROM ap_invoices a"
            + " JOIN journal_entries e ON e.id = a.journal_entry_id WHERE a.invoice_number = 'FF-V37-1'"))
        .isEqualTo("true posted");

    facture(A, FOURNISSEUR_A, "FF-V37-2", 40000, 0);
    approuver("FF-V37-2");
    assertThat(texte("SELECT count(*)::text FROM ap_invoices a JOIN journal_lines l ON l.entry_id = a.journal_entry_id"
            + " WHERE a.invoice_number = 'FF-V37-2'"))
        .as("sans TVA : deux lignes, achats et fournisseur")
        .isEqualTo("2");
  }

  @Test
  @DisplayName("paramétrage incomplet : l'approbation est refusée (QG001), la facture reste en attente")
  void approbationRefuseeSansParametrage() {
    owner("DELETE FROM tenant_posting_accounts WHERE tenant_id = '" + B + "' AND role_code IN ('PURCHASES', 'VAT_INPUT')");
    facture(B, FOURNISSEUR_B, "FF-V37-B", 50000, 9000);

    assertThatThrownBy(() -> approuver("FF-V37-B"))
        .hasMessageContaining("Paramétrage comptable incomplet")
        .hasMessageContaining("FF-V37-B");
    assertThat(texte("SELECT approval_status || ' ' || (journal_entry_id IS NULL)::text FROM ap_invoices WHERE invoice_number = 'FF-V37-B'"))
        .isEqualTo("pending true");
  }

  // ─── Outils ───

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
