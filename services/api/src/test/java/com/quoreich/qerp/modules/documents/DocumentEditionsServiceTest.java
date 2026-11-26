package com.quoreich.qerp.modules.documents;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.quoreich.qerp.tenant.TenantContextHolder;
import com.quoreich.qerp.tenant.TenantPrincipal;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.NullNode;

class DocumentEditionsServiceTest {
  private static final UUID TENANT = UUID.fromString("69bea98a-a27d-4252-ac19-a2123e7bfa0d");
  private static final UUID ACTOR = UUID.fromString("9d702641-c3f9-4286-991a-ec2626d23e68");
  private static final ObjectMapper JSON = new ObjectMapper();

  @TempDir private Path directory;

  @AfterEach
  void clearContext() {
    TenantContextHolder.clear();
    SecurityContextHolder.clearContext();
  }

  @Test
  void reusesOrphanAndRunsServerRpcsWithTheRequestIdentity() throws Exception {
    var query = mock(DocumentEditionsQuery.class);
    var archive = new DocumentArchive(directory.toString());
    var received = new LinkedBlockingQueue<WorkerResult>();
    UUID id = UUID.randomUUID();
    String path = TENANT + "/issued/" + id + ".pdf";
    byte[] pdf = "%PDF-1.7\nOrphan".getBytes(UTF_8);
    String hash = archive.store(TENANT, id, path, pdf);
    when(query.retry(id)).thenReturn(queued(id));
    when(query.claim(id, ACTOR)).thenReturn(JSON.createObjectNode()
        .put("id", id.toString()).put("tenant_id", TENANT.toString()).put("storage_path", path).put("html", "<p>Facture</p>"));
    when(query.complete(eq(id), eq(ACTOR), eq(path), eq(hash), eq("gotenberg"), eq("9.2.0"))).thenAnswer(invocation -> {
      received.add(new WorkerResult(Thread.currentThread(), TenantContextHolder.current().orElse(null),
          SecurityContextHolder.getContext().getAuthentication().getName()));
      return NullNode.getInstance();
    });

    try (var service = service(query, archive)) {
      authenticate();
      assertThat(service.retry(id).get("status").asString()).isEqualTo("queued");
      clearContext();

      WorkerResult result = received.poll(5, SECONDS);
      assertThat(result).isNotNull();
      assertThat(result.thread()).isNotEqualTo(Thread.currentThread());
      assertThat(result.principal()).isEqualTo(new TenantPrincipal(ACTOR, TENANT));
      assertThat(result.actor()).isEqualTo(ACTOR.toString());
      assertThat(archive.download(TENANT, id, path, hash)).isEqualTo(pdf);
    }
  }

  @Test
  void retrySubmittedAsSoonAsFailureIsVisibleStillRuns() throws Exception {
    var query = mock(DocumentEditionsQuery.class);
    var archive = new DocumentArchive(directory.toString());
    var failureCommitted = new CountDownLatch(1);
    var releaseFailCaller = new CountDownLatch(1);
    var completed = new CountDownLatch(1);
    UUID id = UUID.randomUUID();
    String path = TENANT + "/issued/" + id + ".pdf";
    when(query.retry(id)).thenReturn(queued(id));
    when(query.claim(id, ACTOR)).thenReturn(JSON.createObjectNode()
        .put("id", id.toString()).put("tenant_id", TENANT.toString()).put("storage_path", path).put("html", "<p>Facture</p>"));
    when(query.fail(eq(id), eq(ACTOR), anyString())).thenAnswer(invocation -> {
      failureCommitted.countDown();
      releaseFailCaller.await(5, SECONDS);
      return NullNode.getInstance();
    });
    when(query.complete(eq(id), eq(ACTOR), eq(path), anyString(), eq("gotenberg"), eq("9.2.0"))).thenAnswer(invocation -> {
      completed.countDown();
      return NullNode.getInstance();
    });

    try (var service = service(query, archive)) {
      authenticate();
      service.retry(id);
      try {
        assertThat(failureCommitted.await(5, SECONDS)).isTrue();
        archive.store(TENANT, id, path, "%PDF-1.7\nOrphan".getBytes(UTF_8));
        service.retry(id);
      } finally {
        releaseFailCaller.countDown();
      }
      assertThat(completed.await(5, SECONDS)).isTrue();
    }
  }

  @Test
  void marksTheNextEditionFailedAfterOneActiveAndTwentyWaitingJobs() throws Exception {
    var query = mock(DocumentEditionsQuery.class);
    var firstStarted = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var rejected = new LinkedBlockingQueue<UUID>();
    UUID running = UUID.randomUUID();
    UUID overflow = UUID.randomUUID();
    when(query.retry(any())).thenAnswer(invocation -> queued(invocation.getArgument(0)));
    when(query.claim(any(), eq(ACTOR))).thenAnswer(invocation -> {
      if (running.equals(invocation.getArgument(0))) {
        firstStarted.countDown();
        try {
          release.await(5, SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      if (overflow.equals(invocation.getArgument(0))) return queued(overflow);
      return NullNode.getInstance();
    });
    when(query.fail(any(), eq(ACTOR), anyString())).thenAnswer(invocation -> {
      UUID id = invocation.getArgument(0);
      rejected.add(id);
      return JSON.createObjectNode().put("id", id.toString()).put("status", "failed");
    });

    try (var service = service(query, new DocumentArchive(directory.toString()))) {
      try {
        authenticate();
        service.retry(running);
        assertThat(firstStarted.await(5, SECONDS)).isTrue();
        for (int i = 0; i < 20; i++) {
          assertThat(service.retry(UUID.randomUUID()).get("status").asString()).isEqualTo("queued");
        }
        assertThat(service.retry(overflow).get("status").asString()).isEqualTo("failed");
        assertThat(rejected).containsExactly(overflow);
      } finally {
        release.countDown();
      }
    }
  }

  private static DocumentEditionsService service(DocumentEditionsQuery query, DocumentArchive archive) {
    return new DocumentEditionsService(query, archive, new GotenbergPdfClient("", Duration.ofSeconds(1)), "9.2.0");
  }

  private static JsonNode queued(UUID id) {
    return JSON.createObjectNode().put("id", id.toString()).put("status", "queued");
  }

  private static void authenticate() {
    TenantContextHolder.set(new TenantPrincipal(ACTOR, TENANT));
    SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.unauthenticated(ACTOR.toString(), ""));
  }

  private record WorkerResult(Thread thread, TenantPrincipal principal, String actor) {}
}
