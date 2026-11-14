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
 * V43 — pièces commerciales complètes : remise et code TVA par ligne de devis, de commande et de
 * livraison, totaux HT / TVA / TTC calculés par la base, repris jusqu'à la facture brouillon ; devis
 * expiré non convertible ; limite de crédit bloquante, levée par un utilisateur habilité avec motif.
 */
@SpringBootTest
class VentesPiecesCompletesIT {

  private static final String DATABASE = "qerp_it_ventes_pieces";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String CONTROLEUR = "aaaaaaaa-0000-0000-0000-0000000004c3";
  private static final String CLIENT = "c0000002-0000-0000-0000-000000000000";
  private static final String TVA18 = "00000000-0000-0000-0000-0000000a4318";
  private static final String TVA_BETA = "00000000-0000-0000-0000-0000000b4318";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.applySyscohada(DATABASE, A);
    owner("INSERT INTO auth.users (id) VALUES ('" + CONTROLEUR + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + CONTROLEUR + "', '" + A + "', 'Contrôleur ventes')"
        + " ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO tax_codes (id, tenant_id, code, name, rate) VALUES ('" + TVA18 + "', '" + A
        + "', 'TVA18_V43', 'TVA 18 %', 18) ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO tax_codes (id, tenant_id, code, name, rate) VALUES ('" + TVA_BETA + "', '"
        + PostgresFixture.BETA_TENANT + "', 'TVA18_B43', 'TVA 18 % Beta', 18) ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO sales_settings (tenant_id, auto_invoice_on_delivery) VALUES ('" + A + "', true)"
        + " ON CONFLICT (tenant_id) DO UPDATE SET auto_invoice_on_delivery = true;"
        + "UPDATE customers SET credit_limit = NULL WHERE id = '" + CLIENT + "'");
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A, CONTROLEUR, "sales_controller", A);
  }

  private static final String LIGNES =
      "'[{\"description\":\"Conseil\",\"quantity\":2,\"unit_price\":50000,\"discount_pct\":10,\"tax_code_id\":\""
          + TVA18 + "\"},{\"description\":\"Frais\",\"quantity\":1,\"unit_price\":20000}]'";

  private static String devis(String validite) throws SQLException {
    return asUser(ADMIN, "SELECT create_sales_quotation('" + CLIENT + "', CURRENT_DATE, " + validite + ", " + LIGNES
        + "::jsonb)::text");
  }

  @Test
  @DisplayName("devis → commande → livraison → facture brouillon : remise et TVA par ligne, HT / TVA / TTC calculés")
  void remiseEtTvaJusquALaFacture() throws SQLException {
    String devis = devis("CURRENT_DATE + 30");
    assertThat(texte("SELECT total::text || ' ' || tax_amount::text || ' ' || total_ttc::text FROM quotations WHERE id = '"
            + devis + "'"))
        .as("2 × 50 000 − 10 % = 90 000 (TVA 16 200) + 20 000 sans TVA")
        .isEqualTo("110000.00 16200.00 126200.00");

    String commande = asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text");
    assertThat(texte("SELECT total_ttc::text FROM sales_orders WHERE id = '" + commande + "'")).isEqualTo("126200.00");
    asUser(ADMIN, "SELECT confirm_so('" + commande + "')::text");
    asUser(ADMIN, "SELECT post_delivery('" + commande + "', (SELECT jsonb_agg(jsonb_build_object('so_line_id', id,"
        + " 'quantity', quantity)) FROM so_lines WHERE so_id = '" + commande + "'))::text");

    assertThat(texte("SELECT status || ' ' || subtotal::text || ' ' || tax_amount::text || ' ' || total::text"
            + " FROM ar_invoices WHERE so_id = '" + commande + "'"))
        .as("la facture préparée depuis la livraison arrive avec sa TVA")
        .isEqualTo("draft 110000.00 16200.00 126200.00");
  }

  @Test
  @DisplayName("contrôles des lignes : remise hors bornes, code TVA d'une autre société refusés")
  void controlesDesLignes() {
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT create_sales_order('" + CLIENT + "', CURRENT_DATE,"
            + " '[{\"description\":\"X\",\"quantity\":1,\"unit_price\":10,\"discount_pct\":120}]'::jsonb)::text"))
        .hasMessageContaining("remise");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT create_sales_order('" + CLIENT + "', CURRENT_DATE,"
            + " '[{\"description\":\"X\",\"quantity\":1,\"unit_price\":10,\"tax_code_id\":\"" + TVA_BETA + "\"}]'::jsonb)::text"))
        .hasMessageContaining("Code TVA inconnu");
  }

  @Test
  @DisplayName("un devis expiré ne se convertit pas")
  void devisExpire() throws SQLException {
    String devis = devis("CURRENT_DATE + 30");
    owner("UPDATE quotations SET quote_date = CURRENT_DATE - 40, valid_until = CURRENT_DATE - 1 WHERE id = '" + devis + "'");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text"))
        .hasMessageContaining("expiré");
  }

  @Test
  @DisplayName("limite de crédit : refus sans motif, refus sans droit, levée motivée et tracée ; une seule confirmation")
  void limiteDeCredit() throws SQLException {
    owner("UPDATE customers SET credit_limit = 100000 WHERE id = '" + CLIENT + "'");
    String commande = asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis("CURRENT_DATE + 30") + "')::text");

    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_so('" + commande + "')::text"))
        .hasMessageContaining("Limite de crédit dépassée");
    assertThatThrownBy(() -> asUser(CONTROLEUR, "SELECT confirm_so('" + commande + "', 'Client historique')::text"))
        .hasMessageContaining("Droit insuffisant");
    asUser(ADMIN, "SELECT confirm_so('" + commande + "', 'Client historique, garantie bancaire')::text");
    assertThat(texte("SELECT status || ' | ' || credit_override_reason || ' | ' || (credit_override_by = '" + ADMIN
            + "')::text FROM sales_orders WHERE id = '" + commande + "'"))
        .isEqualTo("confirmed | Client historique, garantie bancaire | true");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_so('" + commande + "')::text"))
        .hasMessageContaining("brouillon");

    owner("UPDATE customers SET credit_limit = 1000000 WHERE id = '" + CLIENT + "'");
    String dansLaLimite = asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis("CURRENT_DATE + 30") + "')::text");
    asUser(CONTROLEUR, "SELECT confirm_so('" + dansLaLimite + "')::text");
    assertThat(texte("SELECT status FROM sales_orders WHERE id = '" + dansLaLimite + "'")).isEqualTo("confirmed");
  }

  @Test
  @DisplayName("V44 — commande depuis les lignes choisies d'un devis : reste à commander, devis partiellement puis totalement transformé")
  void commandeDepuisLignesDuDevis() throws SQLException {
    String devis = devis("CURRENT_DATE + 30");
    String conseil = texte("SELECT id::text FROM quote_lines WHERE quotation_id = '" + devis + "' AND description = 'Conseil'");
    String frais = texte("SELECT id::text FROM quote_lines WHERE quotation_id = '" + devis + "' AND description = 'Frais'");

    String premiere = asUser(ADMIN, "SELECT create_sales_order_from_quote('" + devis + "', '[{\"quote_line_id\":\"" + conseil
        + "\",\"quantity\":1}]'::jsonb)::text");
    assertThat(texte("SELECT o.total::text || ' ' || o.tax_amount::text || ' ' || q.status FROM sales_orders o"
            + " JOIN quotations q ON q.id = o.quotation_id WHERE o.id = '" + premiere + "'"))
        .as("1 × 50 000 − 10 % = 45 000, TVA 8 100 ; devis partiellement transformé")
        .isEqualTo("45000.00 8100.00 partially_converted");
    assertThat(texte("SELECT (quote_line_id = '" + conseil + "')::text FROM so_lines WHERE so_id = '" + premiere + "'"))
        .isEqualTo("true");

    assertThatThrownBy(() -> asUser(ADMIN, "SELECT create_sales_order_from_quote('" + devis + "', '[{\"quote_line_id\":\""
            + conseil + "\",\"quantity\":2}]'::jsonb)::text"))
        .as("reste à commander : 1")
        .hasMessageContaining("reste à commander");
    String autreDevis = devis("CURRENT_DATE + 30");
    String ligneAutre = texte("SELECT id::text FROM quote_lines WHERE quotation_id = '" + autreDevis + "' LIMIT 1");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT create_sales_order_from_quote('" + devis + "', '[{\"quote_line_id\":\""
            + ligneAutre + "\",\"quantity\":1}]'::jsonb)::text"))
        .hasMessageContaining("ne fait pas partie de ce devis");

    String solde = asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text");
    assertThat(texte("SELECT string_agg(description || ':' || quantity::text, ' ' ORDER BY description) FROM so_lines"
            + " WHERE so_id = '" + solde + "'"))
        .as("la conversion complète ne reprend que le reste")
        .isEqualTo("Conseil:1 Frais:1");
    assertThat(texte("SELECT status FROM quotations WHERE id = '" + devis + "'")).isEqualTo("converted");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT confirm_quote_to_so('" + devis + "')::text"))
        .hasMessageContaining("plus de ligne à commander");
  }

  @Test
  @DisplayName("V46 — devis et commande modifiables et supprimables tant qu'ils ne sont pas engagés")
  void modificationDesPieces() throws SQLException {
    String devis = devis("CURRENT_DATE + 30");
    asUser(ADMIN, "SELECT update_sales_quotation('" + devis + "', '" + CLIENT + "', CURRENT_DATE, CURRENT_DATE + 15,"
        + " '[{\"description\":\"Conseil révisé\",\"quantity\":3,\"unit_price\":40000}]'::jsonb)::text");
    assertThat(texte("SELECT total::text || ' ' || (valid_until - quote_date)::text || ' '"
            + " || (SELECT string_agg(description, ',') FROM quote_lines WHERE quotation_id = q.id) FROM quotations q WHERE id = '" + devis + "'"))
        .isEqualTo("120000.00 15 Conseil révisé");

    // Commande reprise du devis : le devis ne se modifie plus ; supprimer la commande le libère.
    String ligne = texte("SELECT id::text FROM quote_lines WHERE quotation_id = '" + devis + "'");
    String commande = asUser(ADMIN, "SELECT create_sales_order_from_quote('" + devis + "', '[{\"quote_line_id\":\"" + ligne
        + "\",\"quantity\":1}]'::jsonb)::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT update_sales_quotation('" + devis + "', '" + CLIENT
            + "', CURRENT_DATE, CURRENT_DATE + 15, '[{\"description\":\"X\",\"quantity\":1,\"unit_price\":1}]'::jsonb)::text"))
        .hasMessageContaining("ne se modifie plus");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT delete_sales_quotation('" + devis + "')::text"))
        .hasMessageContaining("ne se supprime pas");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT update_sales_order('" + commande + "', CURRENT_DATE,"
            + " '[{\"description\":\"X\",\"quantity\":1,\"unit_price\":1}]'::jsonb)::text"))
        .hasMessageContaining("reprise du devis");
    asUser(ADMIN, "SELECT delete_sales_order('" + commande + "')::text");
    assertThat(texte("SELECT q.status || ' ' || ql.quantity_ordered::text FROM quotations q JOIN quote_lines ql"
            + " ON ql.quotation_id = q.id WHERE q.id = '" + devis + "'"))
        .isEqualTo("sent 0");
    asUser(ADMIN, "SELECT delete_sales_quotation('" + devis + "')::text");
    assertThat(texte("SELECT count(*)::text FROM quotations WHERE id = '" + devis + "'")).isEqualTo("0");

    // Commande libre : modifiable en brouillon, figée une fois confirmée.
    String libre = asUser(ADMIN, "SELECT create_sales_order('" + CLIENT + "', CURRENT_DATE,"
        + " '[{\"description\":\"Libre\",\"quantity\":1,\"unit_price\":1000}]'::jsonb)::text");
    asUser(ADMIN, "SELECT update_sales_order('" + libre + "', CURRENT_DATE, '[{\"description\":\"Libre\",\"quantity\":2,"
        + "\"unit_price\":1000,\"discount_pct\":50}]'::jsonb)::text");
    assertThat(texte("SELECT total::text FROM sales_orders WHERE id = '" + libre + "'")).isEqualTo("1000.00");
    asUser(ADMIN, "SELECT confirm_so('" + libre + "')::text");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT delete_sales_order('" + libre + "')::text"))
        .hasMessageContaining("brouillon");
  }

  @Test
  @DisplayName("V47 — identité légale de la société : l'administrateur seul la renseigne")
  void identiteLegale() throws SQLException {
    assertThatThrownBy(() -> asUser(CONTROLEUR, "SELECT set_company_identity('{\"rccm\":\"BF-OUA-01\"}'::jsonb)::text"))
        .hasMessageContaining("Droit insuffisant");
    assertThatThrownBy(() -> asUser(ADMIN, "SELECT set_company_identity('{\"email\":\"pas-une-adresse\"}'::jsonb)::text"))
        .hasMessageContaining("invalide");
    asUser(ADMIN, "SELECT set_company_identity('{\"legal_name\":\"Alpha SA\",\"rccm\":\"BF-OUA-2026-B-0001\","
        + "\"tax_id\":\"00012345X\",\"tax_regime\":\"RNI\",\"tax_office\":\"DME Centre\"}'::jsonb)::text");
    assertThat(texte("SELECT legal_name || ' ' || rccm || ' ' || tax_id || ' ' || tax_regime || ' ' || tax_office"
            + " FROM tenants WHERE id = '" + A + "'"))
        .isEqualTo("Alpha SA BF-OUA-2026-B-0001 00012345X RNI DME Centre");
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
