import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useConsolidatedTrends, type TrendMonths } from "@/hooks/use-consolidated-trends";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const grid = "hsl(220, 14%, 88%)";
const axis = "hsl(220, 10%, 46%)";

type Props = { tenantIds: string[]; months: TrendMonths; onMonthsChange: (m: TrendMonths) => void };

export function ConsolidatedTrendsCard({ tenantIds, months, onMonthsChange }: Props) {
  const q = useConsolidatedTrends(tenantIds, months);
  const data = useMemo(() => q.data ?? [], [q.data]);
  const errToasted = useRef(false);
  useEffect(() => {
    if (q.isError && !errToasted.current) {
      errToasted.current = true;
      toast.error("Échec du chargement des tendances consolidées");
    }
    if (!q.isError) errToasted.current = false;
  }, [q.isError]);

  return (
    <Card data-testid="consolidated-trends">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Tendances consolidées</CardTitle>
        <div className="flex items-center gap-2" role="group" aria-label="Période des tendances">
          {([3, 6, 12] as TrendMonths[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={months === m ? "default" : "outline"}
              onClick={() => onMonthsChange(m)}
              aria-pressed={months === m}
            >
              {m} mois
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data.some((point) => point.cashBalance === null) && (
          <p className="mb-3 text-sm text-muted-foreground" role="status">Solde historique non renseigné pour les mois sans relevés de clôture complets. Trésorerie : comptes XOF actifs.</p>
        )}
        {tenantIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sélectionnez au moins une société.</p>
        ) : q.isLoading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : q.isError ? (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Erreur de chargement des tendances.
            <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Réessayer
            </Button>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={axis} />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={axis}
                tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}K`}
              />
              <Tooltip
                contentStyle={{ borderRadius: "0.375rem", border: `1px solid ${grid}`, fontSize: 12 }}
                formatter={(v: number) => new Intl.NumberFormat("fr-FR").format(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="revenue" name="Total Revenue" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expenses" name="Total Expenses" stroke="hsl(0, 72%, 51%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="hsl(220, 50%, 22%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cashBalance" name="Cash Balance" stroke="hsl(38, 92%, 50%)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
