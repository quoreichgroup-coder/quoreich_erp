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
 * l'emportent sur les sections par défaut du client et sont portées par les lignes de produit.
 *
 * <p>{@code lines} : avec des lignes, la base calcule HT et TVA (V21) et {@code subtotal} /
 * {@code taxAmount} sont ignorés ; sans ligne, ils restent obligatoires (factures d'en-tête).
 */
public record CreateArInvoice(
    String invoiceNumber,
    UUID customerId,
    LocalDate invoiceDate,
    LocalDate dueDate,
    BigDecimal subtotal,
    BigDecimal taxAmount,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) List<InvoiceAnalytic> analytics,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) List<InvoiceLine> lines) {

  /** Ligne de facture. Montants calculés par la base : quantité × prix × (1 − remise). */
  public record InvoiceLine(
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String description,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal quantity,
      @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal unitPrice,
      @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, description = "Remise en %, 0 par défaut") BigDecimal discountPct,
      @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) UUID taxCodeId,
      @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, description = "Compte de vente propre ; sinon le rôle Ventes")
          UUID revenueAccountId) {}

  public List<InvoiceLine> linesOrEmpty() {
    return lines == null ? List.of() : lines;
  }

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
    if (linesOrEmpty().isEmpty()) {
      if (subtotal == null || subtotal.signum() < 0) return "subtotal doit être >= 0";
      if (taxAmount != null && taxAmount.signum() < 0) return "taxAmount doit être >= 0";
    }
    for (InvoiceLine l : linesOrEmpty()) {
      if (l == null || l.description() == null || l.description().isBlank()) return "lines : description obligatoire";
      if (l.quantity() == null || l.quantity().signum() <= 0) return "lines : quantity doit être > 0";
      if (l.unitPrice() == null || l.unitPrice().signum() < 0) return "lines : unitPrice doit être >= 0";
      if (l.discountPct() != null && (l.discountPct().signum() < 0 || l.discountPct().compareTo(BigDecimal.valueOf(100)) > 0))
        return "lines : discountPct doit être compris entre 0 et 100";
    }
    Set<UUID> axes = new HashSet<>();
    for (InvoiceAnalytic a : analyticsOrEmpty()) {
      if (a == null || a.axisId() == null || a.valueId() == null) return "analytics : axisId et valueId obligatoires";
      if (!axes.add(a.axisId())) return "analytics : un axe ne porte qu'une section";
    }
    return null;
  }
}
