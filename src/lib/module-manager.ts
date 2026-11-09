/* ═══════════════════════════════════════════════════════════════
   QUOREICH ERP — Module Manager & License System
   TypeScript services for dynamic module management, license
   verification, dependency checks, and audit trail.
   ═══════════════════════════════════════════════════════════════ */

import { createHash } from "crypto";

// ─── Types ───

export type ModuleName =
  | "GL" | "AR" | "AP" | "Treasury" | "FixedAssets"
  | "Reporting" | "Admin" | "Budget" | "Compliance"
  | "ProjectAccounting" | "RiskManagement" | "Procurement"
  | "Inventory" | "Sales" | "Expenses";

export type PlanTier = "Starter" | "Professional" | "Enterprise";

export type LicenseType = "per-module" | "per-user" | "per-seat";

export type ModuleStatus = "active" | "inactive" | "license_expired" | "pending_approval";

export interface License {
  id: string;
  tenantId: string;
  moduleName: ModuleName;
  plan: PlanTier;
  licenseType: LicenseType;
  startDate: string;
  endDate: string;
  maxUsers?: number;
  activeUsers?: number;
  isActive: boolean;
}

export interface ModuleState {
  moduleName: ModuleName;
  status: ModuleStatus;
  activatedAt?: string;
  deactivatedAt?: string;
  activatedBy?: string;
  licenseId?: string;
}

export interface TenantModules {
  tenantId: string;
  modules: ModuleState[];
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  tenantId: string;
  action: "module_activated" | "module_deactivated" | "license_check" | "dependency_check" | "permission_check";
  moduleName: ModuleName;
  userId: string;
  details: string;
  success: boolean;
  hash?: string;
  previousHash?: string;
}

// ─── Module Dependencies ───

export const MODULE_DEPENDENCIES: Record<ModuleName, ModuleName[]> = {
  GL: [],
  AR: ["GL"],
  AP: ["GL"],
  Treasury: ["GL"],
  FixedAssets: ["GL"],
  Reporting: ["GL"],
  Admin: [],
  Budget: ["GL", "Reporting"],
  Compliance: ["GL", "Admin"],
  ProjectAccounting: ["GL", "AR", "AP"],
  RiskManagement: ["GL", "Reporting"],
  Procurement: ["AP"],
  Inventory: ["GL"],
  Sales: ["GL", "AR"],
  Expenses: ["GL", "AP"],
};

// ─── Plan Module Access ───

export const PLAN_MODULES: Record<PlanTier, ModuleName[]> = {
  Starter: ["GL", "AR", "AP", "Admin"],
  Professional: ["GL", "AR", "AP", "Treasury", "FixedAssets", "Reporting", "Admin", "Inventory", "Sales"],
  Enterprise: ["GL", "AR", "AP", "Treasury", "FixedAssets", "Reporting", "Admin", "Budget", "Compliance", "ProjectAccounting", "RiskManagement", "Procurement", "Inventory", "Sales", "Expenses"],
};

// ─── Module Metadata ───

export const MODULE_METADATA: Record<ModuleName, { label: string; description: string; icon: string }> = {
  GL: { label: "General Ledger", description: "Core accounting engine, chart of accounts, journal entries", icon: "BookOpen" },
  AR: { label: "Accounts Receivable", description: "Customer invoicing, aging analysis, collections", icon: "ArrowDownLeft" },
  AP: { label: "Accounts Payable", description: "Supplier invoices, payment planning, vendor management", icon: "ArrowUpRight" },
  Treasury: { label: "Treasury", description: "Cash management, bank reconciliation, forecasting", icon: "Wallet" },
  FixedAssets: { label: "Fixed Assets", description: "Asset register, depreciation, leasing, GL integration", icon: "Landmark" },
  Reporting: { label: "Reporting Center", description: "Financial statements, analytics, dashboards", icon: "BarChart3" },
  Admin: { label: "Administration", description: "User management, roles, settings, audit logs", icon: "Settings" },
  Budget: { label: "Budget & Forecast", description: "Budget planning, variance analysis, multi-entity forecasting", icon: "Target" },
  Compliance: { label: "Compliance", description: "Internal controls, SOX/IFRS compliance, audit trails", icon: "Shield" },
  ProjectAccounting: { label: "Project Accounting", description: "Project costs, revenue tracking, WIP accounting", icon: "FolderKanban" },
  RiskManagement: { label: "Risk Management", description: "Financial risk scoring, operational risk monitoring", icon: "AlertTriangle" },
  Procurement: { label: "Procurement", description: "Purchase requisitions, supplier contracts, approvals", icon: "ShoppingCart" },
  Inventory: { label: "Inventory Control", description: "Stock management, warehouse operations, FIFO/Avg Cost valuation", icon: "Package" },
  Sales: { label: "Sales Orders", description: "Quote-to-cash, deliveries, pricing, credit limits", icon: "ShoppingBag" },
  Expenses: { label: "Expense Management", description: "Employee expenses, reimbursements, policy compliance", icon: "Receipt" },
};

