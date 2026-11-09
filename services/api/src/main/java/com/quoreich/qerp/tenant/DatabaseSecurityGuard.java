package com.quoreich.qerp.tenant;

import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Refuse de démarrer si la connexion applicative peut contourner la RLS.
 *
 * <h2>Le défaut que ce garde-fou ferme</h2>
 * Les 105 tables du schéma public ne sont pas en {@code FORCE ROW LEVEL
 * SECURITY}. PostgreSQL exempte donc le <em>propriétaire</em> de la table, et les
 * superutilisateurs contournent la RLS par nature. Une API connectée avec le
 * mauvais rôle lirait et écrirait toutes les sociétés, tout en passant
 * l'intégralité des tests unitaires : les politiques existent, elles ne
 * s'appliquent simplement pas.
 *
 * <p>C'est une panne silencieuse, et c'est la plus grave du projet. Elle est donc
 * transformée en refus de démarrage. Le contrôle s'exécute après les migrations
 * Flyway, qui sont la première chose à créer des tables.
 */
@Component
public class DatabaseSecurityGuard implements ApplicationRunner, Ordered {

  private static final Logger log = LoggerFactory.getLogger(DatabaseSecurityGuard.class);

  /**
   * Un seul aller-retour pour les cinq contrôles.
   *
   * <p>{@code rolsuper} et {@code rolbypassrls} sont testés tous les deux :
   * l'attribut {@code BYPASSRLS} est révocable, pas la superuser — un rôle
   * superutilisateur afficherait donc {@code rolbypassrls = false} tout en
   * ignorant la RLS.
   */
  private static final String AUDIT_SQL =
      """
      SELECT current_user                                                    AS connected_as,
             (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS is_superuser,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
             pg_has_role(current_user, 'authenticated', 'MEMBER')             AS is_authenticated,
             (SELECT count(*)
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relkind IN ('r', 'p')
                 AND pg_get_userbyid(c.relowner) = current_user)              AS owned_tables
      """;

  private final DataSource dataSource;

  public DatabaseSecurityGuard(DataSource dataSource) {
    this.dataSource = dataSource;
  }

  @Override
  public int getOrder() {
    // Après les migrations Flyway, qui s'exécutent pendant le rafraîchissement
    // du contexte ; avant tout traitement de requête.
    return Ordered.LOWEST_PRECEDENCE - 1000;
  }

  @Override
  public void run(ApplicationArguments args) {
    // Si la source n'est pas enveloppée, aucune requête ne porte de contexte
    // société et la RLS renverrait zéro ligne partout — panne silencieuse et
    // difficile à relier à sa cause. On refuse de démarrer.
    if (!(dataSource instanceof TenantAwareDataSource)) {
      throw new IllegalStateException(
          "La source de données applicative n'est pas enveloppée par TenantAwareDataSource : "
              + "aucune requête ne porterait le contexte société. Vérifiez que le bean « dataSource » "
              + "existe toujours sous ce nom.");
    }

    JdbcTemplate jdbc = new JdbcTemplate(dataSource);

    Integer serverVersion = jdbc.queryForObject("SELECT current_setting('server_version_num')::int", Integer.class);
    if (serverVersion == null || serverVersion < 180000) {
      log.warn(
          "PostgreSQL {} détecté : le schéma du lot 0 a été prouvé sur 18.6.", serverVersion);
    }

    ConnectionAudit audit =
        jdbc.queryForObject(
            AUDIT_SQL,
            (rs, rowNum) ->
                new ConnectionAudit(
                    rs.getString("connected_as"),
                    rs.getBoolean("is_superuser"),
                    rs.getBoolean("bypasses_rls"),
                    rs.getBoolean("is_authenticated"),
                    rs.getLong("owned_tables")));

    if (audit == null) {
      throw new IllegalStateException("Audit de la connexion applicative sans résultat.");
    }
    audit.requireRlsEffective();

    log.info(
        "Connexion applicative « {} » : non propriétaire, sans BYPASSRLS, membre de authenticated"
            + " — les 157 politiques RLS sont effectives.",
        audit.connectedAs());
  }

  /**
   * Constat d'audit d'une connexion, et verdict associé.
   *
   * <p>Le verdict vit ici, séparé de la lecture en base, pour être éprouvable
   * sans conteneur : chaque façon de contourner la RLS se teste en construisant
   * la valeur correspondante.
   */
  public record ConnectionAudit(
      String connectedAs,
      boolean superuser,
      boolean bypassesRls,
      boolean isAuthenticated,
      long ownedTables) {

    /** Lève une exception explicite si cette connexion peut ignorer la RLS. */
    public void requireRlsEffective() {
      if (superuser || bypassesRls) {
        throw new IllegalStateException(
            "Le rôle applicatif « "
                + connectedAs
                + " » est superutilisateur ou porte BYPASSRLS : les 157 politiques RLS seraient"
                + " ignorées. Connectez l'API avec un rôle non privilégié (qerp_api).");
      }
      if (ownedTables > 0) {
        throw new IllegalStateException(
            "Le rôle applicatif « "
                + connectedAs
                + " » est propriétaire de "
                + ownedTables
                + " table(s) du schéma public. Les tables ne sont pas en FORCE ROW LEVEL SECURITY :"
                + " un propriétaire contourne la RLS. Appliquez les migrations avec un rôle dédié"
                + " (qerp_migrate) et connectez l'API avec un autre (qerp_api).");
      }
      if (!isAuthenticated) {
        throw new IllegalStateException(
            "Le rôle applicatif « "
                + connectedAs
                + " » n'est pas membre de « authenticated » : les 152 politiques qui ciblent ce rôle"
                + " ne s'appliqueraient pas.");
      }
    }
  }
}
