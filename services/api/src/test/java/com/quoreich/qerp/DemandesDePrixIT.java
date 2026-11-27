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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V139 — demandes de prix : reprise d'une demande d'achat approuvée, consultation, offres (dont une en devise),
 * comparatif au cours du jour, attribution refusée à l'auteur, sans motif hors moins-disant, sous le minimum d'offres ;
 * commandes brouillon par fournisseur retenu, demande d'achat convertie ; tables en lecture seule.
 */
@SpringBootTest
class DemandesDePrixIT {

  private static final String DATABASE = "qerp_it_demandes_prix";
  private static final String T = "33333333-3333-3333-3333-333333333139";
  private static final String U = "cccccccc-0000-0000-0000-000000000139";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    return PostgresFixture.textAsAdmin(DATABASE, sql);
  }

  /** Membre au nom duquel agit asUser (administrateur par défaut). */
  private static String who = U;
  private static final String U2 = "22222222-2222-2222-2222-222222222139";

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + who + "\",\"role\":\"authenticated\"}");
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


  private static final String F1 = "00000000-0000-0000-0000-0000000f1139";
  private static final String F2 = "00000000-0000-0000-0000-0000000f2139";
  private static final String PR = "00000000-0000-0000-0000-0000000d0139";

  @Test
  @DisplayName("consultation, offres, comparatif, attribution contrôlée, commandes créées")
  void demandeDePrix() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Acheteur V139') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "'), ('" + U2 + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Acheteur'), ('" + U2 + "', '" + T + "', 'Responsable achats') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F1 + "', '" + T + "', 'Fournisseur local'), ('" + F2 + "', '" + T + "', 'Fournisseur européen');"
        + "INSERT INTO purchase_requisitions (id, tenant_id, pr_number, description, status, requested_by) VALUES ('" + PR + "', '" + T + "', 'PR-139', 'Ordinateurs', 'approved', '" + U + "');"
        + "INSERT INTO requisition_lines (requisition_id, description, quantity, estimated_unit_cost) VALUES ('" + PR + "', 'Ordinateur portable', 10, 400000), ('" + PR + "', 'Écran', 10, 100000);"
        + "INSERT INTO exchange_rates (tenant_id, currency, base_currency, rate, rate_date, source) VALUES ('" + T + "', 'EUR', 'XOF', 655.957, CURRENT_DATE - 1, 'BCEAO')");
    PostgresFixture.grantRoles(DATABASE, U, "procurement_l1", T);
    PostgresFixture.grantRoles(DATABASE, U2, "admin", T);

    String rfq = asUser("SELECT create_rfq('Ordinateurs 2031', '" + PR + "', NULL, ARRAY['" + F1 + "', '" + F2 + "']::uuid[])::text");
    assertThat(asUser("SELECT rfq_number || ' ' || (SELECT count(*) FROM rfq_lines WHERE rfq_id = r.id) || ' ' || (SELECT count(*) FROM rfq_suppliers WHERE rfq_id = r.id) FROM rfqs r WHERE id = '" + rfq + "'"))
        .matches("DP-\\d{4}-0001 2 2");
    assertThatThrownBy(() -> asUser("SELECT create_rfq('Doublon', '" + PR + "')::text")).hasMessageContaining("déjà en consultation");
    assertThatThrownBy(() -> asUser("SELECT record_rfq_quote('" + rfq + "', '" + F1 + "', '[]'::jsonb)::text")).as("pas encore envoyée").hasMessageContaining("une fois la demande envoyée");
    asUser("SELECT rfq_send('" + rfq + "')::text");

    String l1 = texte("SELECT id::text FROM rfq_lines WHERE rfq_id = '" + rfq + "' AND description = 'Ordinateur portable'");
    String l2 = texte("SELECT id::text FROM rfq_lines WHERE rfq_id = '" + rfq + "' AND description = 'Écran'");
    // Local : 390 000 et 95 000 XOF ; européen : 580 EUR (380 455 XOF, moins-disant) et 150 EUR (98 393 XOF).
    asUser("SELECT record_rfq_quote('" + rfq + "', '" + F1 + "', '[{\"line_id\": \"" + l1 + "\", \"unit_price\": 390000, \"lead_time_days\": 3},"
        + " {\"line_id\": \"" + l2 + "\", \"unit_price\": 95000, \"lead_time_days\": 3}]'::jsonb)::text");
    asUser("SELECT record_rfq_quote('" + rfq + "', '" + F2 + "', '[{\"line_id\": \"" + l1 + "\", \"unit_price\": 580, \"lead_time_days\": 30},"
        + " {\"line_id\": \"" + l2 + "\", \"unit_price\": 150, \"lead_time_days\": 30}]'::jsonb, 'EUR', NULL, 60, 'CIF')::text");
    // Lignes désignées par leur identifiant, pas par leur numéro : create_rfq numérote dans un ordre non garanti
    // (requisition_lines n'a pas de position ; défaut suivi au backlog). Le test porte sur le classement des prix.
    assertThat(asUser("SELECT string_agg(supplier_name || ':' || price_rank, ' ' ORDER BY price_rank) FROM rfq_comparison WHERE rfq_line_id = '" + l1 + "'"))
        .as("ordinateur : 580 EUR = 380 455 XOF, moins-disant").isEqualTo("Fournisseur européen:1 Fournisseur local:2");
    assertThat(asUser("SELECT string_agg(supplier_name || ':' || price_rank, ' ' ORDER BY price_rank) FROM rfq_comparison WHERE rfq_line_id = '" + l2 + "'"))
        .as("écran : 95 000 XOF contre 150 EUR = 98 393 XOF").isEqualTo("Fournisseur local:1 Fournisseur européen:2");

    String awards = "'[{\"line_id\": \"" + l1 + "\", \"supplier_id\": \"" + F1 + "\"}, {\"line_id\": \"" + l2 + "\", \"supplier_id\": \"" + F1 + "\"}]'::jsonb";
    assertThatThrownBy(() -> asUser("SELECT award_rfq('" + rfq + "', " + awards + ")::text")).as("l'auteur n'attribue pas").hasMessageContaining("Droit insuffisant");
    who = U2;
    assertThatThrownBy(() -> asUser("SELECT award_rfq('" + rfq + "', " + awards + ")::text")).as("hors moins-disant sans motif").hasMessageContaining("rfq_awards_check");
    owner("INSERT INTO rfq_settings (tenant_id, min_quotes) VALUES ('" + T + "', 3)");
    String motive = "'[{\"line_id\": \"" + l1 + "\", \"supplier_id\": \"" + F1 + "\", \"reason\": \"Délai 3 jours contre 30\"}, {\"line_id\": \"" + l2 + "\", \"supplier_id\": \"" + F1 + "\"}]'::jsonb";
    assertThatThrownBy(() -> asUser("SELECT award_rfq('" + rfq + "', " + motive + ")::text")).hasMessageContaining("en exige 3");
    owner("UPDATE rfq_settings SET min_quotes = 2 WHERE tenant_id = '" + T + "'");
    assertThat(asUser("SELECT award_rfq('" + rfq + "', " + motive + ")::text")).contains("purchase_orders");
    assertThat(texte("SELECT string_agg(l.description || ':' || pl.quantity::int || ':' || pl.unit_cost::int, ' ' ORDER BY pl.unit_cost DESC) FROM rfq_awards a JOIN rfq_lines l ON l.id = a.rfq_line_id"
        + " JOIN po_lines pl ON pl.po_id = a.po_id AND pl.requisition_line_id = l.requisition_line_id WHERE a.rfq_id = '" + rfq + "'"))
        .isEqualTo("Ordinateur portable:10:390000 Écran:10:95000");
    assertThat(texte("SELECT string_agg(cheapest::text || ':' || COALESCE(reason, '-'), ' ' ORDER BY awarded_at, rfq_line_id) FROM rfq_awards WHERE rfq_id = '" + rfq + "'"))
        .contains("false:Délai 3 jours contre 30").contains("true:-");
    assertThat(texte("SELECT status || ' ' || (po_id IS NOT NULL) FROM purchase_requisitions WHERE id = '" + PR + "'")).isEqualTo("converted true");
    assertThat(texte("SELECT status FROM rfqs WHERE id = '" + rfq + "'")).isEqualTo("awarded");

    // Demande libre annulée avec motif ; tables en lecture seule.
    String libre = asUser("SELECT create_rfq('Fournitures', NULL, '[{\"description\": \"Papier\", \"quantity\": 50}]'::jsonb, ARRAY['" + F1 + "']::uuid[])::text");
    assertThatThrownBy(() -> asUser("SELECT rfq_cancel('" + libre + "', ' ')::text")).hasMessageContaining("motif");
    asUser("SELECT rfq_cancel('" + libre + "', 'Besoin annulé')::text");
    assertThatThrownBy(() -> asUser("UPDATE rfqs SET status = 'draft' WHERE id = '" + libre + "' RETURNING id::text")).hasMessageContaining("permission denied");
  }
}
