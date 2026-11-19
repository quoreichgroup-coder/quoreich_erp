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
 * V109 — notes de frais : saisie TTC et TVA calculée, contrôles (justificatif, plafond), numéro à la
 * soumission, approbation par un tiers habilité, comptabilisation (HT + TVA / « à rembourser »),
 * remboursement en trésorerie, gardes et confidentialité (chacun ne voit que ses notes).
 */
@SpringBootTest
class NotesDeFraisIT {

  private static final String DATABASE = "qerp_it_notes_de_frais";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String COMPTABLE = PostgresFixture.ALPHA_USER;
  private static final String SALARIE = "aaaaaaaa-0000-0000-0000-0000000109c1";
  private static final String COLLEGUE = "aaaaaaaa-0000-0000-0000-0000000109c2";
  private static final String APPROBATEUR = "aaaaaaaa-0000-0000-0000-0000000109a1";
  private static final String EMPLOYE = "e1090000-0000-0000-0000-000000000001";
  private static final String CATEGORIE = "c1090000-0000-0000-0000-000000000001";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    StringBuilder sql = new StringBuilder();
    for (String u : new String[] {SALARIE, COLLEGUE, APPROBATEUR}) {
      sql.append("INSERT INTO auth.users (id) VALUES ('").append(u).append("') ON CONFLICT DO NOTHING;")
          .append("INSERT INTO profiles (id, tenant_id, full_name) VALUES ('").append(u).append("', '").append(A).append("', 'U') ON CONFLICT (id) DO NOTHING;");
    }
    sql.append("INSERT INTO gl_accounts (tenant_id, code, name, account_type) VALUES ('").append(A).append("', '6251', 'Voyages et déplacements', 'expense') ON CONFLICT DO NOTHING;")
        .append("INSERT INTO tax_codes (id, tenant_id, code, name, rate, gl_account_id) SELECT 'b1090000-0000-0000-0000-000000000018', '").append(A)
        .append("', 'TVA18NDF', 'TVA 18 %', 18, id FROM gl_accounts WHERE tenant_id = '").append(A).append("' AND code = '4452' ON CONFLICT DO NOTHING;")
        .append("INSERT INTO expense_categories (id, tenant_id, code, name, gl_account_id, default_tax_code_id, receipt_required_above, max_amount_per_line)")
        .append(" SELECT '").append(CATEGORIE).append("', '").append(A).append("', 'DEPL', 'Déplacements', id, 'b1090000-0000-0000-0000-000000000018', 10000, 500000")
        .append(" FROM gl_accounts WHERE tenant_id = '").append(A).append("' AND code = '6251' ON CONFLICT DO NOTHING;")
        .append("INSERT INTO hr_payroll_settings (tenant_id, currency_code, employer_contribution_pct) VALUES ('").append(A).append("', 'XOF', 0) ON CONFLICT (tenant_id) DO NOTHING;")
        .append("INSERT INTO hr_movement_references (tenant_id, kind, code, label, active) VALUES ('").append(A).append("', 'contract_type', 'cdi', 'CDI', true)")
        .append(" ON CONFLICT (tenant_id, kind, code) DO NOTHING;")
        .append("INSERT INTO employees (id, tenant_id, matricule, first_name, last_name, contract_type, hire_date, base_salary, currency, status) VALUES ('")
        .append(EMPLOYE).append("', '").append(A).append("', 'NDF-1', 'Awa', 'Ouédraogo', 'CDI', CURRENT_DATE, 100000, 'XOF', 'active') ON CONFLICT DO NOTHING;");
    owner(sql.toString());
    PostgresFixture.grantRoles(DATABASE, COMPTABLE, "accountant", A, SALARIE, "expense_clerk", A, COLLEGUE, "expense_clerk", A,
        APPROBATEUR, "expense_approver", A);
  }

  private static String note(String user) throws SQLException {
    return asUser(user, "INSERT INTO expense_reports (tenant_id, employee_id, purpose, status) VALUES (get_user_tenant_id(auth.uid()), '" + EMPLOYE
        + "', 'Mission Bobo-Dioulasso', 'draft') RETURNING id::text");
  }

  private static void ligne(String user, String note, int no, int ttc, String justificatif) throws SQLException {
    asUser(user, "INSERT INTO expense_lines (report_id, line_no, expense_date, category_id, description, amount, receipt_ref) VALUES ('" + note + "', " + no
        + ", CURRENT_DATE, '" + CATEGORIE + "', 'Hôtel', " + ttc + ", " + (justificatif == null ? "NULL" : "'" + justificatif + "'") + ") RETURNING id::text");
  }

  private static String pendingApproval(String note) {
    return texte("SELECT id::text FROM expense_report_approvals WHERE report_id = '" + note + "' AND status = 'pending' ORDER BY level_order LIMIT 1");
  }

  private static String ecriture(String colonne, String note) {
    return texte("SELECT je.journal_code || ' ' || string_agg(g.code || ':' || l.debit::numeric(18,0) || '/' || l.credit::numeric(18,0), ' ' ORDER BY g.code)"
        + " FROM expense_reports r JOIN journal_entries je ON je.id = r." + colonne + " JOIN journal_lines l ON l.entry_id = je.id"
        + " JOIN gl_accounts g ON g.id = l.account_id WHERE r.id = '" + note + "' GROUP BY je.journal_code");
  }

  @Test
  @DisplayName("cycle complet : TVA calculée sur le TTC, justificatif exigé, approbation par un tiers, écriture, remboursement")
  void cycleComplet() throws SQLException {
    String n = note(SALARIE);
    ligne(SALARIE, n, 1, 59000, null);
    assertThat(texte("SELECT total::numeric(18,0) || ' ' || subtotal::numeric(18,0) || ' ' || tax_amount::numeric(18,0) FROM expense_reports WHERE id = '" + n + "'"))
        .as("59 000 TTC à 18 % : 9 000 de TVA, 50 000 HT").isEqualTo("59000 50000 9000");
    assertThatThrownBy(() -> asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text")).hasMessageContaining("justificatif exigé");
    asUser(SALARIE, "UPDATE expense_lines SET receipt_ref = 'Facture hôtel 2041' WHERE report_id = '" + n + "' RETURNING id::text");
    asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text");
    assertThat(texte("SELECT status || ' ' || (report_number LIKE 'NDF-%')::text FROM expense_reports WHERE id = '" + n + "'")).isEqualTo("submitted true");

    assertThatThrownBy(() -> asUser(SALARIE, "UPDATE expense_lines SET amount = 1 WHERE report_id = '" + n + "' RETURNING id::text"))
        .as("note soumise : lignes figées").hasMessageContaining("plus modifiables");
    assertThatThrownBy(() -> asUser(SALARIE, "SELECT expense_report_decide('" + pendingApproval(n) + "', true, NULL)"))
        .as("l'auteur n'approuve pas sa note").isInstanceOf(SQLException.class);
    assertThat(asUser(APPROBATEUR, "SELECT expense_report_decide('" + pendingApproval(n) + "', true, 'OK')")).isEqualTo("approved");

    asUser(COMPTABLE, "SELECT expense_report_post('" + n + "', CURRENT_DATE)::text");
    assertThat(ecriture("journal_entry_id", n)).isEqualTo("OD 422:0/59000 4452:9000/0 6251:50000/0");
    asUser(COMPTABLE, "SELECT expense_report_pay('" + n + "', CURRENT_DATE, 'cash', NULL, 'Caisse')::text");
    assertThat(ecriture("payment_journal_entry_id", n)).isEqualTo("BQ 422:59000/0 571:0/59000");
    assertThat(texte("SELECT status FROM expense_reports WHERE id = '" + n + "'")).isEqualTo("paid");
  }

  @Test
  @DisplayName("rejet motivé puis nouvelle soumission ; plafond de catégorie ; gardes ; confidentialité")
  void rejetGardesConfidentialite() throws SQLException {
    String n = note(SALARIE);
    ligne(SALARIE, n, 1, 600000, "Billet");
    assertThatThrownBy(() -> asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text")).hasMessageContaining("plafond de la catégorie");
    asUser(SALARIE, "UPDATE expense_lines SET amount = 8000 WHERE report_id = '" + n + "' RETURNING id::text");
    asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text");
    assertThatThrownBy(() -> asUser(APPROBATEUR, "SELECT expense_report_decide('" + pendingApproval(n) + "', false, '')")).hasMessageContaining("Motif");
    asUser(APPROBATEUR, "SELECT expense_report_decide('" + pendingApproval(n) + "', false, 'Joindre le billet')");
    assertThat(texte("SELECT status || ' ' || rejection_reason FROM expense_reports WHERE id = '" + n + "'")).isEqualTo("rejected Joindre le billet");
    asUser(SALARIE, "UPDATE expense_reports SET purpose = 'Mission corrigée' WHERE id = '" + n + "' RETURNING id::text");
    asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text");

    assertThatThrownBy(() -> asUser(SALARIE, "UPDATE expense_reports SET status = 'approved' WHERE id = '" + n + "' RETURNING id::text"))
        .as("statut par les fonctions seulement").isInstanceOf(SQLException.class);
    assertThatThrownBy(() -> asUser(SALARIE, "INSERT INTO expense_reports (tenant_id, employee_id, status) VALUES (get_user_tenant_id(auth.uid()), '" + EMPLOYE
        + "', 'approved') RETURNING id::text")).hasMessageContaining("brouillon");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT expense_report_post('" + n + "', CURRENT_DATE)::text")).hasMessageContaining("approuvée");

    assertThat(asUser(COLLEGUE, "SELECT count(*)::text FROM expense_reports WHERE id = '" + n + "'")).as("un collègue ne voit pas la note").isEqualTo("0");
    assertThat(asUser(APPROBATEUR, "SELECT count(*)::text FROM expense_reports WHERE id = '" + n + "'")).as("l'approbateur la voit").isEqualTo("1");
    String id = UUID.randomUUID().toString();
    assertThatThrownBy(() -> asUser(SALARIE, "INSERT INTO expense_categories (id, tenant_id, code, name, gl_account_id) SELECT '" + id
        + "', get_user_tenant_id(auth.uid()), 'X', 'X', gl_account_id FROM expense_categories LIMIT 1 RETURNING id::text"))
        .as("catégories : droit expenses.settings").hasMessageContaining("row-level security");
    assertThatThrownBy(() -> owner("INSERT INTO expense_categories (tenant_id, code, name, gl_account_id) SELECT '" + A
        + "', 'REGROUP', 'Regroupement', id FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '411'"))
        .as("V110 : compte de charge imputable exigé").hasStackTraceContaining("compte de charge actif et imputable");
  }

  @Test
  @DisplayName("V112 : barème kilométrique, dépense en devise, avance imputée au remboursement puis restituée")
  void avancesBaremesDevises() throws SQLException {
    owner("INSERT INTO expense_rates (id, tenant_id, kind, code, name, unit, rate, category_id) VALUES ('d1120000-0000-0000-0000-000000000001', '" + A
        + "', 'mileage', 'KM', 'Indemnité kilométrique', 'km', 150, '" + CATEGORIE + "') ON CONFLICT DO NOTHING");
    String n = note(SALARIE);
    asUser(SALARIE, "INSERT INTO expense_lines (report_id, line_no, expense_date, rate_id, quantity, description, amount) VALUES ('" + n
        + "', 1, CURRENT_DATE, 'd1120000-0000-0000-0000-000000000001', 100, 'Trajet Ouaga-Koudougou', 1) RETURNING id::text");
    asUser(SALARIE, "INSERT INTO expense_lines (report_id, line_no, expense_date, category_id, description, amount, original_currency, original_amount, exchange_rate,"
        + " receipt_ref, tax_code_id) VALUES ('" + n + "', 2, CURRENT_DATE, '" + CATEGORIE + "', 'Hôtel Paris', 1, 'EUR', 100, 655.957, 'Facture', NULL) RETURNING id::text");
    assertThat(texte("SELECT string_agg(amount::numeric(18,2)::text || '/' || tax_amount::numeric(18,2)::text, ' ' ORDER BY line_no) FROM expense_lines WHERE report_id = '" + n + "'"))
        .as("100 km × 150 sans TVA ; 100 EUR au cours 655,957 (TVA 18 % de la catégorie sur la contre-valeur)").isEqualTo("15000.00/0.00 65595.70/10006.12");

    asUser(SALARIE, "SELECT expense_report_submit('" + n + "')::text");
    asUser(APPROBATEUR, "SELECT expense_report_decide('" + pendingApproval(n) + "', true, NULL)");
    asUser(COMPTABLE, "SELECT expense_report_post('" + n + "', CURRENT_DATE)::text");

    String avance = asUser(COMPTABLE, "SELECT expense_advance_pay('" + EMPLOYE + "', CURRENT_DATE, 30000, 'Mission', 'cash', NULL, NULL)::text");
    assertThat(texte("SELECT advance_number LIKE 'AVS-%' FROM expense_advances WHERE id = '" + avance + "'")).isEqualTo("t");
    assertThat(texte("SELECT je.journal_code || ' ' || string_agg(g.code || ':' || l.debit::numeric(18,0) || '/' || l.credit::numeric(18,0), ' ' ORDER BY g.code)"
        + " FROM expense_advances a JOIN journal_entries je ON je.id = a.journal_entry_id JOIN journal_lines l ON l.entry_id = je.id JOIN gl_accounts g ON g.id = l.account_id"
        + " WHERE a.id = '" + avance + "' GROUP BY je.journal_code")).isEqualTo("BQ 4211:30000/0 571:0/30000");

    asUser(COMPTABLE, "SELECT expense_report_pay('" + n + "', CURRENT_DATE, 'cash', NULL, NULL, true)::text");
    assertThat(texte("SELECT advance_applied::numeric(18,0)::text FROM expense_reports WHERE id = '" + n + "'")).isEqualTo("30000");
    assertThat(texte("SELECT amount_applied::numeric(18,0)::text FROM expense_advances WHERE id = '" + avance + "'")).isEqualTo("30000");
    assertThat(ecriture("payment_journal_entry_id", n)).as("reste 80 595,70 − 30 000 payé en caisse").isEqualTo("BQ 422:50596/0 571:0/50596");

    String avance2 = asUser(COMPTABLE, "SELECT expense_advance_pay('" + EMPLOYE + "', CURRENT_DATE, 5000, 'Divers', 'cash', NULL, NULL)::text");
    assertThatThrownBy(() -> asUser(COMPTABLE, "SELECT expense_advance_refund('" + avance2 + "', CURRENT_DATE, 6000, 'cash', NULL, NULL)::text")).hasMessageContaining("solde");
    asUser(COMPTABLE, "SELECT expense_advance_refund('" + avance2 + "', CURRENT_DATE, 5000, 'cash', NULL, NULL)::text");
    assertThat(asUser(SALARIE, "SELECT count(*)::text FROM expense_advances")).as("avances : comptabilité et trésorerie seulement").isEqualTo("0");
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
