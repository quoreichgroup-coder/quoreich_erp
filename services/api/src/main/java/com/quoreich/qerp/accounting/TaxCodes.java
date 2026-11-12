package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.UUID;

/** Codes TVA (V21) : vues et commandes. */
final class TaxCodes {
  private TaxCodes() {}

  static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("^[A-Z][A-Z0-9_]*$");
}

/** Code TVA de la société. Le taux est figé : un nouveau taux se crée sous un nouveau code. */
record TaxCodeView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Taux en pourcentage, ex. 18.00") BigDecimal rate,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, description = "Compte de TVA propre ; sinon le rôle TVA collectée")
        UUID glAccountId,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) String accountCode,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean active) {}

record CreateTaxCode(String code, String name, BigDecimal rate, UUID glAccountId) {
  String problem() {
    if (code == null || !TaxCodes.CODE.matcher(code).matches())
      return "code obligatoire : majuscules, chiffres et _ (ex. TVA18, EXO)";
    if (name == null || name.isBlank()) return "name obligatoire";
    if (rate == null || rate.signum() < 0 || rate.compareTo(BigDecimal.valueOf(100)) > 0)
      return "rate doit être compris entre 0 et 100";
    if (rate.scale() > 2) return "rate : deux décimales au plus";
    return null;
  }
}

record UpdateTaxCode(String name, Boolean active, UUID glAccountId) {
  String problem() {
    if (name == null || name.isBlank()) return "name obligatoire";
    if (active == null) return "active obligatoire";
    return null;
  }
}
