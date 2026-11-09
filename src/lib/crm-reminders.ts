// Pure bucketing logic for CRM reminders, extracted from CrmReminders.tsx.

import type { CrmActivity } from "@/hooks/use-crm-data";
import { canDo, type CrmPerms } from "@/lib/crm-roles";

export type ReminderBucket = "todo" | "overdue" | "done";

export function getReminderBucket(a: Pick<CrmActivity, "due_at" | "completed_at">, now = Date.now()): ReminderBucket {
  if (a.completed_at) return "done";
  const due = a.due_at ? new Date(a.due_at).getTime() : 0;
  if (due && due < now) return "overdue";
  return "todo";
}

export function bucketizeReminders<T extends Pick<CrmActivity, "due_at" | "completed_at">>(
  items: T[],
  now = Date.now(),
): { todo: T[]; overdue: T[]; done: T[] } {
  const todo: T[] = [];
  const overdue: T[] = [];
  const done: T[] = [];
  for (const a of items) {
    const b = getReminderBucket(a, now);
    if (b === "done") done.push(a);
    else if (b === "overdue") overdue.push(a);
    else todo.push(a);
  }
  return { todo, overdue, done };
}

/** True when the user is allowed to mark this activity complete. */
export function canCompleteReminder(
  perms: CrmPerms | undefined,
  a: Pick<CrmActivity, "completed_at">,
): boolean {
  if (!canDo(perms, "edit")) return false;
  if (a.completed_at) return false;
  return true;
}
