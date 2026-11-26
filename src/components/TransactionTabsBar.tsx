import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TRANSACTION_TABS } from "@/lib/navigation";

/**
 * Onglets de « Transactions » d'un module dont les pièces vivent sur plusieurs pages (CRM, RH et
 * paie) : même présentation qu'Approvisionnement, une pièce par onglet (standard de présentation).
 */
export function TransactionTabsBar({ module }: { module: keyof typeof TRANSACTION_TABS | string }) {
  const { pathname } = useLocation();
  const tabs = TRANSACTION_TABS[module] ?? [];
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Pièces de la page Transactions" className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-md bg-muted p-1" data-testid="transaction-tabs">
      {tabs.map((t) => (
        <Link key={t.url} to={t.url} aria-current={pathname === t.url ? "page" : undefined}
          className={cn("shrink-0 whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-1.5",
            pathname === t.url ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {t.title}
        </Link>
      ))}
    </nav>
  );
}
