import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";
import { Shield, Building2, LogOut } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { useTenantId } from "@/hooks/use-tenant";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Exercice en cours, lu dans le calendrier fiscal (remplace le libellé figé « AF 2025–2026 »). */
function TopNavFiscalYear() {
  const { data } = useFiscalCalendar();
  const today = new Date().toISOString().slice(0, 10);
  const fy = data?.years.find((y) => y.start_date <= today && today <= y.end_date);
  return (
    <span className="hidden md:inline text-xs text-muted-foreground whitespace-nowrap">
      · {fy ? `Exercice ${fy.code}` : "Aucun exercice en cours"}
    </span>
  );
}

export function TopNav() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: tenantId } = useTenantId();

  const { data: tenant } = useQuery({
    queryKey: ["tenant-info", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
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
        <SidebarTrigger className="lg:hidden shrink-0" />

        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border min-w-0">
          <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{tenant?.name || "—"}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{tenant?.currency || ""}</span>
        </div>

        <TopNavFiscalYear />
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <CommandPalette />

        <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground border-border gap-1 hidden sm:flex">
          <Shield className="w-3 h-3" />
          Admin
        </Badge>
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
