import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  LayoutDashboard, BookOpen, Users, Wallet, BarChart3, Settings,
  Landmark, ArrowDownLeft, ArrowUpRight, Shield, Target,
  FolderKanban, AlertTriangle, ShoppingCart, Package, ShoppingBag, Receipt,
  ClipboardList, UserCog, HelpCircle, Blocks, Search,
} from "lucide-react";

const allPages = [
  { title: "Tableau de bord CFO", url: "/", icon: LayoutDashboard, group: "Navigation" },
  // AR
  { title: "Comptes clients (AR)", url: "/receivables", icon: ArrowDownLeft, group: "Finance" },
  { title: "AR — Transactions", url: "/receivables/transactions", icon: ArrowDownLeft, group: "Finance" },
  { title: "AR — Analyse d'âge", url: "/receivables/aging", icon: ArrowDownLeft, group: "Finance" },
  { title: "Clients", url: "/customers", icon: Users, group: "Finance" },
  // AP
  { title: "Comptes fournisseurs (AP)", url: "/payables", icon: ArrowUpRight, group: "Finance" },
  { title: "AP — Factures fournisseurs", url: "/payables/transactions", icon: ArrowUpRight, group: "Finance" },
  { title: "AP — Planification paiements", url: "/payables/payment-planning", icon: ArrowUpRight, group: "Finance" },
  { title: "Fournisseurs", url: "/suppliers", icon: Users, group: "Finance" },
  // GL
  { title: "Grand Livre (GL)", url: "/journal", icon: BookOpen, group: "Finance" },
  { title: "GL — Transactions", url: "/journal/transactions", icon: BookOpen, group: "Finance" },
  { title: "GL — Plan comptable", url: "/journal/master-data", icon: BookOpen, group: "Finance" },
  // Treasury
  { title: "Trésorerie", url: "/treasury", icon: Wallet, group: "Finance" },
  // Assets
  { title: "Immobilisations", url: "/assets", icon: Landmark, group: "Finance" },
  // Budget
  { title: "Budget & Prévisions", url: "/budget", icon: Target, group: "Finance" },
  // Projects
  { title: "Gestion de projets", url: "/projects", icon: FolderKanban, group: "Finance" },
  // Procurement
  { title: "Approvisionnement", url: "/procurement", icon: ShoppingCart, group: "Finance" },
  // Inventory
  { title: "Gestion des stocks", url: "/inventory", icon: Package, group: "Finance" },
  // Sales
  { title: "Commandes de vente", url: "/sales", icon: ShoppingBag, group: "Finance" },
  // Expenses
  { title: "Gestion des dépenses", url: "/expenses", icon: Receipt, group: "Finance" },
  // Global
  { title: "Centre de rapports", url: "/reports", icon: BarChart3, group: "Général" },
  { title: "Conformité", url: "/compliance", icon: Shield, group: "Général" },
  { title: "Gestion des risques", url: "/risk", icon: AlertTriangle, group: "Général" },
  { title: "Gestion des modules", url: "/admin/modules", icon: Blocks, group: "Général" },
  { title: "Audit & Journaux", url: "/settings?tab=audit", icon: ClipboardList, group: "Général" },
  { title: "Administration", url: "/settings", icon: Settings, group: "Général" },
  { title: "Utilisateurs & Rôles", url: "/settings?tab=roles", icon: UserCog, group: "Général" },
  { title: "Documentation", url: "/docs", icon: HelpCircle, group: "Général" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = useCallback(
    (url: string) => {
      setOpen(false);
      navigate(url);
    },
    [navigate],
  );

  const groups = [...new Set(allPages.map((p) => p.group))];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-xs text-muted-foreground"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Rechercher…</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Rechercher une page, un module…" />
        <CommandList>
          <CommandEmpty>Aucun résultat trouvé.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {allPages
                .filter((p) => p.group === group)
                .map((page) => (
                  <CommandItem
                    key={page.url}
                    value={page.title}
                    onSelect={() => handleSelect(page.url)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <page.icon className="w-4 h-4 text-muted-foreground" />
                    <span>{page.title}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
