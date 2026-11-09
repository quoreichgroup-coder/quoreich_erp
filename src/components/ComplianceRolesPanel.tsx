import { GenericRolesPanel } from "@/components/GenericRolesPanel";
import {
  useMyComplianceRoles, useTenantComplianceRoles, useComplianceRoleAudit, useAssignComplianceRole,
} from "@/hooks/use-compliance-data";
import {
  ALL_COMPLIANCE_ACTIONS, ALL_COMPLIANCE_ROLES,
  ACTION_LABELS, ROLE_LABELS, REQUIRED_ROLES,
  violatesComplianceSoD, canDo, actionTooltip,
} from "@/lib/compliance-roles";

export function ComplianceRolesPanel() {
  const perms = useMyComplianceRoles();
  return (
    <GenericRolesPanel
      moduleLabel="Conformité"
      filePrefix="compliance-role-audit"
      sodHint="Officier et Auditeur sont mutuellement exclusifs."
      roles={ALL_COMPLIANCE_ROLES}
      actions={ALL_COMPLIANCE_ACTIONS}
      roleLabels={ROLE_LABELS}
      actionLabels={ACTION_LABELS}
      requiredRoles={REQUIRED_ROLES}
      violatesSoD={violatesComplianceSoD}
      canExport={canDo(perms, "export")}
      exportTooltip={actionTooltip(perms, "export", "Exporter l'audit")}
      useTenantRoles={useTenantComplianceRoles}
      useAudit={useComplianceRoleAudit}
      useAssign={useAssignComplianceRole}
    />
  );
}
