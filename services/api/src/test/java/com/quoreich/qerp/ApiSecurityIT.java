package com.quoreich.qerp;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.web.CorrelationIdFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import com.quoreich.qerp.tenant.TenantContextHolder;

/**
 * Critère de sortie du lot 1, au niveau HTTP.
 *
 * <p>« Une requête authentifiée renvoie des données filtrées par société, et la
 * recette négative est refusée côté serveur. » Le jeton est fabriqué par
 * {@code jwt()} de Spring Security Test : seule la signature de l'émetteur est
 * simulée, toute la chaîne d'autorisation, le filtre de contexte et la RLS sont
 * ceux de production. C'est ce qui rend ce test concluant sans déployer Keycloak.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiSecurityIT {

  private static final String DATABASE = "qerp_it_api";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;

  @BeforeEach
  void chargerLeJeuDeRecette() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    TenantContextHolder.clear();
  }

  @Test
  @DisplayName("une requête sans jeton est refusée en 401")
  void uneRequeteSansJetonEstRefusee() throws Exception {
    mockMvc.perform(get("/api/v1/customers")).andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("une requête authentifiée ne renvoie que les clients de la société du porteur")
  void uneRequeteAuthentifieeNeRenvoieQueSaSociete() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/customers")
                .with(
                    jwt()
                        .jwt(
                            builder ->
                                builder
                                    .subject(PostgresFixture.ALPHA_USER)
                                    .claim("tenant_id", PostgresFixture.ALPHA_TENANT))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(3)))
        .andExpect(jsonPath("$[0].name").value(org.hamcrest.Matchers.startsWith("Client Alpha")));
  }

  @Test
  @DisplayName("le second porteur ne voit que sa propre société — la recette négative est refusée côté serveur")
  void lAutreSocieteNVoitQueSesPropresDonnees() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/customers")
                .with(
                    jwt()
                        .jwt(
                            builder ->
                                builder
                                    .subject(PostgresFixture.BETA_USER)
                                    .claim("tenant_id", PostgresFixture.BETA_TENANT))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(5)))
        .andExpect(jsonPath("$[0].name").value(org.hamcrest.Matchers.startsWith("Client Beta")));
  }

  @Test
  @DisplayName("un jeton dont le porteur n'est pas un UUID est refusé en 403, sans lister de données vides")
  void unJetonSansIdentifiantExploitableEstRefuse() throws Exception {
    mockMvc
        .perform(get("/api/v1/customers").with(jwt().jwt(builder -> builder.subject("pas-un-uuid"))))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("un jeton sans revendication société est accepté : la RLS résout la société depuis profiles")
  void unJetonSansRevendicationSocieteEstAccepte() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/customers")
                .with(jwt().jwt(builder -> builder.subject(PostgresFixture.ALPHA_USER))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(3)));
  }

  @Test
  @DisplayName("un jeton dont la revendication société est illisible est refusé en 403")
  void uneRevendicationSocieteIllisibleEstRefusee() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/customers")
                .with(
                    jwt()
                        .jwt(
                            builder ->
                                builder
                                    .subject(PostgresFixture.ALPHA_USER)
                                    .claim("tenant_id", "pas-un-uuid"))))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("la sonde de vivacité répond sans authentification")
  void laSondeDeVivaciteEstPublique() throws Exception {
    mockMvc.perform(get("/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
  }

  @Test
  @DisplayName("l'identifiant de corrélation fourni est repris tel quel")
  void lIdentifiantDeCorrelationEstRepris() throws Exception {
    mockMvc
        .perform(get("/health").header(CorrelationIdFilter.HEADER, "recette-0001"))
        .andExpect(status().isOk())
        .andExpect(header().string(CorrelationIdFilter.HEADER, "recette-0001"));
  }

  @Test
  @DisplayName("un identifiant de corrélation non conforme est remplacé, jamais recopié dans les journaux")
  void unIdentifiantDeCorrelationNonConformeEstRemplace() throws Exception {
    // Un en-tête client recopié brut dans les journaux permet d'y écrire des
    // événements forgés. La forme est contrainte ; tout le reste est remplacé.
    String hostile = "court x; injection";

    mockMvc
        .perform(get("/health").header(CorrelationIdFilter.HEADER, hostile))
        .andExpect(status().isOk())
        .andExpect(header().string(CorrelationIdFilter.HEADER, not(hostile)));
  }
}
