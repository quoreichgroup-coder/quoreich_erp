package com.quoreich.qerp.accounting;

import org.springframework.http.HttpStatus;

/**
 * Refus métier du paramétrage comptable, avec le statut HTTP qui lui correspond.
 *
 * <p>Le message est rédigé ici, jamais recopié d'une erreur SQL brute.
 */
class AccountingRefusal extends RuntimeException {

  private final HttpStatus status;

  AccountingRefusal(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  HttpStatus status() {
    return status;
  }
}
