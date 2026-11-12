package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * Un rôle comptable et le compte que la société lui associe.
 *
 * <p>{@code glAccountId} nul : rôle non paramétré, la comptabilisation qui en dépend est refusée
 * (QG001). {@code ready} : paramétré ET compte actif — un compte inactif vaut un compte absent.
 * {@code suggestedAccountCode} : le compte que le référentiel de la société propose.
 */
public record PostingAccountView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String roleCode,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String module,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String description,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) UUID glAccountId,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String accountCode,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String accountName,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean ready,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String suggestedAccountCode) {}
