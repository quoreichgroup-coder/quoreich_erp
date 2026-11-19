package com.quoreich.qerp.modules.realtime;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Relais du canal PostgreSQL {@code qerp_changes} (V118) vers les WebSocket authentifiées, par société. La connexion
 * d'écoute n'est ouverte qu'au premier abonné (une installation sans navigateur connecté n'en consomme aucune) et
 * rouverte après une coupure. Le message ne contient que le nom de la table : l'écran relit sous sa RLS.
 */
@Component
public class RealtimeHub {

  private static final Logger log = LoggerFactory.getLogger(RealtimeHub.class);
  private static final ObjectMapper JSON = new ObjectMapper();

  private final DataSource dataSource;
  private final Map<WebSocketSession, UUID> subscribers = new ConcurrentHashMap<>();
  private volatile Thread listener;
  private volatile boolean stopping;

  public RealtimeHub(DataSource dataSource) {
    this.dataSource = dataSource;
  }

  public void subscribe(WebSocketSession session, UUID tenantId) {
    subscribers.put(session, tenantId);
    ensureListening();
  }

  public void unsubscribe(WebSocketSession session) {
    subscribers.remove(session);
  }

  public int subscriberCount() {
    return subscribers.size();
  }

  private synchronized void ensureListening() {
    if (listener != null && listener.isAlive()) return;
    listener = Thread.ofPlatform().daemon().name("qerp-realtime").start(this::listen);
  }

  private void listen() {
    while (!stopping) {
      try (Connection c = dataSource.getConnection(); Statement st = c.createStatement()) {
        st.execute("LISTEN qerp_changes");
        if (!c.getAutoCommit()) c.commit();
        Class<?> pgConnection = Class.forName("org.postgresql.PGConnection");
        Object pg = c.unwrap(pgConnection);
        Method poll = pgConnection.getMethod("getNotifications", int.class);
        Method parameter = Class.forName("org.postgresql.PGNotification").getMethod("getParameter");
        log.info("Temps réel : écoute du canal qerp_changes");
        while (!stopping) {
          Object[] notes = (Object[]) poll.invoke(pg, 10_000);
          if (notes == null) continue;
          for (Object n : notes) dispatch((String) parameter.invoke(n));
        }
      } catch (Exception e) {
        if (stopping) return;
        log.warn("Temps réel : écoute interrompue ({}), nouvelle tentative dans 5 s", e.getClass().getSimpleName());
        try {
          Thread.sleep(5_000);
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          return;
        }
      }
    }
  }

  void dispatch(String payload) {
    JsonNode p;
    try {
      p = JSON.readTree(payload);
    } catch (RuntimeException e) {
      return;
    }
    String table = p.path("t").asString("");
    String tenant = p.path("s").asString("");
    if (table.isEmpty() || tenant.isEmpty()) return;
    TextMessage message = new TextMessage(JSON.createObjectNode().put("type", "change").put("table", table).toString());
    subscribers.forEach((session, t) -> {
      if (!t.toString().equals(tenant) || !session.isOpen()) return;
      try {
        session.sendMessage(message);
      } catch (IOException | IllegalStateException e) {
        subscribers.remove(session);
      }
    });
  }

  @PreDestroy
  void stop() {
    stopping = true;
    Thread t = listener;
    if (t != null) t.interrupt();
  }
}
