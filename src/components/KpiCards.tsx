import { TrendingDown, TrendingUp } from "lucide-react";

const kpis = [
  {
    title: "Revenue",
    value: "$124,500.00",
    change: "+12.5%",
    trend: "up" as const,
  },
  {
    title: "Expenses",
    value: "$78,320.00",
    change: "+3.2%",
    trend: "up" as const,
  },
  {
    title: "Net Result",
    value: "$46,180.00",
    change: "+18.7%",
    trend: "up" as const,
  },
  {
    title: "Cash Position",
    value: "$89,400.00",
    change: "-2.1%",
    trend: "down" as const,
  },
];

export function KpiCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.title}
          className="bg-card rounded-lg border border-border p-4"
        >
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{kpi.title}</span>
          <div className="text-xl font-semibold text-card-foreground mt-1 tabular-nums">{kpi.value}</div>
          <div className="flex items-center gap-1 mt-1.5">
            {kpi.trend === "up" ? (
              <TrendingUp className="w-3 h-3 text-success" />
            ) : (
              <TrendingDown className="w-3 h-3 text-destructive" />
            )}
            <span
              className={`text-xs font-medium ${
                kpi.trend === "up" ? "text-success" : "text-destructive"
              }`}
            >
              {kpi.change}
            </span>
            <span className="text-xs text-muted-foreground">vs prior period</span>
          </div>
        </div>
      ))}
    </div>
  );
}
