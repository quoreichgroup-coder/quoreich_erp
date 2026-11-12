package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/** Compte du plan de la société, proposable pour un rôle comptable. */
public record GlAccountOption(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accountType,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean active) {}
