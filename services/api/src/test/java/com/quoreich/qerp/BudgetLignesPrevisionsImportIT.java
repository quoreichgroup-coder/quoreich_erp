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
 * V78 — budget, fin du module : section analytique par ligne de pièce (contrôle, reprise demande → commande →
 * facture, écriture ventilée par section), préparation d'un budget et d'une prévision par fichier (tout ou rien),
 * versions de prévision publiées et figées, révisions validées par une autre personne au-delà d'un seuil.
 */
@SpringBootTest
class BudgetLignesPrevisionsImportIT {

  private static final String DATABASE = "qerp_it_budget_lignes_previsions";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String APPROBATEUR = "aaaaaaaa-7878-0000-0000-000000000078";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0078";
  private static final String AXE = "00000000-0000-0000-0000-0000000a0078";
  private static final String PROD = "00000000-0000-0000-0000-0000000d0081";
  private static final String ATELIER = "00000000-0000-0000-0000-0000000d0082";
  private static final String ADM = "00000000-0000-0000-0000-0000000d0083";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + APPROBATEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + APPROBATEUR + "', '" + A + "', 'Directeur financier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V78') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO gl_accounts (tenant_id, code, name, account_type, is_header) VALUES ('" + A + "', '60', 'Achats et variations de stocks', 'expense', true)"
        + " ON CONFLICT (tenant_id, code) DO NOTHING;"
        + "INSERT INTO analytic_axes (id, tenant_id, code, name) VALUES ('" + AXE + "', '" + A + "', 'CF', 'Centre financier') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO analytic_values (id, tenant_id, axis_id, code, name, parent_id) VALUES"
        + " ('" + PROD + "', '" + A + "', '" + AXE + "', 'PROD', 'Production', NULL),"
        + " ('" + ATELIER + "', '" + A + "', '" + AXE + "', 'PROD-AT', 'Atelier', '" + PROD + "'),"
        + " ('" + ADM + "', '" + A + "', '" + AXE + "', 'ADM', 'Administration', NULL) ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, APPROBATEUR, "budget_approver", A);
  }

  private static String compte(String code) {
    return texte("SELECT id::text FROM gl_accounts WHERE tenant_id = '" + A + "' AND code = '" + code + "'");
  }

  private static String budgetApprouve(String annee, int general, int production) {
    String b = UUID.randomUUID().toString();
    owner("INSERT INTO budgets (id, tenant_id, name, fiscal_year, scenario, total_amount, status, is_control, created_by, approved_by, approved_at) VALUES ('" + b
        + "', '" + A + "', 'Budget " + annee + "', '" + annee + "', 'base', 0, 'approved', true, '" + ADMIN + "', '" + APPROBATEUR + "', now());"
        + "INSERT INTO budget_lines (tenant_id, budget_id, gl_account_id, period, planned_amount, analytic_value_id) VALUES"
        + " ('" + A + "', '" + b + "', '" + compte("60") + "', '" + annee + "', " + general + ", NULL),"
        + " ('" + A + "', '" + b + "', '" + compte("60") + "', '" + annee + "', " + production + ", '" + PROD + "')");
    return b;
  }

  /** Commande en brouillon, une ligne par [libellé, montant, section]. */
  private static String commande(String date, Object[]... lignes) {
    String po = UUID.randomUUID().toString();
    StringBuilder sql = new StringBuilder("INSERT INTO purchase_orders (id, tenant_id, supplier_id, order_date, total, status, created_by) VALUES ('" + po + "', '" + A
        + "', '" + FOURNISSEUR + "', '" + date + "', 0, 'draft', '" + ADMIN + "');");
    for (Object[] l : lignes) {
      String id = UUID.randomUUID().toString();
      sql.append("INSERT INTO po_lines (id, po_id, description, quantity, unit_cost) VALUES ('").append(id).append("', '").append(po).append("', '")
          .append(l[0]).append("', 1, ").append(l[1]).append(");");
      sql.append("INSERT INTO po_line_analytics (tenant_id, line_id, axis_id, value_id) VALUES ('").append(A).append("', '").append(id).append("', '")
          .append(AXE).append("', '").append(l[2]).append("');");
    }
    owner(sql.toString());
    owner("UPDATE purchase_orders SET total = (SELECT sum(total) FROM po_lines WHERE po_id = '" + po + "') WHERE id = '" + po + "'");
    return po;
  }

  @Test
  @DisplayName("section par ligne : contrôle sur la part de la section, reprise jusqu'à la facture, écriture ventilée")
  void sectionsParLigne() throws SQLException {
    budgetApprouve("2042", 100000, 30000);
    owner("INSERT INTO budget_settings (tenant_id, control_mode) VALUES ('" + A + "', 'block') ON CONFLICT (tenant_id) DO UPDATE SET control_mode = 'block'");

    String po1 = commande("2042-02-01", new Object[] {"Pièces atelier", 25000, ATELIER}, new Object[] {"Fournitures bureau", 10000, ADM});
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po1 + "'; UPDATE purchase_orders SET status = 'approved' WHERE id = '" + po1 + "'");
    assertThat(asUser(ADMIN, "SELECT trim_scale(committed)::text FROM budget_status('2042') WHERE analytic_value_id = '" + PROD + "'"))
        .as("seule la ligne de l'atelier engage la Production").isEqualTo("25000");

    String po2 = commande("2042-02-03", new Object[] {"Outillage", 10000, ATELIER});
    assertThatThrownBy(() -> owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po2 + "'"))
        .as("10 000 pour 5 000 disponibles sur la Production").hasMessageContaining("Budget dépassé").hasMessageContaining("PROD Production");
    String po3 = commande("2042-02-03", new Object[] {"Ramettes", 40000, ADM});
    owner("UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '" + po3 + "'");

    // Facture à lignes citant les lignes de la commande : sections reprises, écriture ventilée par section.
    String inv = UUID.randomUUID().toString();
    owner("INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, po_id, invoice_date, due_date, subtotal, tax_amount, status, approval_status, created_by)"
        + " VALUES ('" + inv + "', '" + A + "', 'FF-V78-1', '" + FOURNISSEUR + "', '" + po1 + "', '2042-02-20', '2042-03-20', 0, 0, 'draft', 'draft', '" + ADMIN + "');"
        + "INSERT INTO ap_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, po_line_id)"
        + " SELECT '" + A + "', '" + inv + "', row_number() OVER (ORDER BY description), description, 1, unit_cost, id FROM po_lines WHERE po_id = '" + po1 + "'");
    assertThat(texte("SELECT count(*) FROM ap_invoice_line_analytics a JOIN ap_invoice_lines l ON l.id = a.line_id WHERE l.invoice_id = '" + inv + "'")).isEqualTo("2");
    owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + inv + "'");
    assertThat(texte("SELECT string_agg(g.code || '=' || trim_scale(l.debit - l.credit) || '=' || COALESCE(v.code, '-'), ',' ORDER BY g.code, v.code)"
        + " FROM ap_invoices i JOIN journal_lines l ON l.entry_id = i.journal_entry_id JOIN gl_accounts g ON g.id = l.account_id"
        + " LEFT JOIN journal_line_analytics la ON la.line_id = l.id LEFT JOIN analytic_values v ON v.id = la.value_id WHERE i.id = '" + inv + "'"))
        .as("une ligne de charge par section").isEqualTo("401=-35000=-,601=10000=ADM,601=25000=PROD-AT");
    assertThat(asUser(ADMIN, "SELECT trim_scale(committed) || ' ' || trim_scale(actual) FROM budget_status('2042') WHERE analytic_value_id = '" + PROD + "'"))
        .isEqualTo("0 25000");

    // Demande à lignes convertie : la section de chaque ligne passe à la ligne de commande.
    String pr = UUID.randomUUID().toString();
    String prl = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_requisitions (id, tenant_id, requested_by, request_date, description, estimated_total, status) VALUES ('" + pr + "', '" + A
        + "', '" + ADMIN + "', '2042-04-01', 'Demande V78', 3000, 'draft');"
        + "INSERT INTO requisition_lines (id, requisition_id, description, quantity, estimated_unit_cost) VALUES ('" + prl + "', '" + pr + "', 'Gants', 1, 3000);"
        + "INSERT INTO requisition_line_analytics (tenant_id, line_id, axis_id, value_id) VALUES ('" + A + "', '" + prl + "', '" + AXE + "', '" + ATELIER + "');"
        + "UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '" + pr + "'; UPDATE purchase_requisitions SET status = 'approved' WHERE id = '" + pr + "'");
    String nouvelle = asUser(ADMIN, "SELECT convert_pr_to_po('" + pr + "', '" + FOURNISSEUR + "')::text");
    assertThat(texte("SELECT v.code FROM po_lines pl JOIN po_line_analytics a ON a.line_id = pl.id JOIN analytic_values v ON v.id = a.value_id"
        + " WHERE pl.po_id = '" + nouvelle + "' AND pl.requisition_line_id = '" + prl + "'")).isEqualTo("PROD-AT");
    assertThatThrownBy(() -> asUser(ADMIN, "DELETE FROM po_line_analytics WHERE line_id IN (SELECT id FROM po_lines WHERE po_id = '" + po1 + "') RETURNING line_id::text"))
        .as("commande approuvée : sections de ligne figées").hasMessageContaining("figée");
  }

  @Test
  @DisplayName("import de budget : anomalies listées, rien n'est modifié")
  void importRefuse() throws SQLException {
    String b = asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget importé', '2043', 'base', 0, 'draft', auth.uid()) RETURNING id::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT import_budget_lines('" + b + "', '[{\"line\":2,\"account\":\"60\",\"period\":\"2043\",\"amount\":\"100000\"},"
        + "{\"line\":3,\"account\":\"999\",\"period\":\"2043\",\"amount\":\"5\"},{\"line\":4,\"account\":\"60\",\"section\":\"PROD\",\"period\":\"2044-01\",\"amount\":\"10\"}]')::text"))
        .hasMessageContaining("rien n'a été modifié").hasMessageContaining("ligne 3 : compte 999").hasMessageContaining("ligne 4 : période 2044-01 hors exercice");
  }

  @Test
  @DisplayName("import valide ; prévision publiée figée ; révision au-delà du seuil validée par un tiers")
  void importValideEtRevisions() throws SQLException {
    String b = asUser(ADMIN, "INSERT INTO budgets (tenant_id, name, fiscal_year, scenario, total_amount, status, created_by) VALUES ('" + A
        + "', 'Budget importé 2044', '2044', 'base', 0, 'draft', auth.uid()) RETURNING id::text");
    assertThat(asUser(ADMIN, "SELECT import_budget_lines('" + b + "', '[{\"line\":2,\"account\":\"60\",\"period\":\"2044\",\"amount\":100000},"
        + "{\"line\":3,\"account\":\"60\",\"section\":\"CF/PROD\",\"period\":\"2044\",\"amount\":30000},{\"line\":4,\"account\":\"601\",\"section\":\"adm\",\"period\":\"2044-03\",\"amount\":2500.5}]')::text"))
        .isEqualTo("3");
    assertThat(texte("SELECT string_agg(g.code || ' ' || COALESCE(v.code, '-') || ' ' || l.period || ' ' || trim_scale(l.planned_amount), ', ' ORDER BY g.code, l.period)"
        + " FROM budget_lines l JOIN gl_accounts g ON g.id = l.gl_account_id LEFT JOIN analytic_values v ON v.id = l.analytic_value_id WHERE l.budget_id = '" + b + "'"))
        .isEqualTo("60 - 2044 100000, 60 PROD 2044 30000, 601 ADM 2044-03 2500.5");

    String f = asUser(ADMIN, "INSERT INTO budget_forecasts (tenant_id, fiscal_year, name, status) VALUES ('" + A + "', '2044', 'Révision T1', 'published') RETURNING status || ' ' || id");
    assertThat(f).as("créée en brouillon quoi qu'on envoie").startsWith("draft ");
    String forecast = f.substring(6);
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT budget_forecast_publish('" + forecast + "')::text")).hasMessageContaining("sans ligne");
    assertThat(asUser(ADMIN, "SELECT import_budget_forecast_lines('" + forecast + "', '[{\"line\":2,\"account\":\"60\",\"amount\":120000,\"comment\":\"Hausse des prix\"},"
        + "{\"line\":3,\"account\":\"60\",\"section\":\"PROD\",\"amount\":45000}]')::text")).isEqualTo("2");
    asUser(ADMIN, "SELECT budget_forecast_publish('" + forecast + "')::text");
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE budget_forecast_lines SET amount = 1 WHERE forecast_id = '" + forecast + "' RETURNING id::text"))
        .hasMessageContaining("figées");
    assertThatThrownBy(() -> asUser(APPROBATEUR, "INSERT INTO budget_forecasts (tenant_id, fiscal_year, name) VALUES ('" + A + "', '2044', 'Sans droit') RETURNING id::text"))
        .as("budget.forecast requis").hasMessageContaining("row-level security");

    // Révisions : directes sous le seuil, demandées au-delà, validées par une autre personne.
    owner("UPDATE budgets SET status = 'approved', is_control = true, approved_by = '" + APPROBATEUR + "', approved_at = now() WHERE id = '" + b + "';"
        + "INSERT INTO budget_settings (tenant_id, revision_second_person, revision_threshold_pct) VALUES ('" + A + "', true, 10)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET revision_second_person = true, revision_threshold_pct = 10");
    String ligne = texte("SELECT id::text FROM budget_lines WHERE budget_id = '" + b + "' AND analytic_value_id IS NULL");
    assertThat(asUser(ADMIN, "SELECT budget_revise_line('" + ligne + "', 105000, 'Ajustement')")).isEqualTo("applied");
    assertThat(asUser(ADMIN, "SELECT budget_revise_line('" + ligne + "', 160000, 'Nouveau site')")).isEqualTo("pending");
    assertThat(texte("SELECT trim_scale(planned_amount)::text FROM budget_lines WHERE id = '" + ligne + "'")).as("demande en attente : rien ne change").isEqualTo("105000");
    String demande = texte("SELECT id::text FROM budget_revisions WHERE budget_line_id = '" + ligne + "' AND status = 'pending'");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT budget_revision_decide('" + demande + "', true)::text")).hasMessageContaining("autre personne");
    asUser(APPROBATEUR, "SELECT budget_revision_decide('" + demande + "', true, 'Validé en comité')::text");
    assertThat(texte("SELECT trim_scale(planned_amount)::text FROM budget_lines WHERE id = '" + ligne + "'")).isEqualTo("160000");
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
