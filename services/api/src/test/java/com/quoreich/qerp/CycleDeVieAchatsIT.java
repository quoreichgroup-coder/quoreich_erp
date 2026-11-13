package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V39 — cycle de vie des pièces d'achat : brouillon → soumis (file selon les seuils de la société)
 * → approuvé niveau par niveau par des tiers habilités → ou rejeté (motif) → modifiable et
 * resoumis ; annulation ; paramètre « demande obligatoire avant commande » appliqué.
 */
@SpringBootTest
class CycleDeVieAchatsIT {

  private static final String DATABASE = "qerp_it_cycle_achats";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String AUTEUR = PostgresFixture.ALPHA_USER;
  private static final String APPRO_1 = "aaaaaaaa-0000-0000-0000-0000000003a1";
  private static final String APPRO_2 = "aaaaaaaa-0000-0000-0000-0000000003a2";
  private static final String FOURNISSEUR = "00000000-0000-0000-0000-0000000f0391";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO auth.users (id) VALUES ('" + APPRO_1 + "'), ('" + APPRO_2 + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + APPRO_1 + "', '" + A + "', 'Approbateur 1'),"
        + " ('" + APPRO_2 + "', '" + A + "', 'Approbateur 2') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + FOURNISSEUR + "', '" + A + "', 'Fournisseur V39')"
        + " ON CONFLICT (id) DO NOTHING;"
        // Paramètres de la société : seuils à deux niveaux pour les commandes, demande non exigée.
        + "DELETE FROM procurement_approval_thresholds WHERE tenant_id = '" + A + "';"
        + "INSERT INTO procurement_approval_thresholds (tenant_id, doc_type, level, max_amount, approver, sla_hours) VALUES"
        + " ('" + A + "', 'PO', 'L1 — Acheteur', 1000000, 'Acheteur senior', 24),"
        + " ('" + A + "', 'PO', 'L2 — Responsable achats', NULL, 'Responsable achats', 48);"
        + "INSERT INTO procurement_settings (tenant_id, require_pr_before_po) VALUES ('" + A + "', false)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET require_pr_before_po = false");
    PostgresFixture.grantRoles(DATABASE, AUTEUR, "admin", A, APPRO_1, "procurement_l1", A, APPRO_2, "procurement_l2", A);
  }

  private static String commande(String numero, int quantite, int prix) throws SQLException {
    String id = asUser(AUTEUR, "INSERT INTO purchase_orders (tenant_id, po_number, supplier_id, total, status, created_by)"
        + " VALUES (get_user_tenant_id(auth.uid()), '" + numero + "', '" + FOURNISSEUR + "', 0, 'draft', auth.uid()) RETURNING id::text");
    asUser(AUTEUR, "INSERT INTO po_lines (po_id, description, quantity, unit_cost) VALUES ('" + id + "', 'Article', "
        + quantite + ", " + prix + ") RETURNING id::text");
    return id;
  }

  private static String etape(String doc, int niveau) {
    return texte("SELECT id::text FROM procurement_approvals WHERE doc_id = '" + doc + "' AND level_order = " + niveau);
  }

  @Test
  @DisplayName("au-delà du seuil L1 : deux niveaux, dans l'ordre, par deux tiers ; l'auteur n'approuve pas, même admin")
  void deuxNiveauxSeparationDesTaches() throws SQLException {
    String bc = commande("BC-V39-1", 3, 500000);   // 1 500 000 > 1 000 000 : L1 puis L2

    assertThatThrownBy(() -> asUser(AUTEUR, "UPDATE purchase_orders SET status = 'approved' WHERE id = '" + bc + "' RETURNING id::text"))
        .as("plus d'approbation par simple mise à jour")
        .hasMessageContaining("change par soumission");

    assertThat(asUser(AUTEUR, "SELECT procurement_submit('PO', '" + bc + "')::text")).isEqualTo("2");
    assertThatThrownBy(() -> asUser(AUTEUR, "UPDATE po_lines SET quantity = 9 WHERE po_id = '" + bc + "' RETURNING id::text"))
        .hasMessageContaining("ne se modifient plus");

    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT approve_procurement_step('" + etape(bc, 1) + "', null)::text"))
        .hasMessageContaining("Séparation des tâches");
    assertThatThrownBy(() -> asUser(APPRO_2, "SELECT approve_procurement_step('" + etape(bc, 2) + "', null)::text"))
        .as("pas de niveau 2 avant le niveau 1")
        .hasMessageContaining("niveaux précédents");

    asUser(APPRO_1, "SELECT approve_procurement_step('" + etape(bc, 1) + "', 'ok L1')::text");
    assertThatThrownBy(() -> asUser(APPRO_1, "SELECT approve_procurement_step('" + etape(bc, 2) + "', null)::text"))
        .as("une même personne ne valide pas deux niveaux (et n'a pas le droit L2)")
        .hasMessageContaining("déjà approuvé un niveau");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + bc + "'")).isEqualTo("pending_approval");

    asUser(APPRO_2, "SELECT approve_procurement_step('" + etape(bc, 2) + "', 'ok L2')::text");
    assertThat(texte("SELECT status || ' ' || (approved_by = '" + APPRO_2 + "')::text FROM purchase_orders WHERE id = '" + bc + "'"))
        .isEqualTo("approved true");
  }

  @Test
  @DisplayName("rejet motivé → modifiable → resoumis ; annulation ; « demande obligatoire » appliquée")
  void rejetAnnulationEtParametre() throws SQLException {
    String bc = commande("BC-V39-2", 1, 200000);   // sous le seuil : un seul niveau
    asUser(AUTEUR, "SELECT procurement_submit('PO', '" + bc + "')::text");
    assertThatThrownBy(() -> asUser(APPRO_1, "SELECT reject_procurement_step('" + etape(bc, 1) + "', ' ')::text"))
        .hasMessageContaining("Motif");
    asUser(APPRO_1, "SELECT reject_procurement_step('" + etape(bc, 1) + "', 'Prix à renégocier')::text");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + bc + "'")).isEqualTo("rejected");

    asUser(AUTEUR, "UPDATE po_lines SET unit_cost = 180000 WHERE po_id = '" + bc + "' RETURNING id::text");
    assertThat(asUser(AUTEUR, "SELECT procurement_submit('PO', '" + bc + "')::text")).isEqualTo("1");
    asUser(AUTEUR, "SELECT procurement_cancel('PO', '" + bc + "', 'Besoin annulé')::text");
    assertThat(texte("SELECT status FROM purchase_orders WHERE id = '" + bc + "'")).isEqualTo("cancelled");

    owner("UPDATE procurement_settings SET require_pr_before_po = true WHERE tenant_id = '" + A + "'");
    String direct = commande("BC-V39-3", 1, 1000);
    assertThatThrownBy(() -> asUser(AUTEUR, "SELECT procurement_submit('PO', '" + direct + "')::text"))
        .hasMessageContaining("exige une demande d'achat");
    owner("UPDATE procurement_settings SET require_pr_before_po = false WHERE tenant_id = '" + A + "'");
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
