import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCashflowForecast, useGLAnomalyDetection, type GLAnomaly } from "@/hooks/use-ai-insights";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Sparkles, TrendingUp, AlertTriangle, RefreshCw, ShieldAlert,
  CalendarIcon, ChevronDown, History, ExternalLink,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

const severityColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
};

const fmt = (n: number, currency = "XOF") =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(n);

type PeriodMode = "preset" | "custom";

export function AiInsightsPanel() {
  const { toast } = useToast();
  const cashflow = useCashflowForecast();
  const anomalies = useGLAnomalyDetection();

  // Period selector for cashflow
  const [mode, setMode] = useState<PeriodMode>("preset");
  const [preset, setPreset] = useState<string>("30,60,90");
  const [range, setRange] = useState<DateRange | undefined>();

  // Period selector for anomalies (lookback days)
  const [anomalyDays, setAnomalyDays] = useState<string>("90");

  const handleRunForecast = () => {
    const params = mode === "preset"
      ? { horizons: preset.split(",").map((s) => Number(s.trim())).filter(Boolean) }
      : range?.from && range?.to
        ? { from: format(range.from, "yyyy-MM-dd"), to: format(range.to, "yyyy-MM-dd") }
        : { horizons: [30, 60, 90] };
    cashflow.mutate(params, {
      onError: (e) => toast({ title: "Prévision impossible", description: e.message, variant: "destructive" }),
    });
  };

  const handleRunAnomalies = () =>
    anomalies.mutate({ days: Number(anomalyDays) }, {
      onError: (e) => toast({ title: "Analyse impossible", description: e.message, variant: "destructive" }),
    });

  const currency = (cashflow.data?.inputs?.currency as string) ?? "XOF";

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <CardTitle>Insights IA</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Lovable AI</Badge>
            <Button asChild variant="ghost" size="sm">
              <Link to="/ai/history">
                <History className="w-4 h-4 mr-1" /> Historique
              </Link>
            </Button>
          </div>
        </div>
        <CardDescription>
          Prévision de trésorerie et détection d'anomalies basées sur vos données.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="cashflow">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="cashflow">
              <TrendingUp className="w-4 h-4 mr-2" /> Trésorerie
            </TabsTrigger>
            <TabsTrigger value="anomalies">
              <ShieldAlert className="w-4 h-4 mr-2" /> Anomalies GL
            </TabsTrigger>
          </TabsList>

          {/* Cash flow */}
          <TabsContent value="cashflow" className="space-y-4 mt-4">
            <div className="flex items-end gap-2 flex-wrap">
              <Select value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preset">Horizons standards</SelectItem>
                  <SelectItem value="custom">Plage personnalisée</SelectItem>
                </SelectContent>
              </Select>

              {mode === "preset" ? (
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 jours</SelectItem>
                    <SelectItem value="60">60 jours</SelectItem>
                    <SelectItem value="90">90 jours</SelectItem>
                    <SelectItem value="30,60,90">30 / 60 / 90 jours</SelectItem>
                    <SelectItem value="30,60,90,180">30 / 60 / 90 / 180 jours</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("min-w-[240px] justify-start", !range && "text-muted-foreground")}>
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {range?.from
                        ? range.to
                          ? `${format(range.from, "dd/MM/yy")} → ${format(range.to, "dd/MM/yy")}`
                          : format(range.from, "dd/MM/yy")
                        : "Choisir une plage"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      selected={range}
                      onSelect={setRange}
                      numberOfMonths={2}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              )}

              <Button size="sm" onClick={handleRunForecast} disabled={cashflow.isPending} className="ml-auto">
                <RefreshCw className={`w-4 h-4 mr-2 ${cashflow.isPending ? "animate-spin" : ""}`} />
                {cashflow.isPending ? "Analyse..." : "Lancer la prévision"}
              </Button>
            </div>

            {cashflow.data?.forecast && (
              <>
                <div className={`grid gap-3 ${cashflow.data.forecast.projections.length > 3 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
                  {cashflow.data.forecast.projections.map((p) => (
                    <div key={p.horizon} className="border rounded-lg p-3 bg-card">
                      <div className="text-xs text-muted-foreground">{p.horizon}</div>
                      <div className="text-lg font-semibold mt-1">{fmt(p.projected_cash, currency)}</div>
                      <div className={`text-xs mt-1 ${p.net_movement >= 0 ? "text-success" : "text-destructive"}`}>
                        {p.net_movement >= 0 ? "+" : ""}{fmt(p.net_movement, currency)}
                      </div>
                      <Badge variant="outline" className="mt-2 text-[10px]">Confiance: {p.confidence}</Badge>
                    </div>
                  ))}
                </div>
                <Alert>
                  <Sparkles className="w-4 h-4" />
                  <AlertTitle>
                    Synthèse — Risque{" "}
                    <Badge variant={severityColor[cashflow.data.forecast.risk_level] ?? "default"}>
                      {cashflow.data.forecast.risk_level}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription className="mt-2 space-y-2">
                    <p className="text-sm">{cashflow.data.forecast.summary}</p>
                    {cashflow.data.forecast.recommendations.length > 0 && (
                      <ul className="text-sm list-disc list-inside space-y-1">
                        {cashflow.data.forecast.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              </>
            )}

            {!cashflow.data && !cashflow.isPending && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Sélectionnez un horizon ou une plage personnalisée puis lancez la prévision.
              </p>
            )}
          </TabsContent>

          {/* Anomalies */}
          <TabsContent value="anomalies" className="space-y-4 mt-4">
            <div className="flex items-end gap-2 flex-wrap">
              <Select value={anomalyDays} onValueChange={setAnomalyDays}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 derniers jours</SelectItem>
                  <SelectItem value="60">60 derniers jours</SelectItem>
                  <SelectItem value="90">90 derniers jours</SelectItem>
                  <SelectItem value="180">180 derniers jours</SelectItem>
                </SelectContent>
              </Select>

              <Button size="sm" onClick={handleRunAnomalies} disabled={anomalies.isPending} className="ml-auto">
                <RefreshCw className={`w-4 h-4 mr-2 ${anomalies.isPending ? "animate-spin" : ""}`} />
                {anomalies.isPending ? "Analyse..." : "Analyser les écritures"}
              </Button>
            </div>

            {anomalies.data && (
              <>
                <div className="text-sm text-muted-foreground">
                  {anomalies.data.total_reviewed} écriture(s) analysée(s) —{" "}
                  <span className="font-medium text-foreground">{anomalies.data.anomalies.length}</span>{" "}
                  anomalie(s) détectée(s)
                </div>
                {anomalies.data.summary && (
                  <p className="text-sm italic text-muted-foreground">{anomalies.data.summary}</p>
                )}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {anomalies.data.anomalies.map((a, i) => (
                    <AnomalyCard key={i} anomaly={a} currency={currency} />
                  ))}
                  {anomalies.data.anomalies.length === 0 && (
                    <p className="text-sm text-success text-center py-4">
                      ✓ Aucune anomalie significative détectée.
                    </p>
                  )}
                </div>
              </>
            )}

            {!anomalies.data && !anomalies.isPending && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Cliquez sur « Analyser les écritures » pour examiner la période sélectionnée.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AnomalyCard({ anomaly, currency }: { anomaly: GLAnomaly; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle
            className={`w-4 h-4 ${
              anomaly.severity === "high" ? "text-destructive"
                : anomaly.severity === "medium" ? "text-warning" : "text-muted-foreground"
            }`}
          />
          <span className="font-medium text-sm">{anomaly.entry_ref}</span>
          <Badge variant={severityColor[anomaly.severity] ?? "default"} className="text-[10px]">
            {anomaly.severity}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{anomaly.type}</Badge>
          {anomaly.entry_date && (
            <span className="text-[10px] text-muted-foreground">{anomaly.entry_date}</span>
          )}
        </div>
        {anomaly.entry_id && (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2">
            <Link to={`/journal-entries?entry=${anomaly.entry_id}`}>
              <ExternalLink className="w-3 h-3 mr-1" /> Ouvrir
            </Link>
          </Button>
        )}
      </div>
      <p className="text-sm mt-2">{anomaly.description}</p>
      <p className="text-xs text-muted-foreground mt-1">💡 {anomaly.recommendation}</p>

      {anomaly.lines && anomaly.lines.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <ChevronDown className={`w-3 h-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
              {anomaly.lines.length} ligne(s) journal
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs">Compte</TableHead>
                  <TableHead className="h-8 text-xs">Libellé</TableHead>
                  <TableHead className="h-8 text-xs text-right">Débit</TableHead>
                  <TableHead className="h-8 text-xs text-right">Crédit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomaly.lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="py-1 text-xs font-mono">
                      {l.account_code ?? "—"} {l.account_name ? `· ${l.account_name}` : ""}
                    </TableCell>
                    <TableCell className="py-1 text-xs">{l.description ?? "—"}</TableCell>
                    <TableCell className="py-1 text-xs text-right tabular-nums">
                      {l.debit > 0 ? fmt(l.debit, currency) : "—"}
                    </TableCell>
                    <TableCell className="py-1 text-xs text-right tabular-nums">
                      {l.credit > 0 ? fmt(l.credit, currency) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
