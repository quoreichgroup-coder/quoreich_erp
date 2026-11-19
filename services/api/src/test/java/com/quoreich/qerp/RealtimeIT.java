package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;

import com.quoreich.qerp.tenant.TenantContextHolder;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * Temps réel sur site (V118) par un vrai serveur : connexion par l'identité locale, WebSocket authentifiée par le
 * premier message, changement de la société reçu, changement d'une autre société jamais reçu, jeton invalide refusé.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"qerp.identity.key-file=target/it-identity/signing-key.json"})
class RealtimeIT {

  private static final String DATABASE = "qerp_it_realtime";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @LocalServerPort private int port;
  @Autowired private ObjectMapper json;
  private final HttpClient http = HttpClient.newHttpClient();

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    TenantContextHolder.clear();
  }

  private String jeton() throws Exception {
    String hash = new BCryptPasswordEncoder(10).encode("Temps-reel-sur-site");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO qerp_identity.accounts (user_id, email, password_hash, email_confirmed_at) VALUES ('"
        + PostgresFixture.ALPHA_USER + "', 'temps.reel@exemple.invalid', '" + hash + "', now()) ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash");
    HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/auth/v1/token?grant_type=password"))
        .header("Content-Type", "application/json").header("Authorization", "Bearer sb_publishable_cle")
        .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"temps.reel@exemple.invalid\",\"password\":\"Temps-reel-sur-site\"}")).build(),
        HttpResponse.BodyHandlers.ofString());
    assertThat(r.statusCode()).as(r.body()).isEqualTo(200);
    return json.readTree(r.body()).get("access_token").asString();
  }

  private record Ecoute(WebSocket socket, LinkedBlockingQueue<String> messages, CompletableFuture<Integer> fermeture) {}

  private Ecoute ouvrir() throws Exception {
    LinkedBlockingQueue<String> messages = new LinkedBlockingQueue<>();
    CompletableFuture<Integer> fermeture = new CompletableFuture<>();
    WebSocket ws = http.newWebSocketBuilder().buildAsync(URI.create("ws://localhost:" + port + "/api/v1/realtime"), new WebSocket.Listener() {
      private final StringBuilder part = new StringBuilder();

      @Override
      public CompletionStage<?> onText(WebSocket w, CharSequence data, boolean last) {
        part.append(data);
        if (last) {
          messages.add(part.toString());
          part.setLength(0);
        }
        w.request(1);
        return null;
      }

      @Override
      public CompletionStage<?> onClose(WebSocket w, int code, String reason) {
        fermeture.complete(code);
        return null;
      }
    }).get(10, TimeUnit.SECONDS);
    return new Ecoute(ws, messages, fermeture);
  }

  private void alerte(String tenant, String titre) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO erp_alerts (tenant_id, module, alert_type, title, message) VALUES ('"
        + tenant + "', 'test', 'test', '" + titre + "', 'temps réel')");
  }

  @Test
  @DisplayName("changement de la société reçu ; autre société jamais ; jeton invalide refusé")
  void diffusionParSociete() throws Exception {
    Ecoute e = ouvrir();
    e.socket().sendText("{\"type\":\"auth\",\"token\":\"" + jeton() + "\"}", true).get(5, TimeUnit.SECONDS);
    assertThat(e.messages().poll(10, TimeUnit.SECONDS)).isEqualTo("{\"type\":\"ready\"}");

    alerte(B, "Autre société");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO ai_analysis_history (tenant_id, analysis_type, trigger_source, status, params, result, inputs)"
        + " VALUES ('" + A + "', 'cashflow_forecast', 'manual', 'error', '{}', '{}', '{}')");
    String recu = e.messages().poll(15, TimeUnit.SECONDS);
    assertThat(recu).as("changement de sa société").contains("\"table\":\"ai_analysis_history\"");
    alerte(A, "Sa société");
    assertThat(e.messages().poll(10, TimeUnit.SECONDS)).contains("\"table\":\"erp_alerts\"");
    alerte(B, "Autre société encore");
    assertThat(e.messages().poll(3, TimeUnit.SECONDS)).as("rien de l'autre société").isNull();
    e.socket().sendClose(WebSocket.NORMAL_CLOSURE, "fin").get(5, TimeUnit.SECONDS);

    Ecoute intrus = ouvrir();
    intrus.socket().sendText("{\"type\":\"auth\",\"token\":\"eyJhbGciOiJFUzI1NiJ9.e30.signature\"}", true).get(5, TimeUnit.SECONDS);
    assertThat(intrus.fermeture().get(10, TimeUnit.SECONDS)).isEqualTo(1008);
    assertThat(intrus.messages()).isEmpty();
  }
}
