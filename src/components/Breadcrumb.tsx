import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Fil d’Ariane" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <span key={i} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          {i > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0" />}
          {item.href ? (
            <Link to={item.href} className="min-w-0 break-words hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ) : (
            <span aria-current={i === items.length - 1 ? "page" : undefined} className="min-w-0 break-words text-foreground font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
