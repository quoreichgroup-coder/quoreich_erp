package com.quoreich.qerp.invoice;

import java.time.LocalDate;

/** Annulation d'un encaissement : motif obligatoire, date par défaut aujourd'hui. */
public record ReverseArPayment(String reason, LocalDate reversalDate) {

  public String problem() {
    if (reason == null || reason.isBlank()) return "reason est obligatoire";
    return null;
  }
}
