package com.quoreich.qerp.modules.documents;

import static java.net.http.HttpRequest.BodyPublishers.ofString;
import static java.net.http.HttpResponse.BodySubscribers.limiting;
import static java.net.http.HttpResponse.BodySubscribers.ofByteArray;
import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.concurrent.TimeUnit.NANOSECONDS;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class GotenbergPdfClient {
  private static final String HTML_ROUTE = "/forms/chromium/convert/html";
  /** Langue déclarée dans les métadonnées PDF/A : celle figée sur l'édition (V155), « fr » pour les éditions antérieures. */
  private static String pdfAStages(String language) {
    String lang = language != null && language.matches("[a-z]{2,3}") ? language : "fr";
    return "[{\"op\":\"remediate\",\"profile\":\"PDF/A-2b\",\"language\":\"" + lang + "\"}]";
  }

  private final HttpClient client;
  private final URI endpoint;
  private final String authorization;
  private final Duration timeout;

  @Autowired
  GotenbergPdfClient(@Value("${qerp.pdf.url:}") String baseUrl,
      @Value("${qerp.pdf.authorization:}") String authorization) {
    this(baseUrl, authorization, Duration.ofSeconds(30));
  }

  GotenbergPdfClient(String baseUrl, Duration timeout) {
    this(baseUrl, "", timeout);
  }

  private GotenbergPdfClient(String baseUrl, String authorization, Duration timeout) {
    client = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    endpoint = baseUrl.isBlank() ? null : URI.create(baseUrl.replaceFirst("/+$", "") + HTML_ROUTE);
    this.authorization = authorization;
    this.timeout = timeout;
  }

  byte[] render(String html) throws IOException, InterruptedException {
    return render(html, "fr");
  }

  byte[] render(String html, String language) throws IOException, InterruptedException {
    if (endpoint == null) throw new IOException("Le moteur de rendu PDF n’est pas configuré");

    String boundary = "qerp-" + UUID.randomUUID();
    String multipart = "--" + boundary + "\r\n"
        + "Content-Disposition: form-data; name=\"files\"; filename=\"index.html\"\r\n"
        + "Content-Type: text/html; charset=UTF-8\r\n\r\n"
        + html + "\r\n"
        + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"stages\"\r\n\r\n"
        + pdfAStages(language) + "\r\n"
        + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"preferCssPageSize\"\r\n\r\ntrue\r\n"
        + "--" + boundary + "--\r\n";
    var request = HttpRequest.newBuilder(endpoint).timeout(timeout)
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .header("Accept", "application/pdf");
    if (!authorization.isBlank()) request.header("Authorization", authorization);

    var result = client.sendAsync(request.POST(ofString(multipart, UTF_8)).build(),
        response -> limiting(ofByteArray(), DocumentArchive.MAX_PDF_BYTES));
    HttpResponse<byte[]> response;
    try {
      response = result.get(timeout.toNanos(), NANOSECONDS);
    } catch (TimeoutException e) {
      result.cancel(true);
      throw new HttpTimeoutException("Le moteur de rendu PDF a dépassé son délai");
    } catch (InterruptedException e) {
      result.cancel(true);
      throw e;
    } catch (ExecutionException e) {
      throw new IOException("La réponse du moteur de rendu PDF n’a pas pu être lue", e.getCause());
    }

    if (response.statusCode() != 200) {
      throw new IOException("Le moteur de rendu PDF a refusé la conversion (HTTP " + response.statusCode() + ")");
    }
    if (!"0".equals(response.headers().firstValue("Gotenberg-Remediation-Residual").orElse(null))) {
      throw new IOException("Le moteur de rendu n’a pas confirmé la conformité PDF/A-2b");
    }
    DocumentArchive.validatePdf(response.body());
    return response.body();
  }

  @PreDestroy
  void close() {
    client.shutdownNow();
  }
}
