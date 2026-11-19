package com.quoreich.qerp.modules.realtime;

import com.quoreich.qerp.platform.Sql;
import com.quoreich.qerp.tenant.TenantContextHolder;
import com.quoreich.qerp.tenant.TenantPrincipal;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WebSocket {@code /api/v1/realtime}. Le navigateur ne peut pas poser d'en-tête Authorization sur une WebSocket : le
 * jeton arrive dans le premier message ({"type":"auth","token":…}), jamais dans l'URL (qui finit dans les journaux).
 * Il est vérifié par le même décodeur que l'API (signature, émetteur, session ouverte) ; sans authentification sous
 * 10 s, ou à l'expiration du jeton, la connexion est fermée et le client se reconnecte avec son jeton du moment.
 */
@Component
public class RealtimeSocketHandler extends TextWebSocketHandler {

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String AUTH = "qerp.authenticated";

  private final RealtimeHub hub;
  private final ObjectProvider<JwtDecoder> decoders;
  private final Sql sql;
  private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("qerp-realtime-timer").factory());

  public RealtimeSocketHandler(RealtimeHub hub, ObjectProvider<JwtDecoder> decoders, Sql sql) {
    this.hub = hub;
    this.decoders = decoders;
    this.sql = sql;
  }

  private void closeLater(WebSocketSession s, long delayMs, CloseStatus status, boolean onlyIfUnauthenticated) {
    timers.schedule(() -> {
      if (!s.isOpen() || (onlyIfUnauthenticated && Boolean.TRUE.equals(s.getAttributes().get(AUTH)))) return;
      try {
        s.close(status);
      } catch (IOException ignored) {
        // déjà fermée
      }
    }, Math.max(delayMs, 0), TimeUnit.MILLISECONDS);
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession session) {
    closeLater(session, 10_000, CloseStatus.POLICY_VIOLATION.withReason("authentification attendue"), true);
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
    if (Boolean.TRUE.equals(session.getAttributes().get(AUTH))) return;
    JsonNode m;
    try {
      m = JSON.readTree(message.getPayload());
    } catch (RuntimeException e) {
      session.close(CloseStatus.BAD_DATA);
      return;
    }
    JwtDecoder decoder = decoders.getIfAvailable();
    if (!"auth".equals(m.path("type").asString("")) || decoder == null) {
      session.close(CloseStatus.POLICY_VIOLATION);
      return;
    }
    Jwt jwt;
    UUID user;
    try {
      jwt = decoder.decode(m.path("token").asString(""));
      user = UUID.fromString(jwt.getSubject());
    } catch (JwtException | IllegalArgumentException e) {
      session.close(CloseStatus.POLICY_VIOLATION.withReason("jeton refusé"));
      return;
    }
    String tenant;
    TenantContextHolder.set(new TenantPrincipal(user, null));
    try {
      tenant = sql.value(String.class, "SELECT public.get_user_tenant_id(auth.uid())::text");
    } finally {
      TenantContextHolder.clear();
    }
    if (tenant == null) {
      session.close(CloseStatus.POLICY_VIOLATION.withReason("aucune société"));
      return;
    }
    session.getAttributes().put(AUTH, true);
    WebSocketSession safe = new ConcurrentWebSocketSessionDecorator(session, 5_000, 256 * 1024);
    hub.subscribe(safe, UUID.fromString(tenant));
    session.getAttributes().put("qerp.safe", safe);
    Instant exp = jwt.getExpiresAt();
    if (exp != null) closeLater(session, Duration.between(Instant.now(), exp).toMillis(), CloseStatus.NORMAL.withReason("jeton expiré"), false);
    safe.sendMessage(new TextMessage("{\"type\":\"ready\"}"));
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    Object safe = session.getAttributes().get("qerp.safe");
    if (safe instanceof WebSocketSession s) hub.unsubscribe(s);
  }
}
