import { GenericRolesPanel } from "@/components/GenericRolesPanel";
import {
  useMyRiskRoles, useTenantRiskRoles, useRiskRoleAudit, useAssignRiskRole,
} from "@/hooks/use-risk-data";
import {
  ALL_RISK_ACTIONS, ALL_RISK_ROLES,
  ACTION_LABELS, ROLE_LABELS, REQUIRED_ROLES,
  violatesRiskSoD, canDo, actionTooltip,
} from "@/lib/risk-roles";

export function RiskRolesPanel() {
  const perms = useMyRiskRoles();
  return (
    <GenericRolesPanel
      moduleLabel="Risques"
      filePrefix="risk-role-audit"
      sodHint="Propriétaire et Évaluateur sont mutuellement exclusifs."
      roles={ALL_RISK_ROLES}
      actions={ALL_RISK_ACTIONS}
      roleLabels={ROLE_LABELS}
      actionLabels={ACTION_LABELS}
      requiredRoles={REQUIRED_ROLES}
      violatesSoD={violatesRiskSoD}
      canExport={canDo(perms, "export")}
      exportTooltip={actionTooltip(perms, "export", "Exporter l'audit")}
      useTenantRoles={useTenantRiskRoles}
      useAudit={useRiskRoleAudit}
      useAssign={useAssignRiskRole}
    />
  );
}
