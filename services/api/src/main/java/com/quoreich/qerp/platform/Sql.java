package com.quoreich.qerp.platform;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.NullNode;

/**
 * Accès SQL commun des modules portés sur l'API (lots 3 à 5).
 *
 * <p>Toute requête passe par la source de données de l'application : le contexte société (RLS) est
 * posé sur chaque connexion, si bien que les droits, gardes et refus sont exactement ceux du chemin
 * Supabase. Les résultats sont sérialisés par PostgreSQL ({@code to_jsonb}) : dates, nombres et
 * horodatages ont la même forme que les réponses PostgREST, et les écrans lisent la même chose
 * quel que soit le déploiement.
 *
 * <p>Aucun identifiant SQL ne vient du client : tables, colonnes autorisées et fonctions sont des
 * constantes des modules ; les valeurs voyagent en paramètres liés, typés par le catalogue.
 * La colonne {@code tenant_id} n'est jamais acceptée du client : elle est posée par le serveur.
 */
@Repository
public class Sql {

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Pattern IDENT = Pattern.compile("^[a-z_][a-z0-9_]*$");
  private static final String TENANT = "public.get_user_tenant_id(auth.uid())";

  private record Column(String type, boolean array) {}

  private record Fn(String signature, boolean set, boolean isVoid, boolean composite, List<String> names, List<String> types, int required) {}

  private final JdbcTemplate jdbc;
  private final Map<String, Map<String, Column>> tables = new ConcurrentHashMap<>();
  private final Map<String, List<Fn>> functions = new ConcurrentHashMap<>();

