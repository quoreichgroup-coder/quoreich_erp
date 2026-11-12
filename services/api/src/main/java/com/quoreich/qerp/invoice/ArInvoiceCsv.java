package com.quoreich.qerp.invoice;

import java.util.List;

/**
 * Export CSV des factures clients.
 *
 * <p>Les lignes viennent de {@link ArInvoiceQuery#findVisible()} : l'export a donc exactement le
 * périmètre de la liste (société du porteur, imposé par la RLS), sans second chemin de lecture.
 */
final class ArInvoiceCsv {

  private static final String HEADER =
      "Numéro,Client,Date facture,Échéance,HT,TVA,Total TTC,Encaissé,Solde,Statut";

  private ArInvoiceCsv() {}

  static String render(List<ArInvoiceView> rows) {
    StringBuilder out = new StringBuilder("\uFEFF").append(HEADER).append('\n');
    for (ArInvoiceView r : rows) {
      out.append(text(r.invoiceNumber())).append(',')
          .append(r.customerId()).append(',')
          .append(r.invoiceDate()).append(',')
          .append(r.dueDate()).append(',')
          .append(r.subtotal().toPlainString()).append(',')
          .append(r.taxAmount().toPlainString()).append(',')
          .append(r.total().toPlainString()).append(',')
          .append(r.amountPaid().toPlainString()).append(',')
          .append(r.balance().toPlainString()).append(',')
          .append(text(r.status())).append('\n');
    }
    return out.toString();
  }

  /** Échappe le CSV et neutralise l'injection de formule (=, +, -, @) dans les champs texte. */
  static String text(String value) {
    String s = value == null ? "" : value;
    if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0) {
      s = "'" + s;
    }
    if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
      s = "\"" + s.replace("\"", "\"\"") + "\"";
    }
    return s;
  }
}
