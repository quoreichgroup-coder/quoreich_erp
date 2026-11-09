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
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:px-6 gap-4">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="lg:hidden" />

        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border">
          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{tenant?.name || "—"}</span>
          <span className="text-[10px] text-muted-foreground">{tenant?.currency || ""}</span>
        </div>

        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">AF 2025–2026</span>
      </div>

      <div className="flex items-center gap-3">
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
