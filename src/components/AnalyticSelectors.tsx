import { useAnalyticsSetup, useCustomerAnalyticDefaults, useSetCustomerAnalyticDefault } from "@/hooks/use-analytics-setup";
import { usableValues } from "@/lib/analytics-setup";

/**
 * Un sélecteur de section par axe actif. Ne propose que les sections imputables à la date donnée
 * (actives, dans leur validité), comme la base. Sans axe actif, ne rend rien : l'écran reste
 * celui d'une société sans analytique.
 */
export function AnalyticSelectors({
  date, value, onChange, required = new Set(), idPrefix, disabled = false,
}: {
  date: string;
  value: Record<string, string>;
  onChange: (axisId: string, valueId: string) => void;
  required?: Set<string>;
  idPrefix: string;
  disabled?: boolean;
}) {
  const { data } = useAnalyticsSetup();
  const axes = (data?.axes ?? []).filter((a) => a.active);
  if (axes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid={`${idPrefix}-analytics`}>
      {axes.map((axis) => {
        const options = usableValues(axis, date);
        const isRequired = required.has(axis.id);
        const current = value[axis.id] ?? "";
        // Une section déjà choisie mais devenue inutilisable reste visible, marquée, pour que l'écart se voie.
        const stale = current && !options.some((o) => o.id === current) ? axis.values.find((v) => v.id === current) : undefined;
        return (
          <label key={axis.id} className="space-y-1.5 text-xs block">
            <span className="text-foreground font-medium">
              {axis.name}{isRequired && <span className="text-destructive"> * obligatoire</span>}
            </span>
            <select
              id={`${idPrefix}-axis-${axis.code}`}
              value={current}
              disabled={disabled}
              onChange={(e) => onChange(axis.id, e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs disabled:opacity-70"
              aria-invalid={isRequired && !current ? true : undefined}
            >
              <option value="">— Aucune —</option>
              {stale && <option value={stale.id}>{stale.code} {stale.name} (inutilisable)</option>}
              {options.map((v) => <option key={v.id} value={v.id}>{v.code} {v.name}</option>)}
            </select>
          </label>
        );
      })}
    </div>
  );
}

/** Sections par défaut d'un client, enregistrées à chaque choix. Reprises sur ses factures. */
export function CustomerAnalyticDefaults({ customerId }: { customerId: string }) {
  const setup = useAnalyticsSetup();
  const defaults = useCustomerAnalyticDefaults(customerId);
  const save = useSetCustomerAnalyticDefault();
  if (!(setup.data?.axes ?? []).some((a) => a.active)) return null;

  const value = Object.fromEntries((defaults.data ?? []).map((d) => [d.axisId, d.valueId]));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="customer-analytic-defaults">
      <p className="text-xs font-semibold text-foreground">Analytique par défaut</p>
      <p className="text-xs text-muted-foreground">Reprise sur les factures de ce client quand aucune section n'y est choisie.</p>
      <AnalyticSelectors
        date={today}
        value={value}
        idPrefix="customer-default"
        disabled={!setup.data?.canManageValues || save.isPending}
        onChange={(axisId, valueId) => save.mutate({ customerId, axisId, valueId: valueId || undefined })}
      />
      {!setup.data?.canManageValues && (
        <p className="text-xs text-muted-foreground">Seuls l'administrateur et le comptable modifient l'analytique par défaut.</p>
      )}
    </div>
  );
}
