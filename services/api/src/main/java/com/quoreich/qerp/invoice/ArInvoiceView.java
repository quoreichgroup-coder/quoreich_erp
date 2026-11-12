package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Facture client telle qu'exposée par l'API (le solde est calculé, jamais saisi). */
public record ArInvoiceView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String invoiceNumber,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID customerId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate invoiceDate,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate dueDate,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal subtotal,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal taxAmount,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal total,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal amountPaid,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal balance,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) UUID journalEntryId) {}
