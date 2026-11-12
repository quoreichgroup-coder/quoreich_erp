package com.quoreich.qerp.invoice;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Demande de création. Le total est recalculé par la base (validate_ar_invoice). */
public record CreateArInvoice(
    String invoiceNumber,
    UUID customerId,
    LocalDate invoiceDate,
    LocalDate dueDate,
    BigDecimal subtotal,
    BigDecimal taxAmount) {

  public String problem() {
    if (invoiceNumber == null || invoiceNumber.isBlank()) return "invoiceNumber obligatoire";
    if (customerId == null) return "customerId obligatoire";
    if (dueDate == null) return "dueDate obligatoire";
    if (subtotal == null || subtotal.signum() < 0) return "subtotal doit être >= 0";
    if (taxAmount != null && taxAmount.signum() < 0) return "taxAmount doit être >= 0";
    return null;
  }
}
