package com.quoreich.qerp.invoice;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Encaissement sur une facture. Le statut et le solde en découlent côté base. */
public record RecordArPayment(
    BigDecimal amount, LocalDate paymentDate, String reference, String paymentMethod) {

  public String problem() {
    if (amount == null || amount.signum() <= 0) return "amount doit être > 0";
    return null;
  }
}
