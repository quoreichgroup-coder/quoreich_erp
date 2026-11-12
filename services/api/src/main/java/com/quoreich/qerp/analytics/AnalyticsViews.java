package com.quoreich.qerp.analytics;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Vues et commandes de l'analytique (V19). Regroupées : ce sont de simples porteurs de données. */
final class AnalyticsViews {

  private AnalyticsViews() {}

  static final java.util.regex.Pattern AXIS_CODE = java.util.regex.Pattern.compile("^[A-Z][A-Z0-9_]*$");
  static final java.util.regex.Pattern PREFIX = java.util.regex.Pattern.compile("^[0-9]+$");

  static boolean blank(String s) {
    return s == null || s.isBlank();
  }

  static String dates(LocalDate from, LocalDate to) {
    return from != null && to != null && from.isAfter(to)
        ? "La date de début de validité doit précéder la date de fin"
        : null;
  }
}

/** Paramétrage analytique de la société du porteur. */
record AnalyticsSetupView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Administrateur : axes et règles")
        boolean canManageAxes,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Administrateur ou comptable : sections")
        boolean canManageValues,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AnalyticAxisView> axes) {}

record AnalyticAxisView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int sortOrder,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean active,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AnalyticValueView> values,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AnalyticRuleView> rules) {}

record AnalyticValueView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) UUID parentId,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) LocalDate validFrom,
    @Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) LocalDate validTo,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean active) {}

record AnalyticRuleView(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Préfixe de numéro de compte : 7, 70, 701…")
        String accountPrefix,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"required", "forbidden"})
        String requirement) {}

record CreateAnalyticAxis(String code, String name, Integer sortOrder) {
  String problem() {
    if (AnalyticsViews.blank(code) || !AnalyticsViews.AXIS_CODE.matcher(code).matches())
      return "code obligatoire : majuscules, chiffres et _ (ex. DEPT, CENTRE_COUT)";
    if (AnalyticsViews.blank(name)) return "name obligatoire";
    return null;
  }
}

record UpdateAnalyticAxis(String name, Integer sortOrder, Boolean active) {
  String problem() {
    if (AnalyticsViews.blank(name)) return "name obligatoire";
    if (active == null) return "active obligatoire";
    return null;
  }
}

record CreateAnalyticValue(String code, String name, UUID parentId, LocalDate validFrom, LocalDate validTo) {
  String problem() {
    if (AnalyticsViews.blank(code)) return "code obligatoire";
    if (AnalyticsViews.blank(name)) return "name obligatoire";
    return AnalyticsViews.dates(validFrom, validTo);
  }
}

record UpdateAnalyticValue(
    String name, UUID parentId, LocalDate validFrom, LocalDate validTo, Boolean active) {
  String problem() {
    if (AnalyticsViews.blank(name)) return "name obligatoire";
    if (active == null) return "active obligatoire";
    return AnalyticsViews.dates(validFrom, validTo);
  }
}

record SetAnalyticRule(String requirement) {
  String problem() {
    return "required".equals(requirement) || "forbidden".equals(requirement)
        ? null
        : "requirement doit valoir required ou forbidden";
  }
}

/** Section par défaut d'un client pour un axe : reprise sur ses factures si aucune n'est choisie. */
record CustomerAnalyticDefault(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID axisId,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID valueId) {}

record SetCustomerAnalyticDefault(UUID valueId) {
  String problem() {
    return valueId == null ? "valueId obligatoire" : null;
  }
}

/** Refus métier, avec son statut HTTP ; le message est rédigé ici, jamais recopié du SQL. */
class AnalyticsRefusal extends RuntimeException {
  private final int status;

  AnalyticsRefusal(int status, String message) {
    super(message);
    this.status = status;
  }

  int status() {
    return status;
  }
}
