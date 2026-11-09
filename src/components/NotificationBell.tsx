import { AlertCircle, AlertTriangle, Bell, CheckCheck, CheckCircle2, MailOpen, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useERPAlerts,
  useMarkAllAlertsRead,
  useRealtimeAlerts,
  useResolveAlert,
  useResolveAllAlerts,
} from "@/hooks/use-alerts-data";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";

const sevTone: Record<string, string> = {
  critical: "text-rose-600",
  error: "text-rose-600",
  warning: "text-amber-600",
  info: "text-sky-600",
};

export function NotificationBell() {
  useRealtimeAlerts();
  const { data: prefs } = useNotificationPreferences();
  const { data: alerts = [], isLoading, isError, refetch, isFetching } = useERPAlerts({
    includeResolved: prefs?.include_resolved ?? false,
    modules: prefs?.modules ?? [],
    severities: prefs?.severities ?? [],
  });
  const resolve = useResolveAlert();
  const markAllRead = useMarkAllAlertsRead();
  const resolveAll = useResolveAllAlerts();
  const unread = alerts.filter((a) => !a.read_at).length;
  const count = alerts.length;


  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}
          data-testid="notification-bell"
        >
          <Bell className="w-4 h-4 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
          <span>Notifications</span>
          <Badge variant="outline" className="text-[10px]">{count}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] flex-1"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending || unread === 0}
          >
            <MailOpen className="h-3 w-3 mr-1" />
            Tout marquer lu
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] flex-1 text-destructive hover:text-destructive"
            onClick={() => resolveAll.mutate({})}
            disabled={resolveAll.isPending || count === 0}
            title="Réservé aux administrateurs"
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Tout résoudre
          </Button>
        </div>
        <DropdownMenuSeparator />
        <ScrollArea className="max-h-[360px]">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : isError ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <AlertCircle className="h-5 w-5 mx-auto mb-2 text-destructive" />
              <p>Impossible de charger les alertes.</p>
              <Button size="sm" variant="ghost" className="mt-2 h-7" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className="h-3 w-3 mr-1" /> Réessayer
              </Button>
            </div>
          ) : alerts.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-success opacity-70" />
              Aucune alerte active.
            </div>
          ) : (

            <ul className="divide-y">
              {alerts.slice(0, 8).map((a) => (
                <li key={a.id} className={`px-3 py-2.5 hover:bg-muted/40 ${a.read_at ? "opacity-70" : ""}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={`h-4 w-4 mt-0.5 shrink-0 ${sevTone[a.severity] ?? "text-muted-foreground"}`}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{a.message}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {a.module}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2"
                          onClick={() => resolve.mutate(a.id)}
                          disabled={resolve.isPending}
                        >
                          Résoudre
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <DropdownMenuSeparator />
        <div className="p-2">
          <Link
            to="/alerts"
            className="block text-center text-xs text-primary hover:underline py-1"
          >
            Voir toutes les alertes →
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

