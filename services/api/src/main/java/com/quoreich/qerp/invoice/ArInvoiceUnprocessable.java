package com.quoreich.qerp.invoice;

/** Demande bien formée mais inapplicable dans la société (section d'un autre axe, inconnue…). */
class ArInvoiceUnprocessable extends RuntimeException {

  ArInvoiceUnprocessable(String message) {
    super(message);
  }
}
