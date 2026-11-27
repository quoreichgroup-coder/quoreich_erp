import { useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Blocks, BookOpen, Building2, CalendarDays,
  ChevronDown, ClipboardList, FolderKanban, Gauge, Handshake, HelpCircle, History, Landmark, LayoutDashboard,
  Package, Receipt, Settings, Shield, ShoppingBag, ShoppingCart, Target, Upload, UserCog, UsersRound, Wallet,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { AppLogo } from "@/components/AppLogo";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useActiveModules } from "@/hooks/use-active-modules";
import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { NAV_SECTIONS, isLinkActive, visibleModules, type NavLinkEntry, type NavModule } from "@/lib/navigation";
import { FISCAL_YEAR_STATUS_LABELS } from "@/lib/fiscal-calendar";
import { useMyAccess } from "@/hooks/use-my-access";
import { canAccessPage } from "@/lib/module-access";
import { useTranslation } from "react-i18next";
import { navItemKey, navModuleKey, navSectionKey } from "@/i18n/nav-keys";

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
  const { t } = useTranslation("nav");
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium tracking-wide",
          "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sidebar-ring",
          isActive && "text-sidebar-foreground",
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">{t(navModuleKey(module.basePath), { defaultValue: module.title })}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-5 border-l border-sidebar-border pl-3 py-0.5">
          {module.items.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              end
              className={cn("block px-3 py-1.5 text-[12px] text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
                // Onglets de Transactions répartis sur plusieurs pages : l'entrée reste allumée.
                item.also?.includes(location.pathname) && "brand-nav-active text-sidebar-accent-foreground bg-sidebar-accent font-medium")}
              activeClassName="brand-nav-active text-sidebar-accent-foreground bg-sidebar-accent font-medium"
            >
              {t(navItemKey(item.url), { defaultValue: item.title })}
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
  const { t } = useTranslation("nav");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link to={link.url} aria-current={active ? "page" : undefined}
          className={cn("flex items-center gap-3 px-4 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            active && "brand-nav-active bg-sidebar-accent text-sidebar-accent-foreground font-medium")}>
          <Icon className="w-4 h-4 shrink-0" /><span>{t(navItemKey(link.url), { defaultValue: link.title })}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Exercice en cours, lu dans le calendrier fiscal (plus de libellé figé). */
function CurrentFiscalYear() {
  const { data } = useFiscalCalendar();
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const fy = data?.years.find((y) => y.start_date <= today && today <= y.end_date);
  return (
    <Link to="/settings?tab=fiscal" className="rounded text-[11px] text-sidebar-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sidebar-ring">
      {fy ? t("fiscal.current_status", { code: fy.code, status: FISCAL_YEAR_STATUS_LABELS[fy.status].toLowerCase() }) : t("fiscal.none")}
    </Link>
  );
}

export function DashboardSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: activeModules } = useActiveModules();
  const access = useMyAccess();
  const canOpen = (url: string) => access.isSuccess && canAccessPage(url, access.data);
  const { t } = useTranslation("nav");

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <div data-sidebar="brand" className="flex h-14 w-full shrink-0 items-center justify-center rounded-bl-xl border-b border-border bg-white px-4">
        <AppLogo className="w-32" />
      </div>

      <SidebarContent className="pt-3 space-y-0" onClick={(event) => {
        if (isMobile && event.target instanceof Element && event.target.closest("a[href]")) setOpenMobile(false);
      }}>
        {NAV_SECTIONS.map((section) => {
          const modules = visibleModules(section.modules, activeModules)
            .filter((m) => canOpen(m.basePath))
            .map((m) => ({ ...m, items: m.items.filter((item) => canOpen(item.url)) }));
          const links = (section.links ?? []).filter((link) => canOpen(link.url));
          if (modules.length === 0 && links.length === 0) return null;
          return (
            <SidebarGroup key={section.id} data-testid={`nav-section-${section.id}`}>
              <SidebarGroupLabel className="text-sidebar-foreground text-[10px] uppercase tracking-widest font-semibold px-4 mb-1">
                {t(navSectionKey(section.id), { defaultValue: section.label })}
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
        {canOpen("/settings?tab=fiscal") && <CurrentFiscalYear />}
      </div>
    </Sidebar>
  );
}
