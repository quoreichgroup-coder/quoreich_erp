import { useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Blocks, BookOpen, Building2, CalendarDays,
  ChevronDown, ClipboardList, FolderKanban, Gauge, Handshake, HelpCircle, History, Landmark, LayoutDashboard,
  Package, Receipt, Settings, Shield, ShoppingBag, ShoppingCart, Target, Upload, UserCog, UsersRound, Wallet,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useActiveModules } from "@/hooks/use-active-modules";
import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { NAV_SECTIONS, isLinkActive, visibleModules, type NavLinkEntry, type NavModule } from "@/lib/navigation";
import { FISCAL_YEAR_STATUS_LABELS } from "@/lib/fiscal-calendar";

const ICONS: Record<string, React.ElementType> = {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Blocks, BookOpen, Building2, CalendarDays,
  ClipboardList, FolderKanban, Gauge, Handshake, HelpCircle, History, Landmark, LayoutDashboard, Package,
  Receipt, Settings, Shield, ShoppingBag, ShoppingCart, Target, Upload, UserCog, UsersRound, Wallet,
};
const iconOf = (name: string) => ICONS[name] ?? LayoutDashboard;

function CollapsibleModule({ module }: { module: NavModule }) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(module.basePath) || module.items.some((s) => s.url === location.pathname);
  const [open, setOpen] = useState(isActive);
  const Icon = iconOf(module.icon);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium tracking-wide transition-colors",
          "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
          isActive && "text-sidebar-foreground",
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">{module.title}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-5 border-l border-sidebar-border pl-3 py-0.5">
          {module.items.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              end
              className="block px-3 py-1.5 text-[12px] text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 rounded transition-colors"
              activeClassName="text-sidebar-accent-foreground bg-sidebar-accent font-medium"
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function SimpleLink({ link }: { link: NavLinkEntry }) {
  const location = useLocation();
  const active = isLinkActive(link.url, location.pathname, location.search);
  const Icon = iconOf(link.icon);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link to={link.url} aria-current={active ? "page" : undefined}
          className={cn("flex items-center gap-3 px-4 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium")}>
          <Icon className="w-4 h-4 shrink-0" /><span>{link.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Exercice en cours, lu dans le calendrier fiscal (plus de libellé figé). */
function CurrentFiscalYear() {
  const { data } = useFiscalCalendar();
  const today = new Date().toISOString().slice(0, 10);
  const fy = data?.years.find((y) => y.start_date <= today && today <= y.end_date);
  return (
    <Link to="/settings?tab=fiscal" className="text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground">
      {fy ? `Exercice ${fy.code} · ${FISCAL_YEAR_STATUS_LABELS[fy.status].toLowerCase()}` : "Aucun exercice en cours"}
    </Link>
  );
}

export function DashboardSidebar() {
  const { data: activeModules } = useActiveModules();

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div className="w-7 h-7 bg-sidebar-accent-foreground rounded flex items-center justify-center">
          <BarChart3 className="w-3.5 h-3.5 text-sidebar-background" />
        </div>
        <span className="font-semibold text-sm text-sidebar-primary tracking-wide">QUOREICH</span>
      </div>

      <SidebarContent className="pt-3 space-y-0">
        {NAV_SECTIONS.map((section) => {
          const modules = visibleModules(section.modules, activeModules);
          const links = section.links ?? [];
          if (modules.length === 0 && links.length === 0) return null;
          return (
            <SidebarGroup key={section.id} data-testid={`nav-section-${section.id}`}>
              <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest font-semibold px-4 mb-1">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                {modules.map((m) => <CollapsibleModule key={m.basePath} module={m} />)}
                {links.length > 0 && <SidebarMenu>{links.map((l) => <SimpleLink key={l.url} link={l} />)}</SidebarMenu>}
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <div className="mt-auto p-4 border-t border-sidebar-border">
        <CurrentFiscalYear />
      </div>
    </Sidebar>
  );
}
