package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class NumerotationVentesIT {

  private static final String DATABASE = "qerp_it_numerotation_ventes";
  private static final String TENANT = PostgresFixture.ALPHA_TENANT;
  private static final String CUSTOMER = "c0000001-0000-0000-0000-000000000000";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "admin", TENANT);
    // La facture issue de la livraison se comptabilise : la société a son plan comptable.
    PostgresFixture.applySyscohada(DATABASE, TENANT);
    // Séries de la société : créées ici (la société du jeu de données naît après V40).
    owner("INSERT INTO sales_numbering_series (tenant_id, doc_type, prefix, format, next_number) VALUES"
        + " ('" + TENANT + "', 'quotation', 'DEV', 'PREFIX-YYYY-####', 31),"
        + " ('" + TENANT + "', 'sales_order', 'CMD', 'PREFIX-YYYY-####', 31),"
        + " ('" + TENANT + "', 'delivery_note', 'BL', 'PREFIX-YYYY-####', 31)"
        + " ON CONFLICT (tenant_id, doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, format = EXCLUDED.format,"
        + " next_number = EXCLUDED.next_number");
  }

  @Test
  void seriesConfigurablesUniqContinu() throws Exception {
    String orderId = UUID.randomUUID().toString();
    owner("INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, total, created_by)"
        + " VALUES ('" + orderId + "', '" + TENANT + "', 'SO-MANUEL', '" + CUSTOMER
        + "', '2030-03-01', 100, '" + PostgresFixture.ALPHA_USER + "')");
    assertThat(rows("SELECT so_number FROM sales_orders WHERE id = '" + orderId + "'"))
        .containsExactly("CMD-2030-0031");

    String quoteId = UUID.randomUUID().toString();
    owner("INSERT INTO quotations (id, tenant_id, quote_number, customer_id, quote_date, total, created_by)"
        + " VALUES ('" + quoteId + "', '" + TENANT + "', 'QT-MANUEL', '" + CUSTOMER
        + "', '2030-03-01', 100, '" + PostgresFixture.ALPHA_USER + "')");
    assertThat(rows("SELECT quote_number FROM quotations WHERE id = '" + quoteId + "'"))
        .containsExactly("DEV-2030-0031");

    String deliveryId = UUID.randomUUID().toString();
    owner("INSERT INTO delivery_notes (id, tenant_id, dn_number, so_id, customer_id, delivery_date, created_by)"
        + " VALUES ('" + deliveryId + "', '" + TENANT + "', 'DN-MANUEL', '" + orderId
        + "', '" + CUSTOMER + "', '2030-03-02', '" + PostgresFixture.ALPHA_USER + "')");
    assertThat(rows("SELECT dn_number FROM delivery_notes WHERE id = '" + deliveryId + "'"))
        .containsExactly("BL-2030-0031");

    String secondOrderId = UUID.randomUUID().toString();
    owner("INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, total, created_by)"
        + " VALUES ('" + secondOrderId + "', '" + TENANT + "', 'SO-DOUBLON', '" + CUSTOMER
        + "', '2030-03-02', 100, '" + PostgresFixture.ALPHA_USER + "')");
    assertThat(rows("SELECT so_number FROM sales_orders WHERE id = '" + secondOrderId + "'"))
        .containsExactly("CMD-2030-0032");
  }

  @Test
  void unUtilisateurNEcritPasDirectementLesPiecesDeVente() {
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> asUser("INSERT INTO sales_orders (tenant_id, so_number,"
            + " customer_id, order_date, total, created_by) VALUES (get_user_tenant_id(auth.uid()), 'X', '" + CUSTOMER
            + "', CURRENT_DATE, 1, auth.uid())"))
        .as("devis, commandes et livraisons passent par les fonctions contrôlées (V40)")
        .hasMessageContaining("permission denied");
  }

  @Test
  void confirmerUneCommandeSansArticleNeCreePasDeMouvementDeStockFictif() throws Exception {
    String orderId = UUID.randomUUID().toString();
    owner("INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, total, created_by)"
        + " VALUES ('" + orderId + "', '" + TENANT + "', 'SO-SERVICE', '" + CUSTOMER
        + "', CURRENT_DATE, 100, '" + PostgresFixture.ALPHA_USER + "');"
        // V43 : une commande sans ligne ne se confirme pas ; ligne de prestation, sans article.
        + "INSERT INTO so_lines (so_id, description, quantity, unit_price) VALUES ('" + orderId + "', 'Prestation', 1, 100)");
    asUser("SELECT public.confirm_so('" + orderId + "')");

    assertThat(rows("SELECT status FROM sales_orders WHERE id = '" + orderId + "'"))
        .containsExactly("confirmed");
    assertThat(rows("SELECT id FROM stock_movements WHERE reference_type = 'sales_order' AND reference_id = '"
        + orderId + "'"))
        .isEmpty();
  }

  @Test
  void livraisonDeServiceDeclencheLaFactureApresLesLignes() throws Exception {
    owner("UPDATE sales_settings SET auto_invoice_on_delivery = true WHERE tenant_id = '" + TENANT + "'");
    String orderId = UUID.randomUUID().toString();
    String lineId = UUID.randomUUID().toString();
    owner("INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, total, status, created_by)"
        + " VALUES ('" + orderId + "', '" + TENANT + "', 'SO-SERVICE-DN', '" + CUSTOMER
        + "', CURRENT_DATE, 100, 'confirmed', '" + PostgresFixture.ALPHA_USER + "')");
    owner("INSERT INTO so_lines (id, so_id, description, quantity, unit_price) VALUES ('" + lineId + "', '"
        + orderId + "', 'Prestation', 1, 100)");
    asUser("SELECT public.post_delivery('" + orderId + "', jsonb_build_array(jsonb_build_object('so_line_id', '"
        + lineId + "', 'quantity', 1)))");

    String deliveryId = rows("SELECT id FROM delivery_notes WHERE so_id = '" + orderId + "'").get(0);
    assertThat(rows("SELECT status FROM delivery_notes WHERE id = '" + deliveryId + "'"))
        .containsExactly("completed");
    assertThat(rows("SELECT ai.total::text FROM delivery_notes dn JOIN ar_invoices ai ON ai.id = dn.ar_invoice_id"
        + " WHERE dn.id = '" + deliveryId + "'"))
        .containsExactly("100.00");
    assertThat(rows("SELECT id FROM stock_movements WHERE reference_type = 'delivery_note' AND reference_id = '"
        + deliveryId + "'"))
        .isEmpty();
  }

  private static void asUser(String sql) throws SQLException {
    try (Connection connection = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      connection.setAutoCommit(false);
      try (PreparedStatement claims = connection.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + PostgresFixture.ALPHA_USER + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement statement = connection.createStatement()) {
        statement.execute(sql);
        connection.commit();
      } catch (SQLException error) {
        connection.rollback();
        throw error;
      }
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static List<String> rows(String sql) {
    List<String> result = new ArrayList<>();
    try (Connection connection = DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.ADMIN_USER, PostgresFixture.ADMIN_PASSWORD);
        Statement statement = connection.createStatement();
        ResultSet rows = statement.executeQuery(sql)) {
      while (rows.next()) result.add(rows.getString(1));
    } catch (SQLException error) {
      throw new IllegalStateException("Observation échouée : " + sql, error);
    }
    return result;
  }
}
