package com.quoreich.qerp.modules.realtime;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Point WebSocket du temps réel, ouvert aux seules origines autorisées pour l'API (qerp.api.cors.allowed-origins). */
@Configuration(proxyBeanMethods = false)
@EnableWebSocket
public class RealtimeConfig implements WebSocketConfigurer {

  private final RealtimeSocketHandler handler;
  private final String[] origins;

  public RealtimeConfig(RealtimeSocketHandler handler, @Value("${qerp.api.cors.allowed-origins:}") String allowedOrigins) {
    this.handler = handler;
    this.origins = Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(o -> !o.isEmpty()).toArray(String[]::new);
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    var registration = registry.addHandler(handler, "/api/v1/realtime");
    if (origins.length > 0) registration.setAllowedOrigins(origins);
  }
}
