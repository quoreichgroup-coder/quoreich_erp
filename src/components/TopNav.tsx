import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { Shield, Building2, LogOut, Palette } from "lucide-react";
import { useRef, useState } from "react";
import { AppearanceDialog } from "@/components/AppearanceSettings";
import { AppLogo } from "@/components/AppLogo";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { useTenantId } from "@/hooks/use-tenant";
import { useMyAccess } from "@/hooks/use-my-access";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, isApiEnabled } from "@/api/client";

/** Exercice en cours, lu dans le calendrier fiscal (remplace le libellé figé « AF 2025–2026 »). */
function TopNavFiscalYear() {
  const { data } = useFiscalCalendar();
  const today = new Date().toISOString().slice(0, 10);
  const fy = data?.years.find((y) => y.start_date <= today && today <= y.end_date);
  return (
    <span className="hidden xl:inline text-xs text-muted-foreground whitespace-nowrap">
      · {fy ? `Exercice ${fy.code}` : "Aucun exercice en cours"}
    </span>
  );
}

export function TopNav() {
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: tenantId } = useTenantId();
  const access = useMyAccess();

  const { data: tenant } = useQuery({
    queryKey: ["tenant-info", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      if (isApiEnabled()) return apiGet<{ name: string; currency: string } | null>("/api/v1/tenant");
      const { data } = await supabase
        .from("tenants")
        .select("name, currency")
        .eq("id", tenantId)
        .single();
      return data;
    },
    enabled: !!tenantId,
    staleTime: Infinity,
  });

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() || "??";

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-3 sm:px-4 lg:px-6 gap-2 sm:gap-4 min-w-0">
      {/* Mobile : le nom de la société se tronque, la partie droite ne se comprime pas (pas de débordement). */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <SidebarTrigger />

        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2 sm:rounded-md sm:border sm:border-border sm:px-2.5 sm:py-1.5">
          <AppLogo className="w-20 dark:brightness-0 dark:invert sm:hidden" />
          <Building2 className="hidden w-3.5 h-3.5 text-muted-foreground shrink-0 sm:block" />
          <span title={tenant?.name || undefined} className="truncate text-[10px] font-medium text-foreground sm:text-sm">{tenant?.name || "—"}</span>
          <span className="hidden text-[10px] text-muted-foreground shrink-0 sm:block">{tenant?.currency || ""}</span>
        </div>

        <TopNavFiscalYear />
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <CommandPalette />

        {access.isSuccess && access.data.roles.includes("admin") && (
          <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground border-border gap-1 hidden sm:flex">
            <Shield className="w-3 h-3" />
            Admin
          </Badge>
        )}
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={accountTrigger} type="button" size="icon" aria-label="Compte utilisateur" className="shrink-0 text-xs font-semibold">
              {initials}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={event => { if (appearanceOpen) event.preventDefault(); }}>
            <DropdownMenuLabel className="text-xs truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setAppearanceOpen(true)} className="min-h-11 cursor-pointer">
              <Palette className="mr-2 size-3.5" aria-hidden="true" />Apparence
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} returnFocusRef={accountTrigger} />
      </div>
    </header>
  );
}
