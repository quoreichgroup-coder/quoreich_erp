package com.quoreich.qerp.tenant;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/**
 * Pose le contexte société sur chaque connexion, juste après son obtention.
 *
 * <p>C'est le point de passage unique : toute lecture ou écriture applicative
 * passe par une connexion de cette source, y compris celles ouvertes par
 * Hibernate. Poser le contexte à la main dans chaque service serait une
 * convention — et une convention s'oublie, en particulier dans du code écrit par
 * des agents. Ici, l'oubli est impossible : sans contexte, la revendication est
 * vide et la RLS ne renvoie rien.
 *
 * <h2>Pourquoi {@code set_config} et non {@code SET LOCAL}</h2>
 * La syntaxe {@code SET LOCAL request.jwt.claims = '...'} n'accepte pas de
 * paramètre lié : il faudrait concaténer du texte dans le SQL. PostgreSQL offre
 * l'équivalent paramétrable — {@code set_config(nom, valeur, is_local)} — dont le
 * troisième argument à {@code true} reproduit exactement la portée locale. La
 * valeur voyage donc en paramètre lié, jamais dans le texte de la requête.
 *
 * <h2>Pourquoi la portée locale est indispensable</h2>
 * Les connexions sont mutualisées. Un contexte posé au niveau de la session
 * ({@code is_local = false}) survivrait au retour de la connexion dans le pool et
 * serait servi à la société suivante. {@code SET LOCAL} disparaît au commit ou au
 * rollback — et HikariCP provoque un rollback au retour au pool.
 *
 * <h2>Pourquoi l'autocommit doit être désactivé</h2>
 * Hors transaction, PostgreSQL <em>ignore</em> {@code SET LOCAL} en émettant un
 * simple avertissement. La panne serait alors silencieuse : toutes les listes
 * seraient vides et rien n'indiquerait pourquoi. On échoue donc franchement.
 * {@code DatabaseSecurityGuard} vérifie la même propriété au démarrage, de sorte
 * que l'erreur apparaisse au lancement et non à la première requête.
 */
public class TenantAwareDataSource extends DelegatingDataSource {

  private static final String SET_CLAIMS =
      "SELECT set_config('request.jwt.claims', ?, true)";

  public TenantAwareDataSource(javax.sql.DataSource delegate) {
    super(delegate);
  }

  @Override
  public Connection getConnection() throws SQLException {
    return prepare(super.getConnection());
  }

  @Override
  public Connection getConnection(String username, String password) throws SQLException {
    return prepare(super.getConnection(username, password));
  }

  private Connection prepare(Connection connection) throws SQLException {
    try {
      applyClaims(connection);
      return connection;
    } catch (SQLException | RuntimeException e) {
      // Ne pas rendre au pool une connexion dont le contexte n'a pas pu être
      // posé : elle pourrait être réutilisée avec un contexte résiduel.
      try {
        connection.close();
      } catch (SQLException suppressed) {
        e.addSuppressed(suppressed);
      }
      throw e;
    }
  }

  private void applyClaims(Connection connection) throws SQLException {
    if (connection.getAutoCommit()) {
      throw new IllegalStateException(
          "Connexion en autocommit : `SET LOCAL` serait ignoré par PostgreSQL et la RLS "
              + "renverrait silencieusement zéro ligne. Réglez "
              + "spring.datasource.hikari.auto-commit sur false.");
    }
    try (PreparedStatement statement = connection.prepareStatement(SET_CLAIMS)) {
      statement.setString(1, claimsJson());
      statement.execute();
    }
  }

  /**
   * Revendications transmises à {@code auth.jwt()}.
   *
   * <p>Les deux valeurs sont des {@link UUID} : leur représentation textuelle est
   * la forme canonique à 36 caractères, sans guillemet ni antislash possible. Le
   * JSON ne peut donc pas être rompu par ces valeurs — et il est de toute façon
   * transmis en paramètre lié, pas concaténé dans la requête.
   *
   * <p>Sans contexte, on écrit {@code {}} plutôt que de ne rien écrire. Les deux
   * échouent fermé ({@code auth.uid()} vaut NULL), mais {@code {}} a l'avantage
   * d'écraser explicitement ce qu'une transaction précédente aurait pu laisser.
   */
  private String claimsJson() {
    return TenantContextHolder.current()
        .map(
            principal -> {
              StringBuilder json =
                  new StringBuilder(96)
                      .append("{\"sub\":\"")
                      .append(principal.userId())
                      .append("\",\"role\":\"authenticated\"");
              // Omis quand le jeton n'en porte pas : la politique RLS résout la
              // société depuis `profiles`, et écrire une valeur inventée ici
              // ferait croire à une revendication qui n'existe pas.
              if (principal.tenantId() != null) {
                json.append(",\"tenant_id\":\"").append(principal.tenantId()).append('"');
              }
              return json.append('}').toString();
            })
        .orElse("{}");
  }
}
