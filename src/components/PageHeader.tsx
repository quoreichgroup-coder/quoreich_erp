import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-3", className)}>
    <div className="min-w-0 max-w-full">
      <div aria-hidden="true" data-brand-accent="heading" className="mb-2 h-1 w-8 rounded-full bg-brand-accent" />
      <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
      {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
    </div>
    {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
