package com.quoreich.qerp;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * PostgreSQL 18.6 jetable partagé par les tests d'intégration.
 *
 * <h2>Un seul conteneur, une base par classe de test</h2>
 * Chaque classe de test travaille dans sa propre base. C'est ce qui permet à
 * {@code SchemaMigrationIT} de vérifier une reconstruction depuis le vide pendant
 * que {@code TenantIsolationIT} travaille sur un schéma déjà peuplé, sans que
 * l'ordre d'exécution des classes change le résultat.
 *
 * <h2>Deux rôles, comme en production</h2>
 * Les migrations tournent sous le rôle d'administration (le « propriétaire »), et
 * l'application se connecte sous {@code qerp_api}, non propriétaire et membre de
 * {@code authenticated}. C'est la seule façon de tester la RLS : si les deux
 * rôles étaient confondus, le propriétaire contournerait les 157 politiques — les
 * tables ne sont pas en {@code FORCE ROW LEVEL SECURITY} — et tous les tests
 * d'isolation passeraient au vert en ne prouvant rien.
 */
public final class PostgresFixture {

  // Jetons de recette d'un conteneur jetable, créé et détruit par la suite de
  // tests, sans réseau entrant hors de la machine locale. Ce ne sont pas des
  // secrets : ils ne donnent accès à aucune donnée réelle, et les remplacer par
  // une variable d'environnement rendrait la suite impossible à lancer sur un
  // poste vierge. Le mot de passe de production, lui, n'existe nulle part dans le
  // dépôt — `application.yml` ne lit que `${QERP_DB_PASSWORD:}`, sans valeur par
  // défaut utilisable.
  public static final String ADMIN_USER = "postgres";
  public static final String ADMIN_PASSWORD = "postgres";
  public static final String API_USER = "qerp_api";
  public static final String API_PASSWORD = "qerp_api_test";

  /** Société et utilisateurs du jeu de recette, figés dans les fixtures. */
  public static final String ALPHA_TENANT = "11111111-1111-1111-1111-111111111111";
  public static final String BETA_TENANT = "22222222-2222-2222-2222-222222222222";
  public static final String ALPHA_USER = "aaaaaaaa-0000-0000-0000-000000000001";
  public static final String BETA_USER = "bbbbbbbb-0000-0000-0000-000000000002";

  private static final PostgreSQLContainer CONTAINER;
  private static final Set<String> LOADED_DATABASES = new HashSet<>();

  static {
    PostgreSQLContainer container =
        new PostgreSQLContainer(DockerImageName.parse("postgres:18.6-alpine"))
            .withDatabaseName("qerp_bootstrap")
            .withUsername(ADMIN_USER)
            .withPassword(ADMIN_PASSWORD)
            // Marge au-delà des 100 connexions par défaut : chaque classe d'IT garde son
            // contexte Spring en cache, donc son pool, jusqu'à la fin du lancement.
            .withCommand("postgres", "-c", "max_connections=200");
    container.start();
    Runtime.getRuntime().addShutdownHook(new Thread(container::stop, "qerp-postgres-stop"));
    CONTAINER = container;
    provisionApiRole();
  }

  private PostgresFixture() {}

  /**
   * Alimente Spring avec une base neuve et les deux rôles.
   *
   * <p>À appeler depuis {@code @DynamicPropertySource} : la méthode s'exécute
   * avant la création du contexte, donc avant que Flyway ne tourne et avant que
   * la source applicative ne prenne sa première connexion.
   */
  public static void configureContext(String databaseName, DynamicPropertyRegistry registry) {
    createDatabase(databaseName);

    // L'application : rôle non privilégié, c'est lui qui subit la RLS.
    registry.add("spring.datasource.url", () -> urlOf(databaseName));
    registry.add("spring.datasource.username", () -> API_USER);
    registry.add("spring.datasource.password", () -> API_PASSWORD);
    // Pool réduit : les tests s'exécutent un par un, et le cache de contextes de Spring
    // garde un pool par classe d'IT. À 10 connexions par pool (défaut de l'application),
    // 13 classes épuisaient les 100 connexions du conteneur : « remaining connection
    // slots are reserved for roles with the SUPERUSER attribute ».
    registry.add("spring.datasource.hikari.maximum-pool-size", () -> 3);
    registry.add("spring.datasource.hikari.minimum-idle", () -> 1);
    // Les migrations : rôle propriétaire, distinct. Spring Boot fabrique pour
    // Flyway une seconde source de données à partir de ces trois propriétés.
    registry.add("spring.flyway.url", () -> urlOf(databaseName));
    registry.add("spring.flyway.user", () -> ADMIN_USER);
    registry.add("spring.flyway.password", () -> ADMIN_PASSWORD);
  }

