package com.quoreich.qerp.invoice;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Avoir sur une facture : motif obligatoire ; sans lignes, tout ce qui reste à créditer (V45). */
public record CreateArCreditNote(String reason, LocalDate creditDate, List<CreditedLine> lines) {

  public record CreditedLine(UUID invoiceLineId, BigDecimal quantity) {}

  public String problem() {
    if (reason == null || reason.isBlank()) return "reason est obligatoire";
    if (lines != null) {
      for (CreditedLine l : lines) {
        if (l == null || l.invoiceLineId() == null) return "invoiceLineId est obligatoire sur chaque ligne";
        if (l.quantity() == null || l.quantity().signum() <= 0) return "quantity doit être > 0";
      }
    }
    return null;
  }
}
