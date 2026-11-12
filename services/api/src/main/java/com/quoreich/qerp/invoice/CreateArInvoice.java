package com.quoreich.qerp.invoice;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Demande de création. Le total est recalculé par la base (validate_ar_invoice).
 *
 * <p>{@code analytics} : sections choisies sur la facture, un axe au plus une fois. Elles
 * l'emportent sur les sections par défaut du client et sont portées par la ligne de produit.
 */
public record CreateArInvoice(
    String invoiceNumber,
    UUID customerId,
    LocalDate invoiceDate,
    LocalDate dueDate,
    BigDecimal subtotal,
    BigDecimal taxAmount,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) List<InvoiceAnalytic> analytics) {

  /** Section choisie pour un axe. */
  public record InvoiceAnalytic(
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID axisId,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID valueId) {}

  public List<InvoiceAnalytic> analyticsOrEmpty() {
    return analytics == null ? List.of() : analytics;
  }

  public String problem() {
    if (invoiceNumber == null || invoiceNumber.isBlank()) return "invoiceNumber obligatoire";
    if (customerId == null) return "customerId obligatoire";
    if (dueDate == null) return "dueDate obligatoire";
    if (subtotal == null || subtotal.signum() < 0) return "subtotal doit être >= 0";
    if (taxAmount != null && taxAmount.signum() < 0) return "taxAmount doit être >= 0";
    Set<UUID> axes = new HashSet<>();
    for (InvoiceAnalytic a : analyticsOrEmpty()) {
      if (a == null || a.axisId() == null || a.valueId() == null) return "analytics : axisId et valueId obligatoires";
      if (!axes.add(a.axisId())) return "analytics : un axe ne porte qu'une section";
    }
    return null;
  }
}
