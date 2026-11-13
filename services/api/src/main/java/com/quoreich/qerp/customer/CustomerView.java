package com.quoreich.qerp.customer;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Vue d'un client exposée par l'API.
 *
 * <p>Volontairement distincte de la table : la réponse HTTP ne doit pas suivre
 * automatiquement les colonnes du schéma, sinon toute migration devient un
 * changement de contrat public.
 *
 * <p>Depuis le 14 novembre 2026 elle porte la fiche complète (coordonnées, identifiant fiscal,
 * plafond de crédit, conditions de paiement) : sur site, l'écran des clients et la facture la
 * lisent ici, et non plus dans Supabase — sinon le front mêlait deux bases (clients du nuage,
 * factures de la base locale). Ces champs sont lisibles par tout membre de la société, comme
 * par la politique RLS « Tenant isolation » de {@code customers}.
 *
 * <h2>Pourquoi les champs garantis sont déclarés obligatoires</h2>
 * Un composant de {@code record} renseigné par construction ne peut pas valoir {@code null} sans
 * que la requête ait échoué avant. Sans cette déclaration, Springdoc génère des champs
 * facultatifs, et le client TypeScript hérite de `string | undefined` sur des valeurs que le
 * serveur garantit toujours présentes. Les colonnes réellement facultatives le restent.
 */
public record CustomerView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String email,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String phone,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String address,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, description = "Identifiant fiscal (IFU)") String taxId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Plafond de crédit, XOF") BigDecimal creditLimit,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Délai de paiement, jours") int paymentTerms) {}
