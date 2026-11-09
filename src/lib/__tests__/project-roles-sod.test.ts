import { describe, it, expect } from "vitest";
import {
  violatesProjectSoD,
  SOD_CONFLICTS,
  ALL_PROJECT_ROLES,
  REQUIRED_ROLES,
  ALL_PROJECT_ACTIONS,
  canDo,
  type ProjectRole,
  type ProjectPerms,
} from "@/lib/project-roles";

/**
 * Mirrors the server-side SoD check in the assign_project_role RPC.
 * Planner ⊕ Controller are mutually exclusive on a single user.
 * Accountant and Admin have no SoD conflicts.
 */

const permsFromRoles = (roles: ProjectRole[]): ProjectPerms => ({
  canCreate:         roles.some((r) => REQUIRED_ROLES.create_project.includes(r)),
  canEdit:           roles.some((r) => REQUIRED_ROLES.edit_project.includes(r)),
  canPostCost:       roles.some((r) => REQUIRED_ROLES.post_cost.includes(r)),
  canApproveCost:    roles.some((r) => REQUIRED_ROLES.approve_cost.includes(r)),
  canClose:          roles.some((r) => REQUIRED_ROLES.close_project.includes(r)),
  canManageSettings: roles.some((r) => REQUIRED_ROLES.manage_settings.includes(r)),
  canExport:         roles.some((r) => REQUIRED_ROLES.export.includes(r)),
  canViewSensitive:  roles.some((r) => REQUIRED_ROLES.view_sensitive.includes(r)),
});

describe("Project SoD — assign_project_role enforcement", () => {
  it("flags Planner → Controller conflict", () => {
    expect(violatesProjectSoD(["project_planner"], "project_controller")).toBe(true);
  });

  it("flags Controller → Planner conflict", () => {
    expect(violatesProjectSoD(["project_controller"], "project_planner")).toBe(true);
  });

  it("allows Planner with Accountant or Admin", () => {
    expect(violatesProjectSoD(["project_planner"], "project_accountant")).toBe(false);
    expect(violatesProjectSoD(["project_planner"], "project_admin")).toBe(false);
  });

  it("allows Controller with Accountant or Admin", () => {
    expect(violatesProjectSoD(["project_controller"], "project_accountant")).toBe(false);
    expect(violatesProjectSoD(["project_controller"], "project_admin")).toBe(false);
  });

  it("idempotent: re-adding an already-held role is not a violation", () => {
    for (const r of ALL_PROJECT_ROLES) {
      expect(violatesProjectSoD([r], r)).toBe(false);
    }
  });

  it("revoke → reassign: removing Planner then assigning Controller is allowed", () => {
    const initial: ProjectRole[] = ["project_planner", "project_accountant"];
    expect(violatesProjectSoD(initial, "project_controller")).toBe(true);
    const after = initial.filter((r) => r !== "project_planner");
    expect(violatesProjectSoD(after, "project_controller")).toBe(false);
  });

  it("revoke → reassign: removing Controller then assigning Planner is allowed", () => {
    const initial: ProjectRole[] = ["project_controller"];
    expect(violatesProjectSoD(initial, "project_planner")).toBe(true);
    const after = initial.filter((r) => r !== "project_controller");
    expect(violatesProjectSoD(after, "project_planner")).toBe(false);
  });

  it("Accountant and Admin have no SoD conflicts at all", () => {
    expect(SOD_CONFLICTS.project_accountant).toEqual([]);
    expect(SOD_CONFLICTS.project_admin).toEqual([]);
    for (const r of ALL_PROJECT_ROLES) {
      expect(violatesProjectSoD([r], "project_accountant")).toBe(false);
      expect(violatesProjectSoD([r], "project_admin")).toBe(false);
    }
  });

  it("empty role set never violates SoD", () => {
    for (const r of ALL_PROJECT_ROLES) {
      expect(violatesProjectSoD([], r)).toBe(false);
    }
  });

  it("SoD is symmetric for Planner/Controller", () => {
    expect(SOD_CONFLICTS.project_planner).toContain("project_controller");
    expect(SOD_CONFLICTS.project_controller).toContain("project_planner");
  });

  it("matrix: each action has at least one role and admin covers create/edit/close/settings", () => {
    for (const a of ALL_PROJECT_ACTIONS) {
      expect(REQUIRED_ROLES[a].length).toBeGreaterThan(0);
    }
    expect(REQUIRED_ROLES.create_project).toContain("project_admin");
    expect(REQUIRED_ROLES.close_project).toContain("project_admin");
    expect(REQUIRED_ROLES.manage_settings).toEqual(["project_admin"]);
  });

  it("matrix coherence: admin has every capability", () => {
    const p = permsFromRoles(["project_admin"]);
    for (const a of ALL_PROJECT_ACTIONS) {
      expect(canDo(p, a)).toBe(true);
    }
  });

  it("matrix coherence: planner cannot post or approve costs", () => {
    const p = permsFromRoles(["project_planner"]);
    expect(canDo(p, "create_project")).toBe(true);
    expect(canDo(p, "post_cost")).toBe(false);
    expect(canDo(p, "approve_cost")).toBe(false);
    expect(canDo(p, "manage_settings")).toBe(false);
  });

  it("matrix coherence: accountant posts but does not approve or create", () => {
    const p = permsFromRoles(["project_accountant"]);
    expect(canDo(p, "post_cost")).toBe(true);
    expect(canDo(p, "approve_cost")).toBe(false);
    expect(canDo(p, "create_project")).toBe(false);
    expect(canDo(p, "export")).toBe(true);
  });

  it("matrix coherence: controller approves and closes but does not post", () => {
    const p = permsFromRoles(["project_controller"]);
    expect(canDo(p, "approve_cost")).toBe(true);
    expect(canDo(p, "close_project")).toBe(true);
    expect(canDo(p, "post_cost")).toBe(false);
    expect(canDo(p, "create_project")).toBe(false);
  });

  it("re-assign loop: grant → revoke → grant restores capability", () => {
    let roles: ProjectRole[] = [];
    expect(violatesProjectSoD(roles, "project_planner")).toBe(false);
    roles = [...roles, "project_planner"];
    expect(canDo(permsFromRoles(roles), "create_project")).toBe(true);
    roles = roles.filter((r) => r !== "project_planner");
    expect(canDo(permsFromRoles(roles), "create_project")).toBe(false);
    expect(violatesProjectSoD(roles, "project_planner")).toBe(false);
    roles = [...roles, "project_planner"];
    expect(canDo(permsFromRoles(roles), "create_project")).toBe(true);
  });
});
