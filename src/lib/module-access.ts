import rules from "../../services/api/src/main/resources/module-access.json";
import type { MyAccess } from "@/hooks/use-my-access";

/** Same permission namespaces as the API; a role name never implies unrelated module access. */
export function canAccessPage(url: string, access: MyAccess | undefined): boolean {
  if (!access) return false;
  const parsed = new URL(url, "https://qerp.invalid");
  const path = parsed.pathname;
  if (path === "/docs" || path === "/onboarding") return true;
  const allowed = (rule: typeof rules[number]) => access.roles.includes("admin")
    || rule.permissions.some((prefix) => access.permissions.some((p) => p.startsWith(prefix)));
  if (path === "/settings" && !parsed.searchParams.get("tab")) {
    return rules.some((rule) => rule.web.some((page) => page.startsWith("/settings?tab=")) && allowed(rule));
  }
  const target = path === "/settings" ? `${path}?tab=${parsed.searchParams.get("tab") || "fiscal"}` : path;
  const matches = (prefix: string) => target === prefix || (!prefix.includes("?") && target.startsWith(`${prefix}/`));
  const rule = rules.find((r) => r.web.some(matches));
  if (!rule) return false;
  return allowed(rule);
}
