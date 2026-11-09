package com.quoreich.qerp.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Description du contrat OpenAPI servi sur {@code /v3/api-docs}.
 *
 * <h2>Pourquoi le schéma de sécurité est déclaré séparément</h2>
 * Sans lui, le document généré décrit des points d'entrée ouverts alors que la
 * chaîne de sécurité exige un jeton sur tous. Un client généré depuis ce
 * document serait donc faux, et l'erreur ne se verrait qu'à l'exécution. Le
 * schéma {@code bearerAuth} rend le contrat conforme à ce que le serveur fait
 * réellement.
 *
 * <h2>Le jeton ne porte pas le périmètre société</h2>
 * Aucun paramètre de société n'apparaît dans les points d'entrée, et c'est
 * délibéré : le périmètre est résolu côté serveur, depuis {@code profiles}, par
 * les politiques RLS. Un client ne choisit pas les sociétés qu'il interroge, il
 * ne peut donc pas non plus les élargir. Ajouter un paramètre de société serait
 * un affaiblissement, pas une fonctionnalité.
 */
@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {

  @Value("${qerp.api.version:0.0.1-SNAPSHOT}")
  private String version;

  @Bean
  OpenAPI qerpOpenApi() {
    return new OpenAPI()
        .info(
            new Info()
                .title("API QUOREICH")
                .version(version)
                .description(
                    """
                    API de l'ERP financier OHADA/SYSCOHADA QUOREICH.

                    Toutes les opérations exigent un jeton porteur Keycloak. Le périmètre \
                    société n'est jamais un paramètre : il est résolu côté serveur depuis le \
                    profil de l'utilisateur, et appliqué par les politiques RLS de PostgreSQL. \
                    Appeler l'API avec un jeton d'une autre société ne renvoie donc pas les \
                    données de cette société — cela renvoie celles du porteur du jeton.

                    Montants en XOF, quantifiés en unités entières. Dates au format \
                    ISO-8601. Messages d'erreur en français.""")
                .license(new License().name("Propriétaire — QUOREICH GROUP")))
        .components(
            new Components()
                .addSecuritySchemes(
                    "bearerAuth",
                    new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")
                        .description("Jeton d'accès Keycloak (en-tête Authorization: Bearer …)")))
        .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
        .servers(List.of(new Server().url("/").description("Instance courante")));
  }

  /**
   * Déclare sur chaque opération les refus que le serveur peut réellement
   * opposer.
   *
   * <p>Sans cela, le document ne décrit que le cas passant, et le client généré
   * n'a aucun type pour 401 et 403 — donc aucun moyen de les traiter autrement
   * qu'en texte libre. Or ces deux réponses ne sont pas des cas marginaux ici :
   * {@code 401} est l'absence de jeton, et {@code 403} un jeton dont le porteur
   * n'est pas exploitable. Les ignorer dans le contrat revient à laisser le front
   * découvrir la distinction en production.
   */
  @Bean
  OpenApiCustomizer reponsesDErreurGlobales() {
    return openApi ->
        openApi
            .getPaths()
            .values()
            .forEach(
                item ->
                    item.readOperations()
                        .forEach(
                            operation -> {
                              operation
                                  .getResponses()
                                  .addApiResponse(
                                      "401",
                                      erreur("Jeton absent, expiré ou invalide."));
                              operation
                                  .getResponses()
                                  .addApiResponse(
                                      "403",
                                      erreur(
                                          "Jeton authentifié mais inexploitable : le porteur n'a pas"
                                              + " d'identifiant utilisable."));
                            }));
  }

  private ApiResponse erreur(String description) {
    return new ApiResponse()
        .description(description)
        .content(
            new Content()
                .addMediaType(
                    org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                    new MediaType()
                        .schema(
                            new Schema<>()
                                .type("object")
                                .addProperty("error", new Schema<>().type("string"))
                                .required(List.of("error")))));
  }
}
