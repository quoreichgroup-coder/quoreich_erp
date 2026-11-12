package com.quoreich.qerp.accounting;

import java.util.UUID;

/** Compte à associer à un rôle comptable. */
public record AssignPostingAccount(UUID glAccountId) {

  public String problem() {
    return glAccountId == null ? "glAccountId obligatoire" : null;
  }
}
