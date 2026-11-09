import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAiSchedules, useUpsertAiSchedule, type AiScheduleRow } from "@/hooks/use-ai-insights";
import { useToast } from "@/hooks/use-toast";
import { Bot, Calendar, Save, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const TYPES: Array<{ key: AiScheduleRow["analysis_type"]; label: string; desc: string }> = [
  { key: "cashflow_forecast", label: "Prévision de trésorerie", desc: "Projette la trésorerie sur 30/60/90 jours." },
  { key: "gl_anomaly_detection", label: "Détection anomalies GL", desc: "Audite les écritures journal récentes." },
];

interface FormState {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
}

export function AiSchedulesSettings() {
  const { data: schedules = [], isLoading } = useAiSchedules();
  const upsert = useUpsertAiSchedule();
  const { toast } = useToast();
  const [forms, setForms] = useState<Record<string, FormState>>({});

  useEffect(() => {
    const next: Record<string, FormState> = {};
    for (const t of TYPES) {
      const existing = schedules.find((s) => s.analysis_type === t.key);
      next[t.key] = {
        enabled: existing?.enabled ?? false,
        frequency: (existing?.frequency as FormState["frequency"]) ?? "daily",
      };
    }
    setForms(next);
  }, [schedules]);

  const save = async (type: AiScheduleRow["analysis_type"]) => {
    const f = forms[type];
    if (!f) return;
    try {
      await upsert.mutateAsync({
        analysis_type: type,
        frequency: f.frequency,
        enabled: f.enabled,
      });
      toast({ title: "Planification enregistrée", description: TYPES.find((t) => t.key === type)?.label });
    } catch (e) {
      toast({ title: "Erreur", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <CardTitle>Planification des analyses IA</CardTitle>
        </div>
        <CardDescription>
          Programmez l'exécution automatique des analyses IA. Les résultats sont consultables dans l'historique.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
        {TYPES.map((t) => {
          const existing = schedules.find((s) => s.analysis_type === t.key);
          const f = forms[t.key] ?? { enabled: false, frequency: "daily" as const };
          return (
            <div key={t.key} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="font-medium">{t.label}</span>
                    {existing?.enabled && <Badge variant="default" className="text-[10px]">Actif</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`enabled-${t.key}`} className="text-xs">Activé</Label>
                  <Switch
                    id={`enabled-${t.key}`}
                    checked={f.enabled}
                    onCheckedChange={(v) => setForms((s) => ({ ...s, [t.key]: { ...f, enabled: v } }))}
                  />
                </div>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <Label className="text-xs">Fréquence</Label>
                  <Select
                    value={f.frequency}
                    onValueChange={(v) => setForms((s) => ({ ...s, [t.key]: { ...f, frequency: v as FormState["frequency"] } }))}
                  >
                    <SelectTrigger className="w-[180px] mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Quotidienne</SelectItem>
                      <SelectItem value="weekly">Hebdomadaire</SelectItem>
                      <SelectItem value="monthly">Mensuelle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {existing?.last_run_at && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Dernière : {format(new Date(existing.last_run_at), "dd MMM HH:mm", { locale: fr })}
                  </div>
                )}
                {existing?.next_run_at && existing.enabled && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Prochaine : {format(new Date(existing.next_run_at), "dd MMM HH:mm", { locale: fr })}
                  </div>
                )}
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => save(t.key)}
                  disabled={upsert.isPending}
                >
                  <Save className="w-4 h-4 mr-1" /> Enregistrer
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
