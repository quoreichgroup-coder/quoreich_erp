import { CalendarDays } from "lucide-react";
import { useFiscalCalendar } from "@/hooks/use-fiscal-calendar";

/** Exercice en cours, lu dans le calendrier fiscal de la société (jamais une année écrite dans le code). */
export function useCurrentFiscalYear() {
  const { data } = useFiscalCalendar();
  const today = new Date().toISOString().slice(0, 10);
  return data?.years.find((y) => y.start_date <= today && today <= y.end_date) ?? null;
}

export function FiscalYearLabel({ prefix }: { prefix?: string }) {
  const fy = useCurrentFiscalYear();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="fiscal-year-label">
      <CalendarDays className="w-3.5 h-3.5" />
      {prefix ? `${prefix} · ` : ""}
      {fy ? `Exercice ${fy.code} (${fy.start_date} → ${fy.end_date})` : "Aucun exercice en cours"}
    </span>
  );
}
