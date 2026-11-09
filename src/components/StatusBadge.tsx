import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Approved: "bg-primary/10 text-primary",
  Posted: "bg-success/10 text-success",
  Closed: "bg-destructive/10 text-destructive",
  Active: "text-success",
  Inactive: "text-muted-foreground",
  Pending: "bg-amber-50 text-amber-700",
  Paid: "bg-success/10 text-success",
  Overdue: "bg-destructive/10 text-destructive",
  Current: "bg-muted text-muted-foreground",
  Reversed: "bg-destructive/10 text-destructive",
  Created: "bg-muted text-muted-foreground",
  "Pending Approval": "bg-amber-50 text-amber-700",
  "Soldé": "bg-success/10 text-success",
  "Ouvert": "bg-primary/10 text-primary",
  Validated: "bg-primary/10 text-primary",
  // Generic semantic statuses
  success: "bg-success/10 text-success",
  error: "bg-destructive/10 text-destructive",
  warning: "bg-amber-50 text-amber-700",
  info: "bg-primary/10 text-primary",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase",
        statusStyles[status] || "bg-muted text-muted-foreground",
        className
      )}
    >
      {label || status}
    </span>
  );
}
