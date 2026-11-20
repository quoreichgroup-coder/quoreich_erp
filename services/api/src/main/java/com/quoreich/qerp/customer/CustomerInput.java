package com.quoreich.qerp.customer;

import java.math.BigDecimal;
import java.util.regex.Pattern;

/** Fiche client saisie (création ou modification). La société n'en fait jamais partie. */
public record CustomerInput(
    String name,
    String email,
    String phone,
    String address,
    String taxId,
    BigDecimal creditLimit,
    Integer paymentTerms,
    /** Devise par défaut des devis, commandes et factures du client (V126) ; vide = devise de la société. */
    String currency) {

  private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

  /** Premier problème de la saisie, en français, ou {@code null}. */
  String problem() {
    if (name == null || name.isBlank()) return "Le nom du client est obligatoire";
    if (name.strip().length() > 200) return "Nom du client : 200 caractères au plus";
    if (email != null && !email.isBlank() && !EMAIL.matcher(email.strip()).matches()) return "Adresse e-mail invalide";
    if (creditLimit != null && creditLimit.signum() < 0) return "Le plafond de crédit ne peut pas être négatif";
    if (paymentTerms != null && (paymentTerms < 0 || paymentTerms > 365)) return "Délai de paiement : de 0 à 365 jours";
    if (currency != null && !currency.isBlank() && !currency.strip().matches("[A-Za-z]{3}")) return "Devise : code ISO à 3 lettres";
    return null;
  }

  String cleanEmail() {
    return email == null || email.isBlank() ? null : email.strip().toLowerCase();
  }

  String cleanCurrency() {
    return currency == null || currency.isBlank() ? null : currency.strip().toUpperCase();
  }

  BigDecimal creditLimitOrZero() {
    return creditLimit == null ? BigDecimal.ZERO : creditLimit;
  }

  int paymentTermsOrDefault() {
    return paymentTerms == null ? 30 : paymentTerms;
  }
}