  public Sql(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  // ─── Lectures ───

  /** Lignes d'une requête, en tableau JSON (vide si rien). */
  @Transactional(readOnly = true)
  public JsonNode list(String sql, Object... args) {
    return json(jdbc.queryForObject(
        "SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM (" + sql + ") q", String.class, args));
  }

  /** Première ligne d'une requête, ou {@code null} JSON. */
  @Transactional(readOnly = true)
  public JsonNode one(String sql, Object... args) {
    List<String> rows = jdbc.queryForList("SELECT to_jsonb(q)::text FROM (" + sql + ") q LIMIT 1", String.class, args);
    return rows.isEmpty() ? NullNode.getInstance() : json(rows.getFirst());
  }

  /** Valeur scalaire (compte, total). */
  @Transactional(readOnly = true)
  public <T> T value(Class<T> type, String sql, Object... args) {
    return jdbc.queryForObject(sql, type, args);
  }

  // ─── Écritures sous RLS ───

  /** Insère une ligne ; seules les colonnes autorisées du corps sont écrites ; la société est posée par le serveur. */
  @Transactional
  public JsonNode insert(String table, Map<String, Object> body, Set<String> allowed) {
    return insert(table, body, allowed, Map.of());
  }

  /**
   * Variante avec des colonnes posées par le serveur : {@code server} associe une colonne à une
   * expression SQL constante du module (ex. {@code "created_by" -> "auth.uid()"}), jamais au client.
   */
  @Transactional
  public JsonNode insert(String table, Map<String, Object> body, Set<String> allowed, Map<String, String> server) {
    return json(jdbc.queryForObject(insertSql(table, body, allowed, null, server), String.class, values(table, body, allowed, server)));
  }

  /** Insère ou met à jour sur conflit (colonnes de conflit = clé d'unicité de la table). */
  @Transactional
  public JsonNode upsert(String table, Map<String, Object> body, Set<String> allowed, List<String> conflict) {
    return json(jdbc.queryForObject(insertSql(table, body, allowed, conflict, Map.of()), String.class, values(table, body, allowed, Map.of())));
  }

  /** Upsert avec colonnes posées par le serveur (ex. {@code user_id -> auth.uid()} pour une ligne propre à l'utilisateur). */
  @Transactional
  public JsonNode upsertWith(String table, Map<String, Object> body, Set<String> allowed, List<String> conflict, Map<String, String> server) {
    return json(jdbc.queryForObject(insertSql(table, body, allowed, conflict, server), String.class, values(table, body, allowed, server)));
  }

  /** Insère plusieurs lignes dans la même transaction. */
  @Transactional
  public JsonNode insertAll(String table, Collection<Map<String, Object>> rows, Set<String> allowed) {
    List<JsonNode> out = new ArrayList<>();
    for (Map<String, Object> r : rows) out.add(insert(table, r, allowed));
    return JSON.valueToTree(out);
  }

  /** Met à jour une ligne par son id ; zéro ligne touchée (RLS ou id inconnu) est un refus explicite. */
  @Transactional
  public JsonNode update(String table, UUID id, Map<String, Object> body, Set<String> allowed) {
    return updateWhere(table, body, allowed, "id = ?::uuid", id.toString());
  }

  /** Met à jour les lignes répondant à une condition écrite par le module (jamais par le client). */
  @Transactional
  public JsonNode updateWhere(String table, Map<String, Object> body, Set<String> allowed, String where, Object... whereArgs) {
    Map<String, Column> cols = columns(table);
    List<String> sets = new ArrayList<>();
    List<Object> args = new ArrayList<>();
    for (Map.Entry<String, Object> e : body.entrySet()) {
      String c = e.getKey();
      if (!allowed.contains(c) || !cols.containsKey(c) || c.equals("tenant_id")) continue;
      sets.add(c + " = " + cast(cols.get(c), e.getValue()));
      args.add(bind(e.getValue()));
    }
    if (sets.isEmpty()) throw new ApiRefusal(422, "Aucune donnée modifiable fournie");
    args.addAll(List.of(whereArgs));
    List<String> rows = jdbc.queryForList(
        "WITH u AS (UPDATE public." + ident(table) + " t SET " + String.join(", ", sets) + " WHERE " + where
            + " RETURNING t.*) SELECT to_jsonb(u)::text FROM u", String.class, args.toArray());
    if (rows.isEmpty()) throw ApiRefusal.untouched();
    return rows.size() == 1 ? json(rows.getFirst()) : JSON.valueToTree(rows.stream().map(Sql::json).toList());
  }

  /** Supprime une ligne par son id ; zéro ligne supprimée est un refus explicite. */
  @Transactional
  public void delete(String table, UUID id) {
    deleteWhere(table, "id = ?::uuid", id.toString());
  }

  /** Supprime sans exiger de ligne (remplacement d'un ensemble : lignes, sections). */
  @Transactional
  public int deleteWhereAny(String table, String where, Object... args) {
    return jdbc.update("DELETE FROM public." + ident(table) + " WHERE " + where, args);
  }

  @Transactional
  public int deleteWhere(String table, String where, Object... args) {
    int n = jdbc.update("DELETE FROM public." + ident(table) + " WHERE " + where, args);
    if (n == 0) throw ApiRefusal.untouched();
    return n;
  }

  // ─── Fonctions de la base ───

  /**
   * Appelle une fonction {@code public.<nom>} en notation nommée, chaque argument typé par le catalogue.
   * Résultat : tableau pour une fonction ensembliste, objet pour un enregistrement, valeur sinon, null pour void.
   */
  @Transactional
  public JsonNode call(String function, Map<String, Object> args) {
    Fn fn = resolve(function, args.keySet());
    List<String> parts = new ArrayList<>();
    List<Object> binds = new ArrayList<>();
    for (int i = 0; i < fn.names().size(); i++) {
      String name = fn.names().get(i);
      if (!args.containsKey(name)) continue;
      Object v = args.get(name);
      parts.add(name + " => " + cast(new Column(fn.types().get(i), fn.types().get(i).endsWith("[]")), v));
      binds.add(bind(v));
    }
    String invoke = "public." + ident(function) + "(" + String.join(", ", parts) + ")";
    if (fn.isVoid()) {
      jdbc.queryForList("SELECT 1 FROM (SELECT " + invoke + ") v", binds.toArray());
      return NullNode.getInstance();
    }
    String sql = fn.set()
        ? "SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)::text FROM " + invoke + " r"
        : fn.composite() ? "SELECT to_jsonb(r)::text FROM " + invoke + " r" : "SELECT to_jsonb(" + invoke + ")::text";
    List<String> out = jdbc.queryForList(sql, String.class, binds.toArray());
    return out.isEmpty() || out.getFirst() == null ? NullNode.getInstance() : json(out.getFirst());
  }

  /** Variante sans argument. */
  @Transactional
  public JsonNode call(String function) {
    return call(function, Map.of());
  }

  /** Construit une table d'arguments en tolérant les valeurs nulles (Map.of les refuse). */
  public static Map<String, Object> args(Object... keyValues) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < keyValues.length; i += 2) m.put((String) keyValues[i], keyValues[i + 1]);
    return m;
  }

  // ─── Outils ───

  private String insertSql(String table, Map<String, Object> body, Set<String> allowed, List<String> conflict, Map<String, String> server) {
    Map<String, Column> cols = columns(table);
    List<String> names = new ArrayList<>();
    List<String> exprs = new ArrayList<>();
    for (Map.Entry<String, Object> e : body.entrySet()) {
      String c = e.getKey();
      if (!writable(c, allowed, cols, server)) continue;
      names.add(c);
      exprs.add(cast(cols.get(c), e.getValue()));
    }
    for (Map.Entry<String, String> e : server.entrySet()) {
      names.add(ident(e.getKey()));
      exprs.add(e.getValue());
    }
    if (cols.containsKey("tenant_id")) {
      names.add("tenant_id");
      exprs.add(TENANT);
    }
    String sql = "INSERT INTO public." + ident(table) + " AS t (" + String.join(", ", names) + ") VALUES (" + String.join(", ", exprs) + ")";
    if (conflict != null) {
      List<String> upd = names.stream().filter(n -> !conflict.contains(n) && !n.equals("tenant_id")).map(n -> n + " = EXCLUDED." + n).toList();
      sql += " ON CONFLICT (" + String.join(", ", conflict.stream().map(Sql::ident).toList()) + ") DO "
          + (upd.isEmpty() ? "NOTHING" : "UPDATE SET " + String.join(", ", upd));
    }
    return "WITH i AS (" + sql + " RETURNING t.*) SELECT to_jsonb(i)::text FROM i";
  }

  private Object[] values(String table, Map<String, Object> body, Set<String> allowed, Map<String, String> server) {
    Map<String, Column> cols = columns(table);
    List<Object> out = new ArrayList<>();
    for (Map.Entry<String, Object> e : body.entrySet()) {
      if (writable(e.getKey(), allowed, cols, server)) out.add(bind(e.getValue()));
    }
    return out.toArray();
  }

  private static boolean writable(String c, Set<String> allowed, Map<String, Column> cols, Map<String, String> server) {
    return allowed.contains(c) && cols.containsKey(c) && !c.equals("tenant_id") && !server.containsKey(c);
  }

  private static String cast(Column c, Object value) {
    if (c.array()) {
      String base = c.type();
      return value == null ? "NULL::" + base : "ARRAY(SELECT jsonb_array_elements_text(?::jsonb))::" + base;
    }
    if (c.type().equals("jsonb") || c.type().equals("json")) return "?::" + c.type();
    return "?::" + c.type();
  }

  private static Object bind(Object v) {
    if (v == null) return null;
    if (v instanceof Map<?, ?> || v instanceof List<?> || v instanceof JsonNode) return JSON.writeValueAsString(v);
    return v.toString();
  }

  private Map<String, Column> columns(String table) {
    return tables.computeIfAbsent(ident(table), t -> {
      Map<String, Column> m = new LinkedHashMap<>();
      jdbc.query("SELECT a.attname, format_type(a.atttypid, a.atttypmod), ty.typcategory = 'A'"
              + " FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid"
              + " WHERE a.attrelid = ('public.' || ?)::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''",
          rs -> { m.put(rs.getString(1), new Column(rs.getString(2), rs.getBoolean(3))); }, t);
      if (m.isEmpty()) throw new IllegalStateException("Table inconnue : " + t);
      return m;
    });
  }

  private Fn resolve(String function, Set<String> given) {
    List<Fn> candidates = functions.computeIfAbsent(ident(function), f -> jdbc.query(
        "SELECT p.oid::regprocedure::text, p.proretset, p.prorettype = 'void'::regtype,"
            + " (t.typtype = 'c' OR p.prorettype = 'record'::regtype),"
            + " coalesce(p.proargnames, '{}'::text[]), coalesce(p.proargmodes::text[], '{}'::text[]),"
            + " array(SELECT format_type(x, NULL) FROM unnest(p.proargtypes) x), p.pronargs, p.pronargdefaults"
            + " FROM pg_proc p JOIN pg_type t ON t.oid = p.prorettype"
            + " WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ?",
        (rs, i) -> {
          List<String> allNames = List.of((String[]) rs.getArray(5).getArray());
          List<String> modes = List.of((String[]) rs.getArray(6).getArray());
          List<String> names = new ArrayList<>();
          for (int k = 0; k < allNames.size(); k++) {
            if (modes.isEmpty() || Set.of("i", "b", "v").contains(modes.get(k))) names.add(allNames.get(k));
          }
          List<String> types = List.of((String[]) rs.getArray(7).getArray());
          return new Fn(rs.getString(1), rs.getBoolean(2), rs.getBoolean(3), rs.getBoolean(4),
              names.subList(0, Math.min(names.size(), types.size())), types, rs.getInt(8) - rs.getInt(9));
        }, f));
    Fn best = null;
    for (Fn fn : candidates) {
      if (!fn.names().containsAll(given)) continue;
      boolean ok = true;
      for (int k = 0; k < fn.required(); k++) if (!given.contains(fn.names().get(k))) ok = false;
      if (ok && (best == null || fn.names().size() < best.names().size())) best = fn;
    }
    if (best == null) throw new IllegalStateException("Aucune fonction " + function + " pour les arguments " + given);
    return best;
  }

  private static String ident(String s) {
    if (!IDENT.matcher(s).matches()) throw new IllegalArgumentException("Identifiant SQL invalide : " + s);
    return s;
  }

  private static JsonNode json(String s) {
    return s == null ? NullNode.getInstance() : JSON.readTree(s);
  }
}
