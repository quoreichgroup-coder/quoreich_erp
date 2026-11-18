package com.quoreich.qerp.hr;

import org.springframework.http.HttpStatus;

/** Refus métier lisible pour une opération RH ou Paie. */
public class HrRefusal extends RuntimeException {
  private final HttpStatus status;

  public HrRefusal(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }
}
