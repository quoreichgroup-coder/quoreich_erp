import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAiHistoryInfinite,
  useCashflowForecast,
  useGLAnomalyDetection,
  type AiHistoryRow,
  type CashflowParams,
} from "@/hooks/use-ai-insights";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft, History, Sparkles, Eye, Clock, Bot, User,
  CalendarIcon, RotateCw, X, Loader2, ChevronDown,
} from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  cashflow_forecast: "Prévision trésorerie",
  gl_anomaly_detection: "Détection anomalies GL",
};

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  success: "default",
  partial: "secondary",
  error: "destructive",
};

const PAGE_SIZE = 25;

export default function AiHistory() {
  const [type, setType] = useState<"all" | AiHistoryRow["analysis_type"]>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const dateFromIso = useMemo(() => {
    if (!dateFrom) return undefined;
    const d = new Date(dateFrom); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [dateFrom]);
  const dateToIso = useMemo(() => {
    if (!dateTo) return undefined;
    const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [dateTo]);

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useAiHistoryInfinite({
    type: type === "all" ? undefined : type,
    pageSize: PAGE_SIZE,
    dateFrom: dateFromIso,
    dateTo: dateToIso,
  });

  const rows = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data]);

  const [selected, setSelected] = useState<AiHistoryRow | null>(null);
  const [confirmRow, setConfirmRow] = useState<AiHistoryRow | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const cashflow = useCashflowForecast();
  const anomalies = useGLAnomalyDetection();
  const isRerunning = !!rerunningId;

  const stats = useMemo(() => ({
    total: rows.length,
    scheduled: rows.filter((r) => r.trigger_source === "scheduled").length,
    errors: rows.filter((r) => r.status === "error").length,
  }), [rows]);

  const runAnalysis = async (row: AiHistoryRow) => {
    setRerunningId(row.id);
    try {
      if (row.analysis_type === "cashflow_forecast") {
        await cashflow.mutateAsync(row.params as CashflowParams);
      } else {
        await anomalies.mutateAsync(row.params as { days?: number });
      }
      toast({
        title: "Analyse relancée",
        description: `${TYPE_LABEL[row.analysis_type]} exécutée avec les mêmes paramètres.`,
      });
    } catch (e) {
      toast({
        title: "Échec de la relance",
        description: e instanceof Error ? e.message : "Erreur inconnue",
        variant: "destructive",
      });
    } finally {
      setRerunningId(null);
      setConfirmRow(null);
    }
  };

  const clearDates = () => { setDateFrom(undefined); setDateTo(undefined); };

  return (
    <PageShell>
      {isRerunning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary/10 border-b border-primary/20 backdrop-blur">
          <div className="flex items-center justify-center gap-2 py-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="font-medium">Analyse IA en cours d'exécution…</span>
            <span className="text-muted-foreground">Cela peut prendre quelques secondes.</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
              <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Retour au Dashboard</Link>
            </Button>
            <div className="flex items-center gap-2">
              <History className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-semibold">Historique des analyses IA</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Consultez toutes les exécutions manuelles et planifiées des analyses IA.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardDescription>Affichées</CardDescription></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{stats.total}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Planifiées</CardDescription></CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" /> {stats.scheduled}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Échecs</CardDescription></CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold ${stats.errors > 0 ? "text-destructive" : ""}`}>
                {stats.errors}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Exécutions
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {dateFrom ? format(dateFrom, "dd MMM yyyy", { locale: fr }) : "Date début"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {dateTo ? format(dateTo, "dd MMM yyyy", { locale: fr }) : "Date fin"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
                {(dateFrom || dateTo) && (
                  <Button variant="ghost" size="sm" onClick={clearDates}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
                <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <TabsList>
                    <TabsTrigger value="all">Tous</TabsTrigger>
                    <TabsTrigger value="cashflow_forecast">Trésorerie</TabsTrigger>
                    <TabsTrigger value="gl_anomaly_detection">Anomalies GL</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Durée</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Aucune analyse trouvée pour ces critères.
                  </TableCell></TableRow>
                )}
                {rows.map((r) => {
                  const isThisRunning = rerunningId === r.id;
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="text-sm">
                        {format(new Date(r.created_at), "dd MMM yyyy HH:mm", { locale: fr })}
                      </TableCell>
                      <TableCell><Badge variant="outline">{TYPE_LABEL[r.analysis_type]}</Badge></TableCell>
                      <TableCell>
                        {r.trigger_source === "scheduled" ? (
                          <span className="inline-flex items-center gap-1 text-xs"><Bot className="w-3 h-3" /> Planifié</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs"><User className="w-3 h-3" /> Manuel</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isThisRunning ? (
                          <Badge variant="secondary" className="gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> En cours
                          </Badge>
                        ) : (
                          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isRerunning}
                            onClick={(e) => { e.stopPropagation(); setConfirmRow(r); }}
                            title="Rejouer avec les mêmes paramètres"
                          >
                            {isThisRunning ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <RotateCw className="w-4 h-4 mr-1" />
                            )}
                            Relancer
                          </Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
                            <Eye className="w-4 h-4 mr-1" /> Détail
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {isFetchingNextPage && (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`sk-next-${i}`}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <div className="flex justify-center pt-4">
              {hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Chargement...</>
                  ) : (
                    <><ChevronDown className="w-4 h-4 mr-2" /> Charger plus</>
                  )}
                </Button>
              ) : rows.length > 0 ? (
                <p className="text-xs text-muted-foreground">Toutes les exécutions ont été chargées.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {selected ? TYPE_LABEL[selected.analysis_type] : ""}
            </SheetTitle>
            {selected && (
              <SheetDescription className="flex items-center gap-2 text-xs">
                <Clock className="w-3 h-3" />
                {format(new Date(selected.created_at), "dd MMM yyyy 'à' HH:mm:ss", { locale: fr })}
                {" · "}
                {selected.trigger_source === "scheduled" ? "Exécution planifiée" : "Exécution manuelle"}
              </SheetDescription>
            )}
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-6">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={isRerunning}
                  onClick={() => setConfirmRow(selected)}
                >
                  {rerunningId === selected.id ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Exécution…</>
                  ) : (
                    <><RotateCw className="w-4 h-4 mr-1" /> Relancer cette analyse</>
                  )}
                </Button>
              </div>
              {selected.error_message && (
                <div className="border border-destructive/30 bg-destructive/5 p-3 rounded text-sm">
                  <strong className="text-destructive">Erreur :</strong> {selected.error_message}
                </div>
              )}
              <Section title="Paramètres" json={selected.params} />
              <Section title="Données analysées (entrées)" json={selected.inputs} />
              <Section title="Résultat" json={selected.result} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && !isRerunning && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Relancer l'analyse ?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow && (
                <>
                  Vous êtes sur le point de rejouer <strong>{TYPE_LABEL[confirmRow.analysis_type]}</strong> avec
                  les mêmes paramètres que l'exécution du{" "}
                  {format(new Date(confirmRow.created_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}.
                  <br /><br />
                  Une nouvelle entrée sera créée dans l'historique. Confirmer ?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRerunning}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRerunning}
              onClick={(e) => { e.preventDefault(); if (confirmRow) runAnalysis(confirmRow); }}
            >
              {isRerunning ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> En cours…</>
              ) : (
                <><RotateCw className="w-4 h-4 mr-1" /> Confirmer et relancer</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function Section({ title, json }: { title: string; json: unknown }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-muted-foreground mb-2">{title}</div>
      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-72 overflow-y-auto">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}
