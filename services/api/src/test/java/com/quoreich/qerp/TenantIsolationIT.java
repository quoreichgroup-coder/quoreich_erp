package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quoreich.qerp.customer.CustomerQuery;
import com.quoreich.qerp.customer.CustomerView;
import com.quoreich.qerp.tenant.TenantContextHolder;
import com.quoreich.qerp.tenant.TenantPrincipal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Recette négative d'isolation, jouée par le chemin applicatif réel.
 *
 * <h2>Pourquoi passer par {@link CustomerQuery} et non par du SQL direct</h2>
 * Le script {@code verify-lot0.sh} prouve déjà l'isolation en {@code psql}, avec
 * {@code SET LOCAL ROLE qerp_api}. Ce test-ci prouve autre chose, et c'est ce qui
 * manquait : que <em>l'application</em> pose le contexte correctement. Une
 * écriture juste dans {@code TenantAwareDataSource} mais jamais déclenchée, ou
 * déclenchée avec des revendications mal formées, passerait le test {@code psql}
 * et échouerait ici.
 *
 * <p>La requête testée ne filtre pas par société : elle demande simplement
 * {@code SELECT id, name, status FROM customers}. Le périmètre vient donc
 * entièrement de la RLS, ce qui est exactement l'invariant à vérifier.
 */
@SpringBootTest
class TenantIsolationIT {

  private static final String DATABASE = "qerp_it_isolation";

  private static final UUID ALPHA_USER = UUID.fromString(PostgresFixture.ALPHA_USER);
  private static final UUID BETA_USER = UUID.fromString(PostgresFixture.BETA_USER);
  private static final UUID ALPHA_TENANT = UUID.fromString(PostgresFixture.ALPHA_TENANT);
  private static final UUID BETA_TENANT = UUID.fromString(PostgresFixture.BETA_TENANT);

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private CustomerQuery customerQuery;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private TransactionTemplate transactionTemplate;

  @BeforeEach
  void chargerLeJeuDeRecette() {
    // Chargé ici et non dans @DynamicPropertySource : les migrations tournent
    // pendant le rafraîchissement du contexte, donc après cette méthode-là.
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
  }

  @AfterEach
  void viderLeContexte() {
    TenantContextHolder.clear();
  }

  @Test
  @DisplayName("sans contexte de session, aucune ligne n'est visible — la RLS échoue fermée")
  void sansContexteAucuneLigneNestVisible() {
    assertThat(customerQuery.findVisible()).isEmpty();
  }

  @Test
  @DisplayName("un utilisateur d'Alpha ne voit que les clients d'Alpha")
  void unUtilisateurDAlphaNeVoisQueLesClientsDAlpha() {
    avecContexte(ALPHA_USER, ALPHA_TENANT);

    List<CustomerView> clients = customerQuery.findVisible();

    assertThat(clients).hasSize(3);
    assertThat(clients).allMatch(client -> client.name().startsWith("Client Alpha"));
  }

  @Test
  @DisplayName("un utilisateur de Beta ne voit que les clients de Beta — contrôle symétrique")
  void unUtilisateurDeBetaNeVoisQueLesClientsDeBeta() {
    avecContexte(BETA_USER, BETA_TENANT);

    List<CustomerView> clients = customerQuery.findVisible();

    assertThat(clients).hasSize(5);
    assertThat(clients).allMatch(client -> client.name().startsWith("Client Beta"));
  }

  @Test
  @DisplayName("la société revendiquée par le jeton n'élargit pas le périmètre")
  void laSocieteRevendiqueeParLeJetonNElargitPasLePerimetre() {
    // L'utilisateur Alpha revendique la société Beta. La politique RLS s'écrit
    // `tenant_id = get_user_tenant_id(auth.uid())` : elle résout la société
    // depuis `profiles`, pas depuis le jeton. La revendication est donc sans
    // effet — et c'est le comportement voulu : le client ne choisit pas son
    // périmètre.
    avecContexte(ALPHA_USER, BETA_TENANT);

    List<CustomerView> clients = customerQuery.findVisible();

    assertThat(clients).hasSize(3);
    assertThat(clients).allMatch(client -> client.name().startsWith("Client Alpha"));
  }

  @Test
  @DisplayName("modifier une autre société n'affecte aucune ligne, et rien n'est écrit")
  void modifierUneAutreSocieteNAffecteAucuneLigne() {
    avecContexte(ALPHA_USER, ALPHA_TENANT);

    Integer lignesModifiees =
        transactionTemplate.execute(
            status ->
                jdbc.update(
                    "UPDATE customers SET name = ? WHERE tenant_id = ?",
                    "INTRUSION",
                    BETA_TENANT));

    assertThat(lignesModifiees).isZero();
    // Vérifié sous le rôle propriétaire : une observation faite sous qerp_api
    // serait aveugle précisément aux lignes qu'on cherche à détecter. Et la
    // transaction est validée, donc l'absence de ligne ne doit rien au rollback.
    assertThat(compterCommeAdministrateur("SELECT count(*) FROM customers WHERE name = 'INTRUSION'"))
        .isZero();
  }

  @Test
  @DisplayName("insérer dans une autre société est refusé sans effet partiel")
  void insererDansUneAutreSocieteEstRefuse() {
    avecContexte(ALPHA_USER, ALPHA_TENANT);

    assertThatThrownBy(
            () ->
                transactionTemplate.execute(
                    status ->
                        jdbc.update(
                            "INSERT INTO customers (tenant_id, name) VALUES (?, ?)",
                            BETA_TENANT,
                            "INTRUSION")))
        .isInstanceOf(DataAccessException.class);

    assertThat(compterCommeAdministrateur("SELECT count(*) FROM customers WHERE name = 'INTRUSION'"))
        .as("aucune ligne ne doit subsister : le refus est sans effet partiel")
        .isZero();
    assertThat(compterCommeAdministrateur("SELECT count(*) FROM customers"))
        .as("le jeu de recette reste intact : 3 clients Alpha + 5 Beta")
        .isEqualTo(8);
  }

  private void avecContexte(UUID utilisateur, UUID societe) {
    TenantContextHolder.set(new TenantPrincipal(utilisateur, societe));
  }

  private long compterCommeAdministrateur(String sql) {
    return PostgresFixture.countAsAdmin(DATABASE, sql);
  }
}
