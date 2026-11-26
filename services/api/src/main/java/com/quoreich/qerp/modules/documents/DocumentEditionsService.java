package com.quoreich.qerp.modules.documents;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.tenant.TenantContextHolder;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
class DocumentEditionsService implements AutoCloseable {
  private static final Logger log = LoggerFactory.getLogger(DocumentEditionsService.class);

  private final DocumentEditionsQuery query;
  private final DocumentArchive archive;
  private final GotenbergPdfClient renderer;
  private final String rendererVersion;
  private final Set<UUID> scheduled = ConcurrentHashMap.newKeySet();
  private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
      new ArrayBlockingQueue<>(20), Thread.ofPlatform().daemon().name("qerp-document-render").factory());

  DocumentEditionsService(DocumentEditionsQuery query, DocumentArchive archive, GotenbergPdfClient renderer,
      @Value("${qerp.pdf.renderer-version:9.2.0}") String rendererVersion) {
    this.query = query;
    this.archive = archive;
    this.renderer = renderer;
    this.rendererVersion = rendererVersion;
  }

  JsonNode request(UUID invoice, UUID po, UUID template, UUID replace, String reason) {
    return schedule(query.request(invoice, po, template, replace, reason));
  }

  JsonNode retry(UUID id) {
    return schedule(query.retry(id));
  }

  Download download(UUID id) {
    JsonNode row = query.ready(id);
    if (row.isNull()) throw new ApiRefusal(404, "Édition archivée introuvable");
    try {
      UUID tenant = UUID.fromString(row.path("tenant_id").asString());
      byte[] bytes = archive.download(tenant, id, row.path("storage_path").asString(), row.path("pdf_sha256").asString());
      String name = row.path("reference").asString().replaceAll("[^a-zA-Z0-9._-]", "_");
      return new Download((name.isBlank() ? id.toString() : name) + ".pdf", bytes);
    } catch (IOException | IllegalArgumentException e) {
      log.warn("Archive PDF de l’édition {} indisponible ou altérée", id, e);
      throw new ApiRefusal(409, "Archive PDF indisponible ou empreinte invalide");
    }
  }

  private JsonNode schedule(JsonNode edition) {
    if (!"queued".equals(edition.path("status").asString())) return edition;

    var principal = TenantContextHolder.current().orElseThrow(ApiRefusal::untouched);
    var security = SecurityContextHolder.createEmptyContext();
    security.setAuthentication(SecurityContextHolder.getContext().getAuthentication());
    UUID id = UUID.fromString(edition.path("id").asString());
    if (!scheduled.add(id)) return edition;

    try {
      worker.execute(() -> {
        try {
          SecurityContextHolder.setContext(security);
          TenantContextHolder.set(principal);
          process(id, principal.userId());
        } finally {
          TenantContextHolder.clear();
          SecurityContextHolder.clearContext();
        }
      });
      return edition;
    } catch (RejectedExecutionException e) {
      // The queued response might be stale. Only fail an edition whose claim we won.
      if (claim(id, principal.userId()).isNull()) return edition;
      JsonNode failed = query.fail(id, principal.userId(), "La file de rendu PDF est pleine. Relancez cette édition.");
      return failed.isNull() ? edition : failed;
    }
  }

  private void process(UUID id, UUID actor) {
    JsonNode claim;
    try {
      claim = claim(id, actor);
    } catch (RuntimeException e) {
      log.warn("Impossible de prendre en charge l’édition PDF {}", id, e);
      return;
    }
    if (claim.isNull()) return;

    String error = "L’archive PDF ne peut pas être lue ou conservée";
    try {
      UUID tenant = UUID.fromString(claim.path("tenant_id").asString());
      String path = claim.path("storage_path").asString();
      String hash = archive.orphanHash(tenant, id, path).orElse(null);
      if (hash == null) {
        String html = claim.path("html").asString();
        if (html.isBlank()) throw new IOException("L’édition n’a pas de HTML à convertir");
        byte[] pdf;
        try {
          pdf = renderer.render(html);
        } catch (IOException e) {
          recordFailure(id, actor, e.getMessage(), e);
          return;
        }
        hash = archive.store(tenant, id, path, pdf);
      }
      error = "L’édition PDF n’a pas pu être validée. Relancez cette édition.";
      query.complete(id, actor, path, hash, "gotenberg", rendererVersion);
    } catch (InterruptedException e) {
      recordFailure(id, actor, "Le rendu PDF a été interrompu", e);
      Thread.currentThread().interrupt();
    } catch (IOException | RuntimeException e) {
      recordFailure(id, actor, error, e);
    }
  }

  private JsonNode claim(UUID id, UUID actor) {
    try {
      return query.claim(id, actor);
    } finally {
      // The database now owns the running job. A retry must be able to queue as soon as failure is visible.
      scheduled.remove(id);
    }
  }

  private void recordFailure(UUID id, UUID actor, String error, Exception cause) {
    log.warn("Échec de l’édition PDF {}", id, cause);
    try {
      query.fail(id, actor, error);
    } catch (RuntimeException e) {
      log.error("Impossible d’enregistrer l’échec de l’édition PDF {}", id, e);
    }
  }

  @Override
  @PreDestroy
  public void close() {
    worker.shutdownNow();
  }

  record Download(String filename, byte[] bytes) {}
}
