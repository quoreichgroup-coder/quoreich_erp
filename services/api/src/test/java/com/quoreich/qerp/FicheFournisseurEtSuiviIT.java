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
 * V56 — fiche fournisseur (droits d'écriture), double contrôle des coordonnées bancaires (virement
 * refusé tant qu'une autre personne ne les a pas validées), dates prévues, accusé de réception,
 * replanification motivée et suivi des retards.
 */
@SpringBootTest
class FicheFournisseurEtSuiviIT {

  private static final String DATABASE = "qerp_it_fournisseurs_suivi";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String LECTEUR = "aaaaaaaa-0000-0000-0000-0000000005d6";
  private static final String COMPTABLE = "aaaaaaaa-0000-0000-0000-0000000005d7";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + LECTEUR + "'), ('" + COMPTABLE + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + LECTEUR + "', '" + A + "', 'Lecteur'), ('" + COMPTABLE + "', '"
        + A + "', 'Comptable') ON CONFLICT (id) DO NOTHING");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, LECTEUR, "viewer", A, COMPTABLE, "accountant", A);
  }

  private static String fournisseur(String user, String extra) throws SQLException {
    return asUser(user, "INSERT INTO suppliers (tenant_id, name, lead_time_days, default_incoterm" + (extra.isEmpty() ? "" : ", bank_account")
        + ") VALUES ('" + A + "', 'Fournisseur V56 " + UUID.randomUUID().toString().substring(0, 6) + "', 10, 'FOB'"
        + (extra.isEmpty() ? "" : ", '" + extra + "'") + ") RETURNING id::text");
  }

  @Test
  @DisplayName("fiche : lecteur refusé ; RIB à valider par une autre personne ; virement refusé avant validation ; journal des changements")
  void doubleControleBancaire() throws SQLException {
    assertThatThrownBy(() -> fournisseur(LECTEUR, "")).hasMessageContaining("row-level security");
    String f = fournisseur(ADMIN, "BF0001 00000 12345678901 23");
    assertThat(texte("SELECT bank_verified::text || ' ' || (bank_changed_by = '" + ADMIN + "')::text FROM suppliers WHERE id = '" + f + "'"))
        .isEqualTo("false true");
    assertThatThrownBy(() -> asUser(ADMIN, "UPDATE suppliers SET bank_verified = true WHERE id = '" + f + "' RETURNING id::text"))
        .hasMessageContaining("Valider les coordonnées bancaires");

    String facture = UUID.randomUUID().toString();
    owner("INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, status,"
        + " approval_status, created_by) VALUES ('" + facture + "', '" + A + "', 'FF-V56-" + facture.substring(0, 5) + "', '" + f
        + "', CURRENT_DATE, CURRENT_DATE + 30, 10000, 0, 'draft', 'pending', '" + ADMIN + "');"
        + "UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + facture + "'");
    String virement = "INSERT INTO payments (tenant_id, payment_type, ap_invoice_id, amount, payment_date, payment_method, created_by)"
        + " VALUES ('" + A + "', 'ap_payment', '" + facture + "', 1000, CURRENT_DATE, 'bank_transfer', '" + ADMIN + "')";
    assertThatThrownBy(() -> owner(virement)).hasStackTraceContaining("Paiement refusé");

    assertThatThrownBy(() -> asUser(ADMIN, "SELECT verify_supplier_bank_details('" + f + "')::text"))
        .as("l'auteur du changement ne valide pas").hasMessageContaining("autre personne");
    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT verify_supplier_bank_details('" + f + "')::text")).hasMessageContaining("Droit insuffisant");
    asUser(COMPTABLE, "SELECT verify_supplier_bank_details('" + f + "')::text");
    owner(virement);
    assertThat(texte("SELECT amount_paid::text FROM ap_invoices WHERE id = '" + facture + "'")).isEqualTo("1000.00");

    asUser(ADMIN, "UPDATE suppliers SET bank_account = 'BF0009 99999 99999999999 99' WHERE id = '" + f + "' RETURNING id::text");
    assertThat(texte("SELECT bank_verified::text FROM suppliers WHERE id = '" + f + "'")).as("nouveau RIB : à revalider").isEqualTo("false");
    assertThatThrownBy(() -> owner(virement)).hasStackTraceContaining("Paiement refusé");
    assertThat(texte("SELECT string_agg(field, ',' ORDER BY id) FROM supplier_change_log WHERE supplier_id = '" + f + "'"))
        .isEqualTo("bank_verified,bank_account,bank_verified");
  }

  @Test
  @DisplayName("commande : date prévue = commande + délai, Incoterm du fournisseur ; accusé de réception, replanification motivée, retard")
  void suiviDesCommandes() throws SQLException {
    String f = fournisseur(ADMIN, "");
    String po = UUID.randomUUID().toString();
    owner("INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, status, created_by) VALUES ('" + po + "', '" + A
        + "', 'PO-V56-" + po.substring(0, 5) + "', '" + f + "', CURRENT_DATE - 20, 'approved', '" + ADMIN + "');"
        + "INSERT INTO po_lines (po_id, description, quantity, unit_cost) VALUES ('" + po + "', 'Ligne', 4, 2500)");
    assertThat(texte("SELECT (expected_date = CURRENT_DATE - 10)::text || ' ' || incoterm FROM purchase_orders WHERE id = '" + po + "'"))
        .isEqualTo("true FOB");
    assertThat(texte("SELECT followup_state || ' ' || days_late || ' ' || value_remaining FROM purchase_order_followup_view WHERE po_id = '" + po + "'"))
        .as("prévue il y a 10 jours, rien reçu").isEqualTo("late 10 10000.00");

    assertThatThrownBy(() -> asUser(LECTEUR, "SELECT acknowledge_purchase_order('" + po + "', 'AR-1', CURRENT_DATE)::text"))
        .hasMessageContaining("Droit insuffisant");
    asUser(ADMIN, "SELECT acknowledge_purchase_order('" + po + "', 'AR-FRN-77', CURRENT_DATE + 5)::text");
    assertThat(texte("SELECT status || ' ' || supplier_reference FROM purchase_orders WHERE id = '" + po + "'")).isEqualTo("ordered AR-FRN-77");
    assertThat(texte("SELECT followup_state || ' ' || days_late FROM purchase_order_followup_view WHERE po_id = '" + po + "'")).isEqualTo("on_time 0");

    assertThatThrownBy(() -> asUser(ADMIN, "SELECT reschedule_purchase_order('" + po + "', CURRENT_DATE - 3, ' ')::text")).hasMessageContaining("Motif");
    asUser(ADMIN, "SELECT reschedule_purchase_order('" + po + "', CURRENT_DATE - 3, 'Retard transporteur')::text");
    assertThat(texte("SELECT followup_state || ' ' || days_late FROM purchase_order_followup_view WHERE po_id = '" + po + "'")).isEqualTo("late 3");
    assertThat(texte("SELECT string_agg(event || ':' || COALESCE(reason, supplier_reference), ',' ORDER BY id) FROM purchase_order_followup_log WHERE po_id = '" + po + "'"))
        .isEqualTo("acknowledged:AR-FRN-77,rescheduled:Retard transporteur");
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