  public static String urlOf(String databaseName) {
    String base = CONTAINER.getJdbcUrl();
    int query = base.indexOf('?');
    String withoutQuery = query < 0 ? base : base.substring(0, query);
    String url = withoutQuery.substring(0, withoutQuery.lastIndexOf('/') + 1) + databaseName;
    return query < 0 ? url : url + base.substring(query);
  }

  /**
   * Charge le jeu de recette une seule fois par base.
   *
   * <p>Il doit être chargé <em>après</em> les migrations, qui s'exécutent pendant
   * le rafraîchissement du contexte — donc pas depuis {@code @DynamicPropertySource}.
   * Et il doit être chargé sous le rôle propriétaire : les 157 politiques
   * empêcheraient {@code qerp_api} d'insérer des lignes qu'aucun jeton ne lui
   * rattache.
   */
  public static synchronized void loadReferenceDatasetOnce(String databaseName) {
    if (LOADED_DATABASES.add(databaseName)) {
      execute(urlOf(databaseName), readClasspath("fixtures/reference-dataset.sql"));
      // Numérotation automatique (V22) coupée pour les sociétés de recette : les tests
      // désignent leurs factures par numéro. NumerotationFacturesIT la rallume et la teste.
      execute(urlOf(databaseName), "UPDATE ar_general_settings SET auto_numbering = false");
    }
  }

  /**
   * Exécute une requête sous le rôle d'administration.
   *
   * <p>Sert à observer l'état réel de la base <em>sans</em> passer par la RLS.
   * C'est indispensable pour vérifier l'absence d'effet partiel : une vérification
   * faite sous {@code qerp_api} serait aveugle précisément aux lignes qu'on
   * chercherait à détecter.
   */
  public static long countAsAdmin(String databaseName, String sql) {
    try (Connection connection = DriverManager.getConnection(urlOf(databaseName), ADMIN_USER, ADMIN_PASSWORD);
        Statement statement = connection.createStatement();
        ResultSet resultSet = statement.executeQuery(sql)) {
      resultSet.next();
      return resultSet.getLong(1);
    } catch (SQLException e) {
      throw new IllegalStateException("Requête d'observation échouée : " + sql, e);
    }
  }

  /**
   * Applique le référentiel SYSCOHADA révisé à une société, en propriétaire, comme le fait
   * l'administrateur via {@code apply_accounting_framework()}. Idempotent.
   */
  public static void applySyscohada(String databaseName, String tenantId) {
    execute(
        urlOf(databaseName),
        "SELECT public.apply_accounting_framework_to('"
            + tenantId
            + "', 'SYSCOHADA_REVISE', NULL)");
  }

  public static void execute(String url, String sql) {
    try (Connection connection = DriverManager.getConnection(url, ADMIN_USER, ADMIN_PASSWORD);
        Statement statement = connection.createStatement()) {
      statement.execute(sql);
    } catch (SQLException e) {
      throw new IllegalStateException("Échec SQL : " + e.getMessage(), e);
    }
  }

  private static void createDatabase(String databaseName) {
    // Le nom vient d'une constante de test, jamais d'une entrée externe : il
    // n'est pas paramétrable (CREATE DATABASE n'accepte pas de paramètre lié).
    execute(CONTAINER.getJdbcUrl(), "CREATE DATABASE " + databaseName);
  }

  /**
   * Dote {@code qerp_api} de la capacité de connexion.
   *
   * <p>V1 crée ce rôle en {@code NOLOGIN} : personne ne s'y connecte depuis le
   * schéma, et c'est voulu — un mot de passe n'a rien à faire dans une migration
   * versionnée. La capacité de connexion est un geste de déploiement ; le test
   * reproduit ce geste. Le rôle est créé ici plutôt qu'attendu de V1, car les
   * rôles PostgreSQL sont globaux au cluster et la source applicative doit
   * pouvoir se connecter avant que Flyway n'ait tourné dans cette base.
   */
  private static void provisionApiRole() {
    execute(
        CONTAINER.getJdbcUrl(),
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qerp_api') THEN
            CREATE ROLE qerp_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
          END IF;
        END $$;
        ALTER ROLE qerp_api LOGIN PASSWORD '"""
            + API_PASSWORD
            + "';");
  }

  private static String readClasspath(String path) {
    try (InputStream stream = new ClassPathResource(path).getInputStream()) {
      return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Ressource de test illisible : " + path, e);
    }
  }
}
