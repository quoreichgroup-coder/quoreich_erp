import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, AlertTriangle, ArrowUpDown, CheckCheck, CheckCircle2, Inbox, MailOpen, RefreshCw, Search } from "lucide-react";
import {
  useERPAlertsPaginated,
  useMarkAllAlertsRead,
  useRealtimeAlerts,
  useResolveAlert,
  useResolveAllAlerts,
  type AlertSortField,
} from "@/hooks/use-alerts-data";
import {
  DEFAULT_PREFS,
  useNotificationPreferences,
} from "@/hooks/use-notification-preferences";
import { NotificationPreferencesPanel } from "@/components/NotificationPreferencesPanel";

const sevVariant: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  error: "destructive",
  warning: "default",
  info: "secondary",
};

const PAGE_SIZE = 25;

export default function Alerts() {
  useRealtimeAlerts();
  const { data: prefs } = useNotificationPreferences();

  const [includeResolved, setIncludeResolved] = useState<boolean>(DEFAULT_PREFS.include_resolved);
  const [module, setModule] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<AlertSortField>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showPrefs, setShowPrefs] = useState(false);

  // Hydrate from saved preferences on first load
  useEffect(() => {
    if (prefs) setIncludeResolved(prefs.include_resolved);
  }, [prefs]);

  // Server-side filter "module": if user has saved modules, narrow choices
  const allowedModules = prefs?.modules ?? [];
  const effectiveModule = useMemo(() => {
    if (module !== "all") return module;
    // If a single module is whitelisted, scope to it
    if (allowedModules.length === 1) return allowedModules[0];
    return "all";
  }, [module, allowedModules]);

  const { data, isLoading, isFetching, isError, refetch } = useERPAlertsPaginated({
    includeResolved,
    module: effectiveModule,
    severity,
    modules: prefs?.modules ?? [],
    severities: prefs?.severities ?? [],
    search,
    sortBy,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });


  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resolve = useResolveAlert();
  const markAllRead = useMarkAllAlertsRead();
  const resolveAll = useResolveAllAlerts();

  const toggleSort = (field: AlertSortField) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("desc"); }
    setPage(0);
  };

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [module, severity, search, includeResolved]);

  return (
    <PageShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alertes & Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Centre de notifications temps réel — AR/AP, Trésorerie, Procurement, HR, Compliance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={total > 0 ? "destructive" : "secondary"}>
            {total} résultat{total > 1 ? "s" : ""}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setShowPrefs((v) => !v)}>
            {showPrefs ? "Masquer préférences" : "Préférences"}
          </Button>
        </div>
      </div>

      {showPrefs && <NotificationPreferencesPanel />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres & actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="h-9 pl-8"
              aria-label="Rechercher dans les alertes"
            />
          </div>
          <Select value={module} onValueChange={setModule}>
            <SelectTrigger className="h-9 w-[180px]" aria-label="Module">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les modules</SelectItem>
              {(allowedModules.length > 0 ? allowedModules : [
                "ar","ap","gl","treasury","procurement","sales","inventory","hr","payroll",
                "fixed_assets","projects","compliance","risk","crm","budget",
              ]).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-9 w-[160px]" aria-label="Sévérité">
              <SelectValue placeholder="Sévérité" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="critical">Critique</SelectItem>
              <SelectItem value="error">Erreur</SelectItem>
              <SelectItem value="warning">Avertissement</SelectItem>
              <SelectItem value="info">Information</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={includeResolved ? "default" : "outline"}
            size="sm"
            onClick={() => setIncludeResolved((v) => !v)}
          >
            {includeResolved ? "Masquer résolues" : "Inclure résolues"}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <MailOpen className="h-3.5 w-3.5 mr-1.5" />
              Tout marquer lu
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => resolveAll.mutate({ module, severity })}
              disabled={resolveAll.isPending}
              title="Réservé aux administrateurs"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              Tout résoudre
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-2 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium">Erreur de chargement</p>
              <p className="text-xs mt-1 mb-3">La liste des alertes n'a pas pu être récupérée.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Réessayer
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm font-medium">Aucune alerte</p>
              <p className="text-xs mt-1">Tout est sous contrôle pour les filtres sélectionnés.</p>
            </div>
          ) : (

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("severity")}
                      aria-sort={sortBy === "severity" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      Sévérité <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("module")}
                      aria-sort={sortBy === "module" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      Module <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>Titre</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("created_at")}
                      aria-sort={sortBy === "created_at" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      Date <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id} className={a.read_at ? "opacity-70" : ""}>
                    <TableCell>
                      <Badge variant={sevVariant[a.severity] ?? "outline"}>
                        <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
                        {a.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs uppercase">{a.module}</TableCell>
                    <TableCell className="font-medium text-sm">{a.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                      {a.message}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString("fr-FR")}
                    </TableCell>
                    <TableCell>
                      {a.is_resolved ? (
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle2 className="h-3 w-3 text-success" />
                          Résolue
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.is_resolved && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resolve.mutate(a.id)}
                          disabled={resolve.isPending}
                        >
                          Résoudre
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
              <span>
                Page {page + 1} / {pageCount} — {total} résultat{total > 1 ? "s" : ""}
                {isFetching ? " (chargement…)" : ""}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0 || isFetching}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Précédent
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount || isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
