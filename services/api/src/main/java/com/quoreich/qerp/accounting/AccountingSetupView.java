package com.quoreich.qerp.accounting;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/** Paramétrage comptable de la société du porteur. */
public record AccountingSetupView(
    @Schema(
            requiredMode = Schema.RequiredMode.NOT_REQUIRED,
            description = "Référentiel appliqué ; absent si aucun ne l'a encore été")
        AccountingFrameworkView framework,
    @Schema(
            requiredMode = Schema.RequiredMode.REQUIRED,
            description = "Vrai si le porteur est administrateur de la société courante")
        boolean canEdit,
    @Schema(
            requiredMode = Schema.RequiredMode.REQUIRED,
            description =
                "Vrai si chaque rôle a un compte actif : aucune comptabilisation ne sera refusée"
                    + " pour paramétrage")
        boolean complete,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PostingAccountView> roles) {

  static AccountingSetupView of(
      AccountingFrameworkView framework, boolean canEdit, List<PostingAccountView> roles) {
    return new AccountingSetupView(
        framework, canEdit, roles.stream().allMatch(PostingAccountView::ready), List.copyOf(roles));
  }
}
