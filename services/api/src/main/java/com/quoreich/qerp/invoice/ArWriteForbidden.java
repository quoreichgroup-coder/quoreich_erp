package com.quoreich.qerp.invoice;

/**
 * Le porteur voit la facture (même société) mais n'a pas le droit d'écrire en AR.
 *
 * <p>Distinct d'un refus comptable (409) : ici rien n'a été tenté en base.
 */
class ArWriteForbidden extends RuntimeException {

  ArWriteForbidden() {
    super("Rôle comptable ou administrateur requis dans la société courante");
  }
}
