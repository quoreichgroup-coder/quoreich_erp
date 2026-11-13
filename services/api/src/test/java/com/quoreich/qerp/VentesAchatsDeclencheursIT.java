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
 * V29 et V30 : trois chemins des ventes et des achats qui échouaient à chaque appel.
 *
 * <ul>
 *   <li>Devis, commande client, bon de livraison : {@code enforce_sales_period_lock} refusait
 *       toute écriture (« record "new" has no field ... »). Le verrouillage de période, lui, doit
 *       continuer de refuser une période close.
 *   <li>Soumission à approbation d'une demande d'achat ou d'une commande fournisseur :
 *       {@code seed_procurement_approval_queue} échouait de même.
 *   <li>Conversion d'une opportunité en devis : le droit est {@code crm.convert} du catalogue —
 *       accordé à admin, que l'ancien contrôle par user_roles refusait.
 * </ul>
 */
@SpringBootTest
class VentesAchatsDeclencheursIT {

  private static final String DATABASE = "qerp_it_ventes_achats";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String SANS_DROIT = "aaaaaaaa-0000-0000-0000-0000000000d1";
  private static final String CLIENT = "c0000001-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO user_roles (user_id, role, tenant_id) SELECT '" + ADMIN + "', 'admin', '" + A + "'"
        + " WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = '" + ADMIN + "' AND role = 'admin');"
        + "INSERT INTO auth.users (id) VALUES ('" + SANS_DROIT + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + SANS_DROIT + "', '" + A + "', 'Sans droit CRM')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "DELETE FROM period_locks WHERE tenant_id = '" + A + "' AND module = 'Sales'");
  }

  @Test
  @DisplayName("devis, commande client et bon de livraison s'enregistrent ; une période de ventes close reste refusée")
  void documentsDeVente() {
    owner("INSERT INTO quotations (id, tenant_id, quote_number, customer_id, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000a001', '" + A + "', 'DEV-IT-1', '" + CLIENT + "', '" + ADMIN + "');"
        + "UPDATE quotations SET status = 'sent' WHERE id = '00000000-0000-0000-0000-00000000a001';"
        + "INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, created_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000a002', '" + A + "', 'CDE-IT-1', '" + CLIENT + "', '" + ADMIN + "');"
        + "INSERT INTO delivery_notes (tenant_id, dn_number, so_id, customer_id, created_by) VALUES"
        + " ('" + A + "', 'BL-IT-1', '00000000-0000-0000-0000-00000000a002', '" + CLIENT + "', '" + ADMIN + "')");
    assertThat(count("SELECT count(*) FROM quotations WHERE quote_number = 'DEV-IT-1' AND status = 'sent'")).isEqualTo(1);
    assertThat(count("SELECT count(*) FROM sales_orders WHERE so_number = 'CDE-IT-1'")).isEqualTo(1);
    assertThat(count("SELECT count(*) FROM delivery_notes WHERE dn_number = 'BL-IT-1'")).isEqualTo(1);

    owner("INSERT INTO period_locks (tenant_id, module, period, status) VALUES ('" + A + "', 'Sales',"
        + " to_char(CURRENT_DATE, 'YYYY-MM'), 'closed')");
    assertThatThrownBy(() -> owner("INSERT INTO sales_orders (tenant_id, so_number, customer_id, created_by) VALUES"
            + " ('" + A + "', 'CDE-IT-VERROU', '" + CLIENT + "', '" + ADMIN + "')"))
        .hasMessageContaining("is closed");
    owner("DELETE FROM period_locks WHERE tenant_id = '" + A + "' AND module = 'Sales'");
  }

  @Test
  @DisplayName("une demande d'achat et une commande fournisseur se soumettent à approbation")
  void soumissionAApprobation() {
    owner("INSERT INTO purchase_requisitions (id, tenant_id, pr_number, estimated_total, requested_by) VALUES"
        + " ('00000000-0000-0000-0000-00000000b001', '" + A + "', 'DA-IT-1', 150000, '" + ADMIN + "');"
        + "UPDATE purchase_requisitions SET status = 'pending_approval' WHERE id = '00000000-0000-0000-0000-00000000b001';"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000f001', '" + A + "',"
        + " 'Fournisseur IT') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO purchase_orders (id, tenant_id, po_number, total, created_by, supplier_id) VALUES"
        + " ('00000000-0000-0000-0000-00000000b002', '" + A + "', 'BC-IT-1', 250000, '" + ADMIN + "',"
        + " '00000000-0000-0000-0000-00000000f001');"
        + "UPDATE purchase_orders SET status = 'pending_approval' WHERE id = '00000000-0000-0000-0000-00000000b002'");
    assertThat(count("SELECT count(*) FROM purchase_requisitions WHERE pr_number = 'DA-IT-1' AND status = 'pending_approval'"))
        .isEqualTo(1);
    assertThat(count("SELECT count(*) FROM purchase_orders WHERE po_number = 'BC-IT-1' AND status = 'pending_approval'"))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("conversion d'une opportunité : l'administrateur (droit crm.convert) convertit, un membre sans ce droit est refusé")
  void conversionOpportunite() throws Exception {
    owner("INSERT INTO crm_opportunities (id, tenant_id, name, stage, amount, customer_id) VALUES"
        + " ('00000000-0000-0000-0000-00000000c001', '" + A + "', 'Opportunité gagnée', 'won', 500000, '" + CLIENT + "')"
        + " ON CONFLICT (id) DO NOTHING");
    assertThat(count("SELECT count(*) FROM user_roles WHERE user_id = '" + ADMIN + "' AND role::text LIKE 'crm_%'"))
        .as("l'administrateur n'a aucun rôle CRM : c'est le cas que l'ancien contrôle refusait")
        .isZero();

    assertThatThrownBy(() -> asUser(SANS_DROIT,
            "SELECT convert_opportunity_to_quote('00000000-0000-0000-0000-00000000c001')::text"))
        .hasMessageContaining("insufficient_role");

    String devis = asUser(ADMIN, "SELECT convert_opportunity_to_quote('00000000-0000-0000-0000-00000000c001')::text");
    assertThat(count("SELECT count(*) FROM quotations WHERE id = '" + devis + "' AND total = 500000")).isEqualTo(1);
    assertThat(asUser(ADMIN, "SELECT convert_opportunity_to_quote('00000000-0000-0000-0000-00000000c001')::text"))
        .as("idempotent : un second appel rend le même devis")
        .isEqualTo(devis);
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
        String result = rs.next() ? rs.getString(1) : null;
        c.commit();
        return result;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static long count(String sql) {
    return PostgresFixture.countAsAdmin(DATABASE, sql);
  }
}
