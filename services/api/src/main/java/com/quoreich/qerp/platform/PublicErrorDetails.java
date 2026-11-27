package com.quoreich.qerp.platform;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Clé de traduction et paramètres publics d'un refus de la base (D-I18N-004, C-01, C-04).
 *
 * <p>Une fonction SQL signale un message traduisible par {@code HINT = 'errors:…'} et ses paramètres par
 * {@code DETAIL = '{"…": …}'}. Rien de ce qui arrive de la base n'est renvoyé brut : la clé doit figurer
 * dans le registre {@code i18n/error-keys.json} (partagé avec le front), seuls les paramètres que le
 * registre déclare pour cette clé sont gardés, avec des types et longueurs bornés. Clé inconnue, HINT
 * ordinaire (texte libre des anciennes migrations) ou DETAIL illisible : aucune clé n'est exposée, et le
 * message français habituel reste la seule information — c'est exactement le comportement d'avant.
 */
public final class PublicErrorDetails {

  /** Clé canonique : espace {@code errors}, puis segments en minuscules séparés par des points. */
  static final Pattern KEY = Pattern.compile("^errors:[a-z0-9_]+(\\.[a-z0-9_]+)+$");
  static final int MAX_KEY = 120;
  static final int MAX_DETAIL = 2000;
  static final int MAX_STRING = 200;
  static final int MAX_ITEMS = 20;
  static final int MAX_ITEM = 64;

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String, Set<String>> REGISTRY = load();

  private PublicErrorDetails() {}

  /** Clé et paramètres publics, ou {@code null} quand le refus n'en porte pas de valide. */
  public record Keyed(String key, Map<String, Object> params) {}

  private static Map<String, Set<String>> load() {
    try (InputStream in = PublicErrorDetails.class.getResourceAsStream("/i18n/error-keys.json")) {
      if (in == null) throw new IllegalStateException("Registre i18n/error-keys.json introuvable");
      Map<String, Set<String>> registry = new LinkedHashMap<>();
      JsonNode root = JSON.readTree(in);
      for (Map.Entry<String, JsonNode> e : root.properties()) {
        if (!KEY.matcher(e.getKey()).matches()) throw new IllegalStateException("Clé d'erreur non canonique : " + e.getKey());
        java.util.LinkedHashSet<String> names = new java.util.LinkedHashSet<>();
        e.getValue().forEach(n -> names.add(n.asString()));
        registry.put(e.getKey(), Set.copyOf(names));
      }
      return Map.copyOf(registry);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * Lit HINT et DETAIL dans les champs structurés du pilote ({@code PSQLException.getServerErrorMessage()}).
   * Le texte de {@code getMessage()} ne convient pas : le pilote y traduit « Detail » et « Hint » dans la
   * langue de la JVM. Le pilote n'étant présent qu'à l'exécution, l'accès passe par la réflexion (comme
   * {@code RealtimeHub}) ; toute autre exception ne porte simplement pas de clé.
   */
  public static Keyed from(SQLException error) {
    if (error == null) return null;
    try {
      Object server = error.getClass().getMethod("getServerErrorMessage").invoke(error);
      if (server == null) return null;
      Object hint = server.getClass().getMethod("getHint").invoke(server);
      Object detail = server.getClass().getMethod("getDetail").invoke(server);
      return of(hint instanceof String h ? h : null, detail instanceof String d ? d : null);
    } catch (ReflectiveOperationException | RuntimeException e) {
      return null;
    }
  }

  /** Validation commune, séparée pour être testée sans base. */
  static Keyed of(String hint, String detail) {
    if (hint == null || hint.length() > MAX_KEY || !KEY.matcher(hint).matches()) return null;
    Set<String> allowed = REGISTRY.get(hint);
    if (allowed == null) return null;
    Map<String, Object> params = new LinkedHashMap<>();
    if (detail != null && !detail.isEmpty()) {
      if (detail.length() > MAX_DETAIL) return null;
      JsonNode node;
      try {
        node = JSON.readTree(detail);
      } catch (RuntimeException e) {
        return null;
      }
      if (node == null || !node.isObject()) return null;
      for (Map.Entry<String, JsonNode> p : node.properties()) {
        if (!allowed.contains(p.getKey())) continue;
        Object value = publicValue(p.getValue());
        if (value == null) return null;
        params.put(p.getKey(), value);
      }
    }
    return new Keyed(hint, Map.copyOf(params));
  }

  private static Object publicValue(JsonNode v) {
    if (v.isString()) return v.asString().length() <= MAX_STRING ? v.asString() : null;
    if (v.isIntegralNumber() || v.isFloatingPointNumber()) return v.numberValue();
    if (v.isBoolean()) return v.asBoolean();
    if (v.isArray() && v.size() <= MAX_ITEMS) {
      List<String> items = new java.util.ArrayList<>();
      for (JsonNode i : v) {
        if (!i.isString() || i.asString().length() > MAX_ITEM) return null;
        items.add(i.asString());
      }
      return List.copyOf(items);
    }
    return null;
  }

  /** Ajoute {@code key} et {@code params} au corps d'erreur quand le refus en porte de valides. */
  public static Map<String, Object> body(String code, String message, SQLException cause) {
    Map<String, Object> body = new LinkedHashMap<>();
    if (code != null) body.put("code", code);
    Keyed keyed = from(cause);
    if (keyed != null) {
      body.put("key", keyed.key());
      body.put("params", keyed.params());
    }
    body.put("error", message);
    return body;
  }
}
