package com.quoreich.qerp.invoice;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Encaissement sur une facture. Le statut et le solde en découlent côté base. */
public record RecordArPayment(
    BigDecimal amount, LocalDate paymentDate, String reference, String paymentMethod,
    @io.swagger.v3.oas.annotations.media.Schema(requiredMode = io.swagger.v3.oas.annotations.media.Schema.RequiredMode.NOT_REQUIRED,
        description = "Facture en devise (V125) : montant reçu en devise (remplace amount)") BigDecimal fxAmount,
    @io.swagger.v3.oas.annotations.media.Schema(requiredMode = io.swagger.v3.oas.annotations.media.Schema.RequiredMode.NOT_REQUIRED,
        description = "Cours du règlement ; vide = cours enregistré du jour") BigDecimal exchangeRate) {
  public String problem() {
    if (fxAmount != null) {
      if (fxAmount.signum() <= 0) return "fxAmount doit être > 0";
      if (exchangeRate != null && exchangeRate.signum() <= 0) return "exchangeRate doit être > 0";
      return null;
    }
    if (amount == null || amount.signum() <= 0) return "amount doit être > 0";
    return null;
  }
}
