package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Avoir client (V45) : en-tête, lignes, pied ; amountAllocated = part imputée sur la facture. */
public record ArCreditNoteView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String creditNoteNumber,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID invoiceId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String invoiceNumber,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID customerId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String customerName,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate creditDate,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String reason,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal subtotal,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal taxAmount,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal total,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal amountAllocated,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<NoteLine> lines) {

  public record NoteLine(
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int lineNo,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String description,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal quantity,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal unitPrice,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal discountPct,
      @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String taxCode,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal netAmount,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal taxAmount) {}
}
