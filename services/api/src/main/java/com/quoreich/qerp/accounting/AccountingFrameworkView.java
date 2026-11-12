package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;

/** Référentiel comptable proposé (SYSCOHADA révisé, puis d'autres pays). */
public record AccountingFrameworkView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String scope,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String version,
    @Schema(
            requiredMode = Schema.RequiredMode.REQUIRED,
            description = "Faux tant qu'un expert-comptable local n'a pas validé les numéros et intitulés")
        boolean validated) {}
