import { describe, it, expect } from "vitest";
import {
  bucketizeReminders,
  getReminderBucket,
  canCompleteReminder,
} from "@/lib/crm-reminders";
import type { CrmPerms } from "@/lib/crm-roles";

const NOW = new Date("2026-06-28T12:00:00Z").getTime();

function perms(p: Partial<CrmPerms>): CrmPerms {
  return {
    canView: false, canCreate: false, canEdit: false, canDelete: false,
    canApproveDiscount: false, canConvert: false, canExport: false,
    canViewSensitive: false, canAudit: false, canManageSettings: false,
    ...p,
  };
}

const items = [
  { id: "1", due_at: "2026-06-30T10:00:00Z", completed_at: null }, // todo
  { id: "2", due_at: "2026-06-27T10:00:00Z", completed_at: null }, // overdue
  { id: "3", due_at: "2026-06-20T10:00:00Z", completed_at: "2026-06-25T10:00:00Z" }, // done
  { id: "4", due_at: null,                   completed_at: null }, // todo (pas d'échéance)
  { id: "5", due_at: "2026-06-27T10:00:00Z", completed_at: "2026-06-29T10:00:00Z" }, // done (priorité sur overdue)
];

describe("crm-reminders — logique due_at / completed_at", () => {
  it("getReminderBucket priorise completed_at sur l'échéance dépassée", () => {
    expect(getReminderBucket(items[4], NOW)).toBe("done");
  });
  it("classe due_at > now sans completed_at en 'todo'", () => {
    expect(getReminderBucket(items[0], NOW)).toBe("todo");
  });
  it("classe due_at < now sans completed_at en 'overdue'", () => {
    expect(getReminderBucket(items[1], NOW)).toBe("overdue");
  });
  it("classe due_at absent en 'todo' (rappel non daté)", () => {
    expect(getReminderBucket(items[3], NOW)).toBe("todo");
  });
});

describe("crm-reminders — bucketize", () => {
  it("répartit correctement les rappels dans les 3 onglets", () => {
    const { todo, overdue, done } = bucketizeReminders(items, NOW);
    expect(todo.map((x) => x.id).sort()).toEqual(["1", "4"]);
    expect(overdue.map((x) => x.id)).toEqual(["2"]);
    expect(done.map((x) => x.id).sort()).toEqual(["3", "5"]);
  });

  it("tableau vide -> trois buckets vides", () => {
    const out = bucketizeReminders([], NOW);
    expect(out.todo).toEqual([]);
    expect(out.overdue).toEqual([]);
    expect(out.done).toEqual([]);
  });

  it("frontière : due_at == now reste 'todo' (strictement inférieur => overdue)", () => {
    const just = { due_at: new Date(NOW).toISOString(), completed_at: null };
    expect(getReminderBucket(just, NOW)).toBe("todo");
  });
});

describe("crm-reminders — bouton « Terminé »", () => {
  it("désactivé sans canEdit (consultation seule)", () => {
    expect(canCompleteReminder(perms({ canView: true }), { completed_at: null })).toBe(false);
  });
  it("désactivé sur un rappel déjà terminé (idempotence)", () => {
    expect(
      canCompleteReminder(perms({ canEdit: true }), { completed_at: "2026-06-27T10:00:00Z" }),
    ).toBe(false);
  });
  it("activé pour un rappel non terminé avec canEdit", () => {
    expect(canCompleteReminder(perms({ canEdit: true }), { completed_at: null })).toBe(true);
  });
  it("perms=undefined -> bouton verrouillé", () => {
    expect(canCompleteReminder(undefined, { completed_at: null })).toBe(false);
  });
});
