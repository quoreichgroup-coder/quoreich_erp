package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Fige le contrat OpenAPI et refuse toute dérive non accompagnée.
 *
 * <h2>Pourquoi le contrat est un fichier versionné, et non un serveur</h2>
 * Le client TypeScript du front est généré depuis ce fichier. S'il fallait
 * interroger un serveur en marche pour l'obtenir, la génération dépendrait d'un
 * environnement déployé, et le contrat d'une version en cours d'exécution plutôt
 * que du code relu. Le fichier est donc produit ici, depuis le contexte réel, et
 * comparé à la version versionnée.
 *
 * <h2>Ce que la dérive signalerait</h2>
 * Un écart signifie qu'un point d'entrée, un schéma ou un type a changé sans que
 * le contrat ait été régénéré — donc que le front compile contre un contrat qui
 * ne décrit plus le serveur. La correction est délibérée :
 * {@code ./mvnw verify -Dqerp.openapi.update=true}.
 *
 * <p>La comparaison porte sur les arbres JSON, pas sur le texte : l'ordre des
 * clés et l'indentation ne sont pas des informations, et un test qui échoue sur
 * un espacement fait perdre la confiance qu'on lui accorde.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiContractIT {

  private static final String DATABASE = "qerp_it_openapi";
  private static final String CHEMIN_CONTRAT = "openapi/qerp-api.json";
  private static final String PROPRIETE_REGENERATION = "qerp.openapi.update";

  private static final ObjectMapper JSON =
      new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;

  @Test
  @DisplayName("le document OpenAPI n'est pas public : il énumère la surface d'API")
  void leDocumentNestPasPublic() throws Exception {
    // En production, la chaîne de sécurité n'ouvre /v3/api-docs que sous le
    // profil dev. Le test s'exécute hors de ce profil : c'est donc le
    // comportement de production qui est vérifié ici.
    mockMvc.perform(get("/v3/api-docs")).andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("le contrat servi est celui qui est versionné, sinon la dérive est signalée")
  void leContratServiCorrespondAuContratVersionne() throws Exception {
    JsonNode servi = documentServi();
    Path emplacement = Path.of(CHEMIN_CONTRAT);

    if (Boolean.getBoolean(PROPRIETE_REGENERATION) || !Files.exists(emplacement)) {
      ecrire(emplacement, servi);
      return;
    }

    JsonNode versionne;
    try {
      versionne = JSON.readTree(Files.readString(emplacement, StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException("Contrat versionné illisible : " + emplacement, e);
    }

    assertThat(ecarts(versionne, servi))
        .as(
            "Le contrat OpenAPI versionné ne décrit plus le serveur. Régénérez-le avec"
                + " ./mvnw verify -D%s=true, puis relisez le diff avant de le committer.",
            PROPRIETE_REGENERATION)
        .isEmpty();
  }

  @Test
  @DisplayName("le contrat déclare l'authentification par jeton et n'expose aucun paramètre de société")
  void leContratDeclareLAuthentificationEtAucunParametreDeSociete() throws Exception {
    JsonNode document = documentServi();

    assertThat(document.at("/components/securitySchemes/bearerAuth/scheme").asText())
        .as("sans schéma de sécurité déclaré, un client généré croirait les points d'entrée ouverts")
        .isEqualTo("bearer");

    assertThat(document.path("paths").isEmpty())
        .as("un contrat sans aucun chemin ne prouverait rien")
        .isFalse();

    // Invariant d'isolation : le périmètre société est résolu côté serveur. Un
    // paramètre de société dans le contrat signifierait que le client choisit son
    // périmètre, ce qui est exactement ce que la RLS empêche.
    List<String> parametresDeSociete = new ArrayList<>();
    document
        .path("paths")
        .fields()
        .forEachRemaining(
            chemin ->
                chemin
                    .getValue()
                    .fields()
                    .forEachRemaining(
                        operation ->
                            operation
                                .getValue()
                                .path("parameters")
                                .forEach(
                                    parametre -> {
                                      String nom = parametre.path("name").asText();
                                      if (nom.contains("tenant") || nom.contains("societe")) {
                                        parametresDeSociete.add(
                                            chemin.getKey() + " " + operation.getKey() + " " + nom);
                                      }
                                    })));
    assertThat(parametresDeSociete)
        .as("un paramètre de société laisserait le client choisir son périmètre")
        .isEmpty();
  }

  private JsonNode documentServi() throws Exception {
    String corps =
        mockMvc
            .perform(
                get("/v3/api-docs")
                    .with(
                        jwt()
                            .jwt(
                                builder ->
                                    builder.subject(PostgresFixture.ALPHA_USER))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);

    return JSON.readTree(corps);
  }

  private void ecrire(Path emplacement, JsonNode document) {
    try {
      Files.createDirectories(emplacement.getParent());
      Files.writeString(emplacement, JSON.writeValueAsString(document) + "\n", StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("Écriture du contrat impossible : " + emplacement, e);
    }
  }

  /**
   * Écarts entre deux documents, exprimés en chemins JSON.
   *
   * <p>Comparer les textes donnerait un message illisible ; nommer les chemins
   * qui diffèrent dit immédiatement ce qui a bougé.
   */
  private List<String> ecarts(JsonNode attendu, JsonNode constate) {
    TreeSet<String> cheminsAttendus = new TreeSet<>();
    TreeSet<String> cheminsConstates = new TreeSet<>();
    aplatir("", attendu, cheminsAttendus);
    aplatir("", constate, cheminsConstates);

    List<String> ecarts = new ArrayList<>();
    cheminsAttendus.stream()
        .filter(chemin -> !cheminsConstates.contains(chemin))
        .forEach(chemin -> ecarts.add("disparu ou modifié : " + chemin));
    cheminsConstates.stream()
        .filter(chemin -> !cheminsAttendus.contains(chemin))
        .forEach(chemin -> ecarts.add("apparu : " + chemin));

    // Un document volumineux produirait un échec de plusieurs centaines de lignes
    // où l'écart utile serait noyé. Les premiers suffisent à comprendre.
    return ecarts.size() <= 40 ? ecarts : ecarts.subList(0, 40);
  }

  private void aplatir(String prefixe, JsonNode noeud, TreeSet<String> chemins) {
    if (noeud.isObject()) {
      noeud
          .fields()
          .forEachRemaining(
              champ -> aplatir(prefixe + "/" + champ.getKey(), champ.getValue(), chemins));
      if (noeud.isEmpty()) {
        chemins.add(prefixe);
      }
      return;
    }
    if (noeud.isArray()) {
      for (int i = 0; i < noeud.size(); i++) {
        aplatir(prefixe + "/" + i, noeud.get(i), chemins);
      }
      if (noeud.isEmpty()) {
        chemins.add(prefixe);
      }
      return;
    }
    chemins.add(prefixe + "=" + noeud.asText());
  }
}
