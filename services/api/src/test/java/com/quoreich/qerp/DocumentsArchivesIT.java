package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class DocumentsArchivesIT {

  private static final String DATABASE = "qerp_it_documents_archives";
  private static final String TENANT = "33333333-3333-3333-3333-333333333141";
  private static final String ADMIN = "33333333-0000-0000-0000-000000000141";
  private static final String READER = "33333333-0000-0000-0000-000000000241";
  private static final String CUSTOMER = "33333333-0000-0000-0000-000000000341";
  private static final String INVOICE = "33333333-0000-0000-0000-000000000441";
  private static final String OTHER = PostgresFixture.BETA_USER;
  private static final String HASH = "a".repeat(64);

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Test
  void versionsEtEditionsImmuablesAvecInstantaneEnDevise() throws Exception {
    prepareInvoice();

    String save = "public.save_document_template(NULL, 'Standard', "
        + "'{\"title\":\"<script x=\\\"a\\\"> & {{customer.name}}\",\"accent_color\":\"#123ABC\",\"font_size\":10}'::jsonb, 'Initial')";
    assertThatThrownBy(() -> user(READER, "SELECT " + save)).extracting("SQLState").isEqualTo("42501");
    String layout = "'{\"title\":\"Facture\",\"intro\":\"\",\"footer\":\"\",\"accent_color\":\"#17324d\",\"font_size\":10}'";
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template(NULL, 'Sans motif', " + layout + ", NULL)"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template(NULL, 'Sans motif', " + layout + ", '   ')"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template(NULL, 'Erreur', '{\"title\":\"{{customer.secret}}\"}', NULL)"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template(NULL, 'Erreur', '{\"html\":\"<iframe>\"}', NULL)"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT save_document_template(NULL, 'Erreur', '{\"accent_color\":\"#fff;background:url(https://example.invalid)\"}', NULL)"))
        .extracting("SQLState").isEqualTo("QG038");
    String version = user(ADMIN, "SELECT " + save + "->'version'->>'id'");
    String template = user(ADMIN, "SELECT template_id::text FROM document_template_versions WHERE id = '" + version + "'");
    String request = "request_document_edition('" + INVOICE + "', '" + template + "')";
    assertThatThrownBy(() -> user(READER, "SELECT publish_document_template('" + version + "', 'Publication')"))
        .extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> user(ADMIN, "SELECT publish_document_template('" + version + "', NULL)"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT publish_document_template('" + version + "', '   ')"))
        .extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> user(ADMIN, "SELECT " + request)).extracting("SQLState").isEqualTo("QG038");
    assertThat(user(ADMIN, "SELECT publish_document_template('" + version + "', 'Publication')->>'id'")).isEqualTo(version);
    assertThatThrownBy(() -> user(ADMIN, "SELECT " + request)).extracting("SQLState").isEqualTo("QG038");
    owner("UPDATE ar_invoices SET status = 'sent' WHERE id = '" + INVOICE + "'");
    assertThatThrownBy(() -> user(READER, "SELECT " + request)).extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> user(OTHER, "SELECT " + request)).isInstanceOf(SQLException.class);

    String edition = concurrentRequests(request);
    String path = TENANT + "/issued/" + edition + ".pdf";
    String claim = "claim_document_edition('" + edition + "', '" + ADMIN + "')";
    assertThat(user(ADMIN, "SELECT count(*) FROM issued_documents")).isEqualTo("1");
    assertThat(user(READER, "SELECT count(*) FROM issued_documents")).isEqualTo("0");
    assertThat(user(OTHER, "SELECT count(*) FROM issued_documents")).isEqualTo("0");
    assertThat(user(OTHER, "SELECT count(*) FROM document_templates")).isEqualTo("0");
    assertThat(user(ADMIN, """
        SELECT concat_ws(' ', d.context #>> '{document,currency}', d.context #>> '{document,total}',
          d.context #>> '{lines,0,unit_price}', d.context #>> '{lines,0,net_amount}',
          d.context #>> '{lines,0,tax_amount}', d.context #>> '{document,due_date}')
        FROM issued_documents d WHERE d.id = '%s'
        """.formatted(edition))).isEqualTo("EUR 1000.00 500.2500 1000.00 0.00 2031-06-01");
    assertThatThrownBy(() -> user(ADMIN, "SELECT " + claim)).extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> worker("SELECT claim_document_edition('" + edition + "', '" + OTHER + "')"))
        .extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> worker("SELECT claim_document_edition('" + edition + "', '" + READER + "')"))
        .extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> user(ADMIN, "DELETE FROM issued_documents WHERE id = '" + edition + "' RETURNING id"))
        .extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> worker("UPDATE issued_documents SET status = 'ready' WHERE id = '" + edition + "' RETURNING id"))
        .extracting("SQLState").isEqualTo("42501");
    assertThatThrownBy(() -> owner("UPDATE document_template_versions SET content_html = 'altéré' WHERE id = '" + version + "'"))
        .hasRootCauseInstanceOf(SQLException.class).hasMessageContaining("immuable");

    owner("UPDATE customers SET name = 'Autre client' WHERE id = '" + CUSTOMER + "'");
    String version2 = user(ADMIN, "SELECT save_document_template('" + template + "', 'Standard', "
        + "'{\"title\":\"Version deux\"}', 'Correction')->'version'->>'id'");
    user(ADMIN, "SELECT publish_document_template('" + version2 + "', 'Publication')");
    assertThat(user(ADMIN, "SELECT request_document_edition('" + INVOICE + "')->>'id'")).isEqualTo(edition);

    String html = apiWorker(ADMIN, "SELECT " + claim + "->>'html'");
    assertThat(html).contains("&lt;script x=&quot;a&quot;&gt; &amp; Client &lt;img&gt;", "Prestation &lt;iframe&gt;", "1000.00", "EUR")
        .doesNotContain("<script", "<img>", "<iframe>", "Autre client", "Version deux", "655957");
    assertThat(worker("SELECT " + claim)).isNull();
    String completion = "SELECT complete_document_edition('" + edition + "', '" + ADMIN + "', '%s', '%s', 'Gotenberg', '9.2')->>'status'";
    assertThatThrownBy(() -> worker(completion.formatted("../file.pdf", HASH))).extracting("SQLState").isEqualTo("QG038");
    assertThatThrownBy(() -> worker(completion.formatted(path, "invalid"))).extracting("SQLState").isEqualTo("QG038");
    assertThat(worker(completion.formatted(path, HASH))).isEqualTo("ready");
    assertThatThrownBy(() -> owner("UPDATE issued_documents SET pdf_sha256 = '" + "b".repeat(64) + "' WHERE id = '" + edition + "'"))
        .hasRootCauseInstanceOf(SQLException.class).hasMessageContaining("immuable");

    String replace = "request_document_edition('" + INVOICE + "', NULL, '" + edition + "', %s)";
    assertThatThrownBy(() -> user(ADMIN, "SELECT " + replace.formatted("'  '"))).extracting("SQLState").isEqualTo("QG038");
    String replacement = user(ADMIN, "SELECT " + replace.formatted("'Correction du modèle'") + "->>'id'");
    assertThat(replacement).isNotEqualTo(edition);
    assertThat(user(ADMIN, "SELECT " + replace.formatted("'Correction du modèle'") + "->>'id'")).isEqualTo(replacement);
    assertThat(user(ADMIN, "SELECT template_version_id || ' ' || replaces_id FROM issued_documents WHERE id = '" + replacement + "'"))
        .isEqualTo(version2 + " " + edition);

    String replacementClaim = "claim_document_edition('" + replacement + "', '" + ADMIN + "')";
    assertThat(worker("SELECT " + replacementClaim + "->>'storage_path'")).isEqualTo(TENANT + "/issued/" + replacement + ".pdf");
    assertThatThrownBy(() -> user(ADMIN, "SELECT retry_document_edition('" + replacement + "')")).extracting("SQLState").isEqualTo("QG038");
    assertThat(worker("SELECT fail_document_edition('" + replacement + "', '" + ADMIN + "', 'Rendu indisponible')->>'status'")).isEqualTo("failed");
    String contextHash = user(ADMIN, "SELECT context_sha256 FROM issued_documents WHERE id = '" + replacement + "'");
    assertThat(contextHash).hasSize(64);
    assertThat(user(ADMIN, "SELECT retry_document_edition('" + replacement + "')->>'context_sha256'")).isEqualTo(contextHash);
    assertThat(worker("SELECT " + replacementClaim + "->>'status'")).isEqualTo("rendering");
    owner("UPDATE issued_documents SET started_at = now() - interval '61 seconds' WHERE id = '" + replacement + "'");
    assertThat(user(ADMIN, "SELECT retry_document_edition('" + replacement + "')->>'context_sha256'")).isEqualTo(contextHash);
    assertThatThrownBy(() -> owner("INSERT INTO document_template_versions (tenant_id, template_id, version_no, layout, content_html, sha256, created_by) VALUES ('"
        + PostgresFixture.BETA_TENANT + "', '" + template + "', 3, '{}', '', '" + HASH + "', '" + OTHER + "')"))
        .hasMessageContaining("société");
  }

  private static void prepareInvoice() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("""
        INSERT INTO tenants (id, name) VALUES ('%s', 'Société V141');
        INSERT INTO auth.users (id) VALUES ('%s'), ('%s');
        INSERT INTO profiles (id, tenant_id, full_name) VALUES ('%s', '%s', 'Comptable'), ('%s', '%s', 'Lecteur');
        INSERT INTO customers (id, tenant_id, name) VALUES ('%s', '%s', 'Client <img>');
        INSERT INTO ar_invoices (id, tenant_id, invoice_number, customer_id, invoice_date, due_date, currency, status, created_by)
          VALUES ('%s', '%s', 'VE-141', '%s', '2031-05-02', '2031-06-01', 'EUR', 'draft', '%s');
        INSERT INTO ar_invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, fx_unit_price, discount_pct)
          VALUES ('%s', '%s', 1, 'Prestation <iframe>', 2, 0, 500.2500, 0.05);
        """.formatted(TENANT, ADMIN, READER, ADMIN, TENANT, READER, TENANT, CUSTOMER, TENANT, INVOICE, TENANT, CUSTOMER, ADMIN, TENANT, INVOICE));
    PostgresFixture.applySyscohada(DATABASE, TENANT);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", TENANT, OTHER, "admin", PostgresFixture.BETA_TENANT);
  }

  private static String concurrentRequests(String expression) throws Exception {
    String request = "SELECT " + expression + "->>'id'";
    try (Connection first = connection("authenticated", ADMIN); Statement statement = first.createStatement()) {
      String id;
      try (ResultSet result = statement.executeQuery(request)) {
        result.next();
        id = result.getString(1);
      }
      CompletableFuture<String> second = CompletableFuture.supplyAsync(() -> {
        try {
          return user(ADMIN, request);
        } catch (SQLException e) {
          throw new CompletionException(e);
        }
      });
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      boolean waiting;
      do {
        waiting = PostgresFixture.countAsAdmin(DATABASE, "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'"
            + " AND query LIKE '%request_document_edition%' AND query LIKE '%" + INVOICE + "%'") == 1;
        if (!waiting) Thread.sleep(25);
      } while (!waiting && System.nanoTime() < deadline);
      first.commit();
      assertThat(waiting).as("les éditions concurrentes se sérialisent sur la facture").isTrue();
      assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(id);
      return id;
    }
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String user(String actor, String sql) throws SQLException {
    return query("authenticated", actor, sql);
  }

  private static String worker(String sql) throws SQLException {
    return query("service_role", null, sql);
  }

  private static String apiWorker(String actor, String sql) throws SQLException {
    return query(PostgresFixture.API_USER, actor, sql);
  }

  private static String query(String role, String actor, String sql) throws SQLException {
    try (Connection connection = connection(role, actor); Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
      String value = result.next() ? result.getString(1) : null;
      connection.commit();
      return value;
    }
  }

  private static Connection connection(String role, String actor) throws SQLException {
    boolean apiLogin = role.equals(PostgresFixture.API_USER);
    Connection connection = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE),
        apiLogin ? PostgresFixture.API_USER : PostgresFixture.ADMIN_USER,
        apiLogin ? PostgresFixture.API_PASSWORD : PostgresFixture.ADMIN_PASSWORD);
    try {
      connection.setAutoCommit(false);
      if (!apiLogin) {
        try (Statement statement = connection.createStatement()) {
          statement.execute("SET LOCAL ROLE " + role);
        }
      }
      if (actor != null) {
        try (PreparedStatement claims = connection.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
          claims.setString(1, "{\"sub\":\"" + actor + "\",\"role\":\"authenticated\"}");
          claims.execute();
        }
      }
      return connection;
    } catch (SQLException e) {
      connection.close();
      throw e;
    }
  }
}
