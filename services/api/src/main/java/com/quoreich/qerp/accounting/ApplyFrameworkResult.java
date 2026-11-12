package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;

/** Effet de l'application d'un référentiel ; zéro et zéro si déjà appliqué. */
public record ApplyFrameworkResult(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String framework,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int accountsCreated,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int rolesAssigned) {}
