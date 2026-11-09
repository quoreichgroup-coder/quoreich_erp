import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Lock, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { SALES_ROLE_HINTS, type SalesAction } from "@/lib/sales-roles";

interface SalesEmptyStateProps {
  title: string;
  /** Pre-formatted filter summary line (période / client / statut). */
  filterSummary?: string;
  /** Optional guidance line below the summary. */
  hint?: string;
  /** When set, surfaces the missing-role hint for that action. */
  missingRoleFor?: SalesAction;
  className?: string;
  children?: ReactNode;
}

/**
 * Consistent empty-state block used by SalesReporting & SalesTransactions.
 * Always shows the active filters and (optionally) which Sales role is
 * required to perform the gated action.
 */
export function SalesEmptyState({
  title,
  filterSummary,
  hint,
  missingRoleFor,
  className,
  children,
}: SalesEmptyStateProps) {
  const Icon = missingRoleFor ? Lock : Inbox;
  return (
    <Card className={cn("border-dashed border-border", className)}>
      <CardContent className="p-8 text-center space-y-2">
        <div className="flex justify-center">
          <Icon className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {filterSummary && (
          <p className="text-[11px] text-muted-foreground font-mono">{filterSummary}</p>
        )}
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {missingRoleFor && (
          <p className="text-[11px] text-amber-700">{SALES_ROLE_HINTS[missingRoleFor]}</p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
