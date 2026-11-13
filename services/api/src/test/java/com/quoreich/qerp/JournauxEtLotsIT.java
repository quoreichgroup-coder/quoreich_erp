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
 * V38 — chaque écriture d'un livre auxiliaire arrive au grand livre dans un JOURNAL (VT, AC, BQ,
 * OD…), un LOT par journal et par mois, avec un numéro de pièce continu par journal et exercice ;
 * une écriture comptabilisée est intangible.
 */
@SpringBootTest
class JournauxEtLotsIT {

  private static final String DATABASE = "qerp_it_journaux_lots";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0381";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V38')"
        + " ON CONFLICT (id) DO NOTHING");
  }

  @Test
  @DisplayName("facture client → VT, facture fournisseur → AC, règlements → BQ, saisie manuelle → OD ; pièces continues ; lot par mois")
  void journauxPiecesEtLots() {
    String annee = texte("SELECT extract(year FROM CURRENT_DATE)::text");
    long avantVt = compte("SELECT count(*) FROM journal_entries WHERE tenant_id = '" + A + "' AND journal_code = 'VT'"
        + " AND extract(year FROM entry_date) = extract(year FROM CURRENT_DATE)");

    owner("INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, total,"
        + " tenant_id, created_by, status, amount_paid) VALUES ('00000000-0000-0000-0000-0000000a3801', 'FAC-V38-1', '" + CLIENT + "',"
        + " CURRENT_DATE, CURRENT_DATE + 30, 1000, 0, 1000, '" + A + "', '" + ADMIN + "', 'sent', 0),"
        + " ('00000000-0000-0000-0000-0000000a3802', 'FAC-V38-2', '" + CLIENT + "',"
        + " CURRENT_DATE, CURRENT_DATE + 30, 500, 0, 500, '" + A + "', '" + ADMIN + "', 'sent', 0);"
        + "INSERT INTO payments (ar_invoice_id, amount, reference, tenant_id, payment_type, payment_date, created_by) VALUES"
        + " ('00000000-0000-0000-0000-0000000a3801', 1000, 'ENC-V38', '" + A + "', 'ar_receipt', CURRENT_DATE, '" + ADMIN + "');"
        + "INSERT INTO ap_invoices (tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount,"
        + " status, approval_status, created_by) VALUES ('" + A + "', 'FF-V38', '" + FOURNISSEUR + "', CURRENT_DATE,"
        + " CURRENT_DATE + 30, 200, 0, 'draft', 'pending', '" + ADMIN + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE invoice_number = 'FF-V38'");

    assertThat(texte("SELECT string_agg(e.description || '=' || e.journal_code, ' ; ' ORDER BY e.description) FROM journal_entries e"
            + " WHERE e.description IN ('AR Invoice: FAC-V38-1', 'AR Invoice: FAC-V38-2', 'AR Receipt: ENC-V38', 'AP Invoice: FF-V38')"))
        .isEqualTo("AP Invoice: FF-V38=AC ; AR Invoice: FAC-V38-1=VT ; AR Invoice: FAC-V38-2=VT ; AR Receipt: ENC-V38=BQ");
    assertThat(texte("SELECT string_agg(piece_number, ',' ORDER BY piece_number) FROM journal_entries"
            + " WHERE description IN ('AR Invoice: FAC-V38-1', 'AR Invoice: FAC-V38-2')"))
        .as("numéros consécutifs dans le journal des ventes")
        .isEqualTo(String.format("VT-%s-%06d,VT-%s-%06d", annee, avantVt + 1, annee, avantVt + 2));
    assertThat(texte("SELECT b.batch_number FROM journal_entries e JOIN journal_batches b ON b.id = e.batch_id"
            + " WHERE e.description = 'AP Invoice: FF-V38'"))
        .isEqualTo("LOT-AC-" + texte("SELECT to_char(CURRENT_DATE, 'YYYY-MM')"));
    assertThat(texte("SELECT (total_debit = total_credit)::text || ' ' || status FROM journal_batch_summary"
            + " WHERE tenant_id = '" + A + "' AND journal_code = 'VT' AND period = to_char(CURRENT_DATE, 'YYYY-MM')"))
        .as("lot équilibré, ouvert tant que la période GL est ouverte")
        .isEqualTo("true open");
  }

  @Test
  @DisplayName("une écriture comptabilisée est intangible : ni date, ni libellé, ni journal ; la suppression est refusée")
  void intangibilite() {
    owner("INSERT INTO ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, total,"
        + " tenant_id, created_by, status, amount_paid) VALUES ('00000000-0000-0000-0000-0000000a3811', 'FAC-V38-X', '" + CLIENT + "',"
        + " CURRENT_DATE, CURRENT_DATE + 30, 700, 0, 700, '" + A + "', '" + ADMIN + "', 'sent', 0) ON CONFLICT (id) DO NOTHING");
    String ecriture = "(SELECT journal_entry_id FROM ar_invoices WHERE invoice_number = 'FAC-V38-X')";

    assertThatThrownBy(() -> owner("UPDATE journal_entries SET entry_date = entry_date - 40 WHERE id = " + ecriture))
        .hasMessageContaining("intangible");
    assertThatThrownBy(() -> owner("UPDATE journal_entries SET description = 'modifiée' WHERE id = " + ecriture))
        .hasMessageContaining("intangible");
    assertThatThrownBy(() -> owner("DELETE FROM journal_entries WHERE id = " + ecriture))
        .hasMessageContaining("ne se supprime pas");
    assertThat(compte("SELECT count(*) FROM journal_entries WHERE id = " + ecriture + " AND description = 'AR Invoice: FAC-V38-X'"))
        .isEqualTo(1);
  }

  // ─── Outils ───

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
