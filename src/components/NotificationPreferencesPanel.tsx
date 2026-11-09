import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_PREFS,
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from "@/hooks/use-notification-preferences";

const ALL_MODULES = [
  "ar", "ap", "gl", "treasury", "procurement", "sales",
  "inventory", "hr", "payroll", "fixed_assets", "projects",
  "compliance", "risk", "crm", "budget",
];
const ALL_SEVERITIES = ["critical", "error", "warning", "info"];

export function NotificationPreferencesPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();


  const initial = useMemo(
    () => ({
      modules: data?.modules ?? DEFAULT_PREFS.modules,
      severities: data?.severities ?? DEFAULT_PREFS.severities,
      include_resolved: data?.include_resolved ?? DEFAULT_PREFS.include_resolved,
    }),
    [data],
  );
  const [modules, setModules] = useState<string[]>(initial.modules);
  const [severities, setSeverities] = useState<string[]>(initial.severities);
  const [includeResolved, setIncludeResolved] = useState<boolean>(initial.include_resolved);

  useEffect(() => {
    setModules(initial.modules);
    setSeverities(initial.severities);
    setIncludeResolved(initial.include_resolved);
  }, [initial]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-3">
          <p>Impossible de charger vos préférences.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Préférences de notification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <Label className="text-xs uppercase text-muted-foreground">Modules</Label>
          <p className="text-[11px] text-muted-foreground mb-2">
            Vide = tous les modules.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={modules.includes(m)}
                  onCheckedChange={() => setModules((prev) => toggle(prev, m))}
                />
                <span className="uppercase">{m}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <Label className="text-xs uppercase text-muted-foreground">Sévérités</Label>
          <div className="flex flex-wrap gap-3 mt-2">
            {ALL_SEVERITIES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={severities.includes(s)}
                  onCheckedChange={() => setSeverities((prev) => toggle(prev, s))}
                />
                <span className="capitalize">{s}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeResolved}
              onCheckedChange={(v) => setIncludeResolved(Boolean(v))}
            />
            Inclure les alertes résolues
          </label>
        </section>

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate({ modules, severities, include_resolved: includeResolved })}
          >
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
