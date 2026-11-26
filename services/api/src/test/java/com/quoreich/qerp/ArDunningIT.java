package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;

/** V142 — relance échue, exclusion des lettres, réservation unique et journal figé. */
@SpringBootTest
@AutoConfigureMockMvc
class ArDunningIT {
  private static final String DATABASE = "qerp_it_ar_dunning";
  private static final String T = "33333333-3333-3333-3333-333333333142";
  private static final String U = "cccccccc-0000-0000-0000-000000000142";
  private static final String C = "00000000-0000-0000-0000-0000000c0142";
  private static final String I = "00000000-0000-0000-0000-0000000a0142";
  private static final FakeSmtpServer SMTP = new FakeSmtpServer();
  @Autowired private MockMvc mockMvc;

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
    registry.add("qerp.smtp.host", () -> "127.0.0.1");
    registry.add("qerp.smtp.port", () -> SMTP.port());
    registry.add("qerp.smtp.from", () -> "relances@example.test");
    registry.add("qerp.smtp.starttls", () -> false);
  }

  @AfterAll
  static void closeSmtp() throws IOException { SMTP.close(); }

  private static void owner(String sql) { PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql); }
  private static String text(String sql) { return PostgresFixture.textAsAdmin(DATABASE, sql); }

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + U + "\",\"role\":\"authenticated\"}"); claims.execute();
      }
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        String result = rs.next() ? rs.getString(1) : null; c.commit(); return result;
      } catch (SQLException e) { c.rollback(); throw e; }
    }
  }

  @Test
  @DisplayName("règle de courriel éligible, lettre ignorée, puis envoi réservé et non répétable")
  void dunningIsIdempotentAndTenantScoped() throws Exception {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants(id,name) VALUES ('" + T + "','Société relances');"
        + "INSERT INTO auth.users(id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles(id,tenant_id,full_name) VALUES ('" + U + "','" + T + "','Comptable') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO customers(id,tenant_id,name,email) VALUES ('" + C + "','" + T + "','Client Exemple','compta@example.test');"
        + "INSERT INTO ar_general_settings(tenant_id,auto_numbering) VALUES ('" + T + "',false) ON CONFLICT (tenant_id) DO UPDATE SET auto_numbering=false;"
        + "INSERT INTO ar_invoices(id,tenant_id,invoice_number,customer_id,invoice_date,due_date,subtotal,amount_paid,status,created_by,currency)"
        + " VALUES ('" + I + "','" + T + "','FAC-142','" + C + "',CURRENT_DATE-40,CURRENT_DATE-35,100000,25000,'partially_paid','" + U + "','XOF');"
        + "DELETE FROM ar_dunning_rules WHERE tenant_id='" + T + "';"
        + "INSERT INTO ar_dunning_rules(tenant_id,level,days_overdue,action,template) VALUES"
        + " ('" + T + "',1,7,'Rappel par e-mail','Bonjour {{customer_name}} — {{invoice_number}} : {{balance}} {{currency}}'),"
        + " ('" + T + "',2,30,'Lettre de relance','Courrier manuel'),"
        + " ('" + T + "',3,30,'Courriel final','Dernier rappel à {{customer_name}}');");
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);

    assertThat(asUser("SELECT count(*)::text FROM ar_dunning_candidates()")).isEqualTo("1");
    // Le candidat de premier niveau expose le solde réel, les variables connues et ne rend pas le HTML.
    String preview = asUser("SELECT to_jsonb(c)::text FROM ar_dunning_candidates() c LIMIT 1");
    assertThat(preview).contains("Client Exemple", "FAC-142", "75000", "XOF", "Bonjour Client Exemple");
    String ruleId = text("SELECT id FROM ar_dunning_rules WHERE tenant_id='" + T + "' AND level=1");
    mockMvc.perform(post("/api/v1/ar/dunning/" + I + "/send").with(jwt().jwt(jwt -> jwt.subject(U)))
        .contentType(MediaType.APPLICATION_JSON).content("{\"rule_id\":\"" + ruleId + "\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("sent"));
    assertThat(SMTP.awaitMessage()).contains("To: compta@example.test", "FAC-142", "75000.00 XOF");
    mockMvc.perform(post("/api/v1/ar/dunning/" + I + "/send").with(jwt().jwt(jwt -> jwt.subject(U)))
        .contentType(MediaType.APPLICATION_JSON).content("{\"rule_id\":\"" + ruleId + "\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("sent"));
    assertThat(SMTP.messages()).isEqualTo(1);
    String eventId = text("SELECT id FROM ar_dunning_events WHERE invoice_id='" + I + "'");
    assertThat(asUser("SELECT (prepare_ar_dunning_event('" + I + "','" + text("SELECT id FROM ar_dunning_rules WHERE tenant_id='" + T + "' AND level=1") + "')).id::text"))
        .as("une répétition retourne le journal existant sans le rejouer").isEqualTo(eventId);
    assertThat(asUser("SELECT count(*)::text FROM ar_dunning_events WHERE invoice_id='" + I + "'")).isEqualTo("1");
    assertThat(asUser("SELECT count(*)::text FROM ar_dunning_candidates()")).isEqualTo("1");
    assertThat(asUser("SELECT rule_level::text FROM ar_dunning_candidates() LIMIT 1")).isEqualTo("3");
    assertThatThrownBy(() -> asUser("UPDATE ar_dunning_events SET message='tampered' WHERE id='" + eventId + "' RETURNING id::text"))
        .as("le rôle connecté ne peut pas réécrire le contenu figé").isInstanceOf(SQLException.class);
  }

  /** Petit serveur SMTP sans authentification, utilisé uniquement par cette IT sur loopback. */
  private static final class FakeSmtpServer implements AutoCloseable {
    private final ServerSocket server;
    private final AtomicInteger messages = new AtomicInteger();
    private final CountDownLatch delivered = new CountDownLatch(1);
    private volatile String message = "";

    FakeSmtpServer() {
      try {
        server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
      } catch (IOException e) {
        throw new IllegalStateException(e);
      }
      Thread worker = new Thread(this::serve, "ar-dunning-fake-smtp");
      worker.setDaemon(true);
      worker.start();
    }

    int port() { return server.getLocalPort(); }
    int messages() { return messages.get(); }

    String awaitMessage() {
      try {
        assertThat(delivered.await(5, TimeUnit.SECONDS)).as("SMTP a accepté le message").isTrue();
        return message;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError(e);
      }
    }

    private void serve() {
      try (Socket socket = server.accept();
          BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
          PrintWriter out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
        out.println("220 local.test ESMTP");
        String line;
        boolean data = false;
        StringBuilder body = new StringBuilder();
        while ((line = in.readLine()) != null) {
          if (data) {
            if (line.equals(".")) {
              data = false;
              message = body.toString();
              messages.incrementAndGet();
              delivered.countDown();
              out.println("250 2.0.0 accepted");
            } else body.append(line.startsWith("..") ? line.substring(1) : line).append('\n');
          } else if (line.startsWith("EHLO ") || line.startsWith("HELO ")) {
            out.println("250-local.test");
            out.println("250 8BITMIME");
          } else if (line.startsWith("MAIL FROM:") || line.startsWith("RCPT TO:")) out.println("250 2.1.0 ok");
          else if (line.equals("DATA")) { data = true; out.println("354 end with dot"); }
          else if (line.equals("QUIT")) { out.println("221 2.0.0 bye"); break; }
          else out.println("250 ok");
        }
      } catch (IOException e) {
        if (!server.isClosed()) throw new IllegalStateException("Fake SMTP failed", e);
      }
    }

    @Override public void close() throws IOException { server.close(); }
  }
}
