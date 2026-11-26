package com.quoreich.qerp.modules.documents;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GotenbergPdfClientTest {
  private static final byte[] PDF = "%PDF-1.7\nFacture".getBytes(UTF_8);
  private static final String HTML = "<!DOCTYPE html><p>Facture réglée &lt;test&gt;</p>";

  private HttpServer server;

  @BeforeEach
  void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  @Test
  void postsFrozenHtmlDirectlyAsAnOfflinePdfARequest() throws Exception {
    var request = new AtomicReference<String>();
    serve(exchange -> {
      request.set(exchange.getRequestMethod() + "\n" + exchange.getRequestHeaders().getFirst("Content-Type")
          + "\n" + new String(exchange.getRequestBody().readAllBytes(), UTF_8));
      respond(exchange, "0", PDF);
    });

    assertThat(client(Duration.ofSeconds(3)).render(HTML)).isEqualTo(PDF);
    assertThat(request.get()).startsWith("POST\nmultipart/form-data; boundary=")
        .contains("name=\"files\"; filename=\"index.html\"", HTML, "name=\"stages\"", "\"op\":\"remediate\"", "PDF/A-2b")
        .doesNotContain("name=\"url\"", "name=\"downloadFrom\"");
  }

  @Test
  void refusesPdfWithoutAConfirmedConformance() {
    serve(exchange -> respond(exchange, "1", PDF));

    assertThatThrownBy(() -> client(Duration.ofSeconds(3)).render(HTML)).isInstanceOf(IOException.class);
  }

  @Test
  void refusesContentWithoutPdfSignature() {
    serve(exchange -> respond(exchange, "0", "not a PDF".getBytes(UTF_8)));

    assertThatThrownBy(() -> client(Duration.ofSeconds(3)).render(HTML)).isInstanceOf(IOException.class);
  }

  @Test
  void limitsChunkedResponsesWithNoContentLength() {
    serve(exchange -> {
      exchange.getResponseHeaders().set("Gotenberg-Remediation-Residual", "0");
      exchange.sendResponseHeaders(200, 0);
      var body = exchange.getResponseBody();
      body.write(PDF);
      byte[] chunk = new byte[1024 * 1024];
      for (int i = 0; i < 25; i++) body.write(chunk);
    });

    assertThatThrownBy(() -> client(Duration.ofSeconds(5)).render(HTML)).isInstanceOf(IOException.class);
  }

  @Test
  void appliesTimeoutEvenAfterHeadersArrive() {
    serve(exchange -> {
      exchange.getResponseHeaders().set("Gotenberg-Remediation-Residual", "0");
      exchange.sendResponseHeaders(200, 0);
      exchange.getResponseBody().write(PDF);
      exchange.getResponseBody().flush();
      try {
        Thread.sleep(Duration.ofSeconds(2));
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    });

    long start = System.nanoTime();
    assertThatThrownBy(() -> client(Duration.ofMillis(300)).render(HTML)).isInstanceOf(IOException.class);
    assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2));
  }

  private GotenbergPdfClient client(Duration timeout) {
    return new GotenbergPdfClient("http://127.0.0.1:" + server.getAddress().getPort(), timeout);
  }

  private void serve(com.sun.net.httpserver.HttpHandler response) {
    server.createContext("/forms/chromium/convert/html", exchange -> {
      try (exchange) {
        response.handle(exchange);
      }
    });
  }

  private static void respond(HttpExchange exchange, String residual, byte[] bytes) throws IOException {
    exchange.getResponseHeaders().set("Gotenberg-Remediation-Residual", residual);
    exchange.getResponseHeaders().set("Content-Type", "application/pdf");
    exchange.sendResponseHeaders(200, bytes.length);
    exchange.getResponseBody().write(bytes);
  }
}
