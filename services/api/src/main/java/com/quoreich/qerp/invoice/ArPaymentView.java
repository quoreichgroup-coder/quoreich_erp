package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Règlement d'une facture client ; une annulation (V42) a un montant négatif et cite l'origine. */
public record ArPaymentView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate paymentDate,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal amount,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String paymentMethod,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String reference,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) UUID reversalOf,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String reversalReason,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "ar_receipt (encaissement), ar_credit (imputation d'un avoir, V45) ou ar_advance (imputation d'un acompte, V49)")
        String paymentType) {}
