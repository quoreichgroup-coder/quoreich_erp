import type { ReactNode } from "react";
import { useMyAccess } from "@/hooks/use-my-access";
import { canAccessPage } from "@/lib/module-access";

/** Keep GL widgets and their queries out of a page when its user has no accounting access. */
export function AccountingAccess({ children }: { children: ReactNode }) {
  const access = useMyAccess();
  return access.isSuccess && canAccessPage("/journal", access.data) ? <>{children}</> : null;
}
