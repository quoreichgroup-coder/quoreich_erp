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
    <nav aria-label="Pièces de la page Transactions" className="inline-flex flex-wrap items-center gap-1 rounded-md bg-muted p-1" data-testid="transaction-tabs">
      {tabs.map((t) => (
        <Link key={t.url} to={t.url} role="tab" aria-selected={pathname === t.url}
          className={cn("rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
            pathname === t.url ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {t.title}
        </Link>
      ))}
    </nav>
  );
}