// ─── License Service ───

export function checkLicense(tenantId: string, moduleName: ModuleName, licenses: License[]): { valid: boolean; reason: string; daysRemaining?: number } {
  const license = licenses.find(l => l.tenantId === tenantId && l.moduleName === moduleName && l.isActive);

  if (!license) {
    return { valid: false, reason: `No active license found for module ${moduleName}` };
  }

  const now = new Date();
  const end = new Date(license.endDate);
  const start = new Date(license.startDate);
  const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (now < start) {
    return { valid: false, reason: `License for ${moduleName} starts on ${license.startDate}`, daysRemaining };
  }

  if (now > end) {
    return { valid: false, reason: `License for ${moduleName} expired on ${license.endDate}`, daysRemaining: 0 };
  }

  if (license.licenseType === "per-seat" && license.maxUsers && (license.activeUsers || 0) >= license.maxUsers) {
    return { valid: false, reason: `Seat limit reached for ${moduleName} (${license.activeUsers}/${license.maxUsers})`, daysRemaining };
  }

  return { valid: true, reason: "License valid", daysRemaining };
}

export function getExpiringLicenses(licenses: License[], withinDays: number = 7): (License & { daysRemaining: number })[] {
  const now = new Date();
  return licenses
    .filter(l => l.isActive)
    .map(l => {
      const end = new Date(l.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { ...l, daysRemaining };
    })
    .filter(l => l.daysRemaining > 0 && l.daysRemaining <= withinDays)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ─── Dependency Checker ───

export function checkDependencies(moduleName: ModuleName, activeModules: ModuleName[]): { satisfied: boolean; missing: ModuleName[] } {
  const deps = MODULE_DEPENDENCIES[moduleName] || [];
  const missing = deps.filter(d => !activeModules.includes(d));
  return { satisfied: missing.length === 0, missing };
}

export function checkRemovalDependencies(moduleName: ModuleName, activeModules: ModuleName[]): { canRemove: boolean; dependents: ModuleName[] } {
  const dependents = activeModules.filter(m => MODULE_DEPENDENCIES[m]?.includes(moduleName));
  return { canRemove: dependents.length === 0, dependents };
}

// ─── Audit Trail ───

const auditChain: AuditEntry[] = [];

function computeHash(entry: Omit<AuditEntry, "hash">): string {
  const data = JSON.stringify({
    timestamp: entry.timestamp,
    tenantId: entry.tenantId,
    action: entry.action,
    moduleName: entry.moduleName,
    userId: entry.userId,
    details: entry.details,
    success: entry.success,
    previousHash: entry.previousHash,
  });
  // Browser-safe hash (simple deterministic hash)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function addAuditEntry(
  tenantId: string,
  action: AuditEntry["action"],
  moduleName: ModuleName,
  userId: string,
  details: string,
  success: boolean
): AuditEntry {
  const previousHash = auditChain.length > 0 ? auditChain[auditChain.length - 1].hash : "genesis";
  const entry: AuditEntry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    tenantId,
    action,
    moduleName,
    userId,
    details,
    success,
    previousHash,
  };
  entry.hash = computeHash(entry);
  auditChain.push(entry);
  return entry;
}

export function getAuditTrail(tenantId?: string): AuditEntry[] {
  if (tenantId) return auditChain.filter(e => e.tenantId === tenantId);
  return [...auditChain];
}

// ─── Module Manager ───

export interface AddModuleResult {
  success: boolean;
  message: string;
  moduleState?: ModuleState;
  auditEntry: AuditEntry;
}

export function addModule(
  moduleName: ModuleName,
  tenantId: string,
  userId: string,
  tenantModules: TenantModules,
  licenses: License[]
): AddModuleResult {
  // Check if already active
  const existing = tenantModules.modules.find(m => m.moduleName === moduleName);
  if (existing?.status === "active") {
    const audit = addAuditEntry(tenantId, "module_activated", moduleName, userId, "Module already active", false);
    return { success: false, message: `Module ${moduleName} is already active`, auditEntry: audit };
  }

  // Check license
  const licenseCheck = checkLicense(tenantId, moduleName, licenses);
  addAuditEntry(tenantId, "license_check", moduleName, userId, licenseCheck.reason, licenseCheck.valid);
  if (!licenseCheck.valid) {
    const audit = addAuditEntry(tenantId, "module_activated", moduleName, userId, `Activation blocked: ${licenseCheck.reason}`, false);
    return { success: false, message: licenseCheck.reason, auditEntry: audit };
  }

  // Check dependencies
  const activeModules = tenantModules.modules.filter(m => m.status === "active").map(m => m.moduleName);
  const depCheck = checkDependencies(moduleName, activeModules);
  addAuditEntry(tenantId, "dependency_check", moduleName, userId,
    depCheck.satisfied ? "All dependencies satisfied" : `Missing: ${depCheck.missing.join(", ")}`,
    depCheck.satisfied
  );
  if (!depCheck.satisfied) {
    const audit = addAuditEntry(tenantId, "module_activated", moduleName, userId,
      `Activation blocked: Missing dependencies ${depCheck.missing.join(", ")}`, false);
    return { success: false, message: `Missing required modules: ${depCheck.missing.join(", ")}`, auditEntry: audit };
  }

  // Activate
  const moduleState: ModuleState = {
    moduleName,
    status: "active",
    activatedAt: new Date().toISOString(),
    activatedBy: userId,
    licenseId: licenses.find(l => l.tenantId === tenantId && l.moduleName === moduleName)?.id,
  };

  if (existing) {
    Object.assign(existing, moduleState);
  } else {
    tenantModules.modules.push(moduleState);
  }
  tenantModules.updatedAt = new Date().toISOString();

  const audit = addAuditEntry(tenantId, "module_activated", moduleName, userId, `Module ${moduleName} activated successfully`, true);
  return { success: true, message: `Module ${moduleName} activated successfully`, moduleState, auditEntry: audit };
}

export function removeModule(
  moduleName: ModuleName,
  tenantId: string,
  userId: string,
  tenantModules: TenantModules
): AddModuleResult {
  const existing = tenantModules.modules.find(m => m.moduleName === moduleName);
  if (!existing || existing.status !== "active") {
    const audit = addAuditEntry(tenantId, "module_deactivated", moduleName, userId, "Module not active", false);
    return { success: false, message: `Module ${moduleName} is not active`, auditEntry: audit };
  }

  // Check if other modules depend on it
  const activeModules = tenantModules.modules.filter(m => m.status === "active").map(m => m.moduleName);
  const removalCheck = checkRemovalDependencies(moduleName, activeModules);
  if (!removalCheck.canRemove) {
    const audit = addAuditEntry(tenantId, "module_deactivated", moduleName, userId,
      `Removal blocked: ${removalCheck.dependents.join(", ")} depend on it`, false);
    return { success: false, message: `Cannot remove: modules ${removalCheck.dependents.join(", ")} depend on ${moduleName}`, auditEntry: audit };
  }

  existing.status = "inactive";
  existing.deactivatedAt = new Date().toISOString();
  tenantModules.updatedAt = new Date().toISOString();

  const audit = addAuditEntry(tenantId, "module_deactivated", moduleName, userId, `Module ${moduleName} deactivated`, true);
  return { success: true, message: `Module ${moduleName} deactivated`, moduleState: existing, auditEntry: audit };
}

export function getModuleStateJSON(tenantModules: TenantModules): string {
  return JSON.stringify({
    tenantId: tenantModules.tenantId,
    updatedAt: tenantModules.updatedAt,
    modules: tenantModules.modules.map(m => ({
      name: m.moduleName,
      label: MODULE_METADATA[m.moduleName].label,
      status: m.status,
      activatedAt: m.activatedAt,
      activatedBy: m.activatedBy,
    })),
    summary: {
      total: tenantModules.modules.length,
      active: tenantModules.modules.filter(m => m.status === "active").length,
      inactive: tenantModules.modules.filter(m => m.status === "inactive").length,
      expired: tenantModules.modules.filter(m => m.status === "license_expired").length,
    },
  }, null, 2);
}
