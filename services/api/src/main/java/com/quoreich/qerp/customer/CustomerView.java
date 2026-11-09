package com.quoreich.qerp.customer;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * Vue d'un client exposée par l'API.
 *
 * <p>Volontairement distincte de la table : la réponse HTTP ne doit pas suivre
 * automatiquement les colonnes du schéma, sinon toute migration devient un
 * changement de contrat public. Les colonnes sensibles — limite de crédit,
 * conditions de paiement — ne sont pas exposées tant qu'un besoin ne les
 * justifie pas.
 *
 * <h2>Pourquoi chaque champ est déclaré obligatoire</h2>
 * Un composant de {@code record} est renseigné par construction : il ne peut pas
 * valoir {@code null} sans que la requête ait échoué avant. Sans cette
 * déclaration, Springdoc génère des champs facultatifs, et le client TypeScript
 * hérite de `string | undefined` sur des valeurs que le serveur garantit
 * toujours présentes. La conséquence n'est pas cosmétique : le front se couvre
 * d'un contrôle de nullité à chaque lecture, et finit par traiter une absence
 * impossible comme un cas normal. Le contrat doit dire ce que le serveur
 * garantit.
 */
public record CustomerView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status) {}
